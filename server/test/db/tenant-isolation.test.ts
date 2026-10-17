import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/pglite.js';
import { createAccount, createRule, createWorkspaceWithOwner } from '../helpers/factories.js';

let ctx: TestDatabase;
const userA = randomUUID();
const userB = randomUUID();
let workspaceA: string;
let workspaceB: string;
let accountA: string;
let resourceA: string;
let ruleA: string;

beforeAll(async () => {
  ctx = await createTestDatabase();
  await ctx.createAuthUser({ id: userA, email: 'a@example.test', name: 'User A' });
  await ctx.createAuthUser({ id: userB, email: 'b@example.test', name: 'User B' });
  workspaceA = (await createWorkspaceWithOwner(ctx.store, userA, 'Workspace A')).id;
  workspaceB = (await createWorkspaceWithOwner(ctx.store, userB, 'Workspace B')).id;
  accountA = (await createAccount(ctx.store, workspaceA)).id;
  const resource = await ctx.store.createResource({
    workspaceId: workspaceA,
    title: 'A resource',
    description: null,
    url: 'https://example.com/guide',
    slug: `slug${randomUUID().slice(0, 8)}`,
    createdBy: userA,
  });
  resourceA = resource.id;
  ruleA = (await createRule(ctx.store, workspaceA, accountA, userA, { name: 'A rule' })).id;
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

describe('RLS tenant isolation', () => {
  it('shows only workspaces the user belongs to', async () => {
    const rows = await ctx.asUser(userA, () =>
      ctx.db.query<{ id: string }>('select id from public.workspaces order by id'),
    );
    expect(rows.rows.map((row) => row.id)).toEqual([workspaceA]);
  });

  it('cannot read another tenant workspace by id', async () => {
    const rows = await ctx.asUser(userB, () =>
      ctx.db.query<{ id: string }>('select id from public.workspaces where id = $1', [workspaceA]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('cannot read another tenant resources, members, accounts or rules', async () => {
    const resources = await ctx.asUser(userB, () =>
      ctx.db.query('select id from public.resources where workspace_id = $1', [workspaceA]),
    );
    const members = await ctx.asUser(userB, () =>
      ctx.db.query('select user_id from public.workspace_members where workspace_id = $1', [
        workspaceA,
      ]),
    );
    const accounts = await ctx.asUser(userB, () =>
      ctx.db.query('select id from public.instagram_accounts where workspace_id = $1', [
        workspaceA,
      ]),
    );
    const rules = await ctx.asUser(userB, () =>
      ctx.db.query('select id from public.automation_rules where workspace_id = $1', [workspaceA]),
    );
    expect(resources.rows).toHaveLength(0);
    expect(members.rows).toHaveLength(0);
    expect(accounts.rows).toHaveLength(0);
    expect(rules.rows).toHaveLength(0);
  });

  it('cannot update or delete another tenant resource', async () => {
    const update = await ctx.asUser(userB, () =>
      ctx.db.query('update public.resources set title = $1 where id = $2', ['hacked', resourceA]),
    );
    const remove = await ctx.asUser(userB, () =>
      ctx.db.query('delete from public.resources where id = $1', [resourceA]),
    );
    expect(update.rowCount).toBe(0);
    expect(remove.rowCount).toBe(0);
    const still = await ctx.store.getResource(workspaceA, resourceA);
    expect(still?.title).toBe('A resource');
  });

  it('cannot insert a rule into another tenant workspace', async () => {
    await expect(
      ctx.asUser(userB, () =>
        ctx.db.query(
          `insert into public.automation_rules
             (workspace_id, account_id, name, keywords, public_reply_template)
           values ($1, $2, $3, $4, $5)`,
          [workspaceA, accountA, `intruder-${randomUUID().slice(0, 6)}`, ['API'], 'hi'],
        ),
      ),
    ).rejects.toThrow();
  });

  it('rejects spoofed workspace inserts (created_by must be the caller)', async () => {
    await expect(
      ctx.asUser(userB, () =>
        ctx.db.query(
          `insert into public.workspaces (name, slug, plan_id, created_by)
           values ('Spoofed', $1, 'free', $2)`,
          [`spoof-${randomUUID().slice(0, 8)}`, userA],
        ),
      ),
    ).rejects.toThrow();
  });

  it('allows a member to read its own tenant rows', async () => {
    const resources = await ctx.asUser(userA, () =>
      ctx.db.query<{ id: string }>('select id from public.resources where workspace_id = $1', [
        workspaceA,
      ]),
    );
    const rules = await ctx.asUser(userA, () =>
      ctx.db.query<{ id: string }>(
        'select id from public.automation_rules where workspace_id = $1',
        [workspaceA],
      ),
    );
    expect(resources.rows.map((row) => row.id)).toContain(resourceA);
    expect(rules.rows.map((row) => row.id)).toContain(ruleA);
  });

  it('never exposes token columns to browser roles', async () => {
    await expect(
      ctx.asUser(userA, () => ctx.db.query('select * from public.instagram_accounts')),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.asUser(userA, () =>
        ctx.db.query('select token_ciphertext from public.instagram_accounts'),
      ),
    ).rejects.toThrow(/permission denied/i);
    const safe = await ctx.asUser(userA, () =>
      ctx.db.query<{ id: string; username: string }>(
        'select id, username from public.instagram_accounts where workspace_id = $1',
        [workspaceA],
      ),
    );
    expect(safe.rows[0]?.username).toBe('test.creator');
  });

  it('keeps server-only tables inaccessible to browser roles', async () => {
    await expect(
      ctx.asUser(userA, () => ctx.db.query('select * from public.webhook_events')),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.asUser(userA, () => ctx.db.query('select * from public.oauth_states')),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.asUser(userA, () => ctx.db.query('select * from public.automation_jobs')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('lets only admins add members, and never an owner through policy', async () => {
    // User A is owner of workspace A and may add B as a member.
    await ctx.asUser(userA, () =>
      ctx.db.query(
        `insert into public.workspace_members (workspace_id, user_id, role)
         values ($1, $2, 'member')`,
        [workspaceA, userB],
      ),
    );
    const added = await ctx.store.getMembership(workspaceA, userB);
    expect(added?.role).toBe('member');
    // B (now a member) still cannot insert another member.
    await expect(
      ctx.asUser(userB, () =>
        ctx.db.query(
          `insert into public.workspace_members (workspace_id, user_id, role)
           values ($1, $2, 'admin')`,
          [workspaceA, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
    // Nobody can insert an owner membership through the API role.
    await expect(
      ctx.asUser(userA, () =>
        ctx.db.query(
          `insert into public.workspace_members (workspace_id, user_id, role)
           values ($1, $2, 'owner')`,
          [workspaceB, userA],
        ),
      ),
    ).rejects.toThrow();
  });
});
