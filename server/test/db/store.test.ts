import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/pglite.js';
import { createAccount, createRule, createWorkspaceWithOwner } from '../helpers/factories.js';

let ctx: TestDatabase;
const owner = randomUUID();
let workspaceId: string;
let accountId: string;
let ruleId: string;

beforeAll(async () => {
  ctx = await createTestDatabase();
  await ctx.createAuthUser({ id: owner, email: 'owner@example.test' });
  workspaceId = (await createWorkspaceWithOwner(ctx.store, owner)).id;
  accountId = (await createAccount(ctx.store, workspaceId)).id;
  ruleId = (await createRule(ctx.store, workspaceId, accountId, owner)).id;
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

describe('atomic usage accounting', () => {
  it('increments until the limit, then returns null without incrementing', async () => {
    expect(await ctx.store.incrementUsage(workspaceId, 'private_replies_month', 1, 2)).toBe(1);
    expect(await ctx.store.incrementUsage(workspaceId, 'private_replies_month', 1, 2)).toBe(2);
    expect(await ctx.store.incrementUsage(workspaceId, 'private_replies_month', 1, 2)).toBeNull();
    const usage = await ctx.store.getUsage(workspaceId, {
      id: 'creator',
      name: 'Creator',
      description: null,
      limits: {
        accounts: 2,
        rules: 20,
        resources: 50,
        members: 3,
        private_replies_month: 2,
        comments_month: 5000,
      },
    });
    expect(usage.metrics.private_replies_month).toBe(2);
  });

  it('does not exceed the limit under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        ctx.store.incrementUsage(workspaceId, 'comments_processed', 1, 5),
      ),
    );
    expect(results.filter((value) => value !== null)).toHaveLength(5);
    const usage = await ctx.store.getUsage(workspaceId, {
      id: 'creator',
      name: 'Creator',
      description: null,
      limits: {
        accounts: 2,
        rules: 20,
        resources: 50,
        members: 3,
        private_replies_month: 100,
        comments_month: 5,
      },
    });
    expect(usage.metrics.comments_processed).toBe(5);
  });

  it('releases reserved quota and never goes below zero', async () => {
    await ctx.store.releaseUsage(workspaceId, 'private_replies_month', 1);
    const after = await ctx.store.getUsage(workspaceId, {
      id: 'creator',
      name: 'Creator',
      description: null,
      limits: {
        accounts: 2,
        rules: 20,
        resources: 50,
        members: 3,
        private_replies_month: 2,
        comments_month: 5,
      },
    });
    expect(after.metrics.private_replies_month).toBe(1);
    await ctx.store.releaseUsage(workspaceId, 'private_replies_month', 99);
    const floored = await ctx.store.getUsage(workspaceId, {
      id: 'creator',
      name: 'Creator',
      description: null,
      limits: {
        accounts: 2,
        rules: 20,
        resources: 50,
        members: 3,
        private_replies_month: 2,
        comments_month: 5,
      },
    });
    expect(floored.metrics.private_replies_month ?? 0).toBe(0);
  });
});

describe('webhook dedupe and job idempotency', () => {
  const eventInput = () => ({
    dedupeKey: `ig:1784:comments:${randomUUID()}`,
    workspaceId,
    accountId,
    igAccountId: '17841400000000001',
    field: 'comments',
    commentId: `comment-${randomUUID().slice(0, 8)}`,
    mediaId: 'media-1',
    commenterIgsid: 'ig-commenter-1',
    commenterUsername: 'commenter',
    commentText: 'API please',
    payload: { field: 'comments' },
  });

  it('stores the first delivery and reports duplicates without a second row', async () => {
    const input = eventInput();
    const first = await ctx.store.recordWebhookEvent(input);
    const second = await ctx.store.recordWebhookEvent(input);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    expect(second.event.duplicateCount).toBe(1);
  });

  it('enqueues at most one job per webhook event', async () => {
    const { event } = await ctx.store.recordWebhookEvent(eventInput());
    await ctx.store.enqueueJob({
      webhookEventId: event.id,
      workspaceId,
      accountId,
      maxAttempts: 5,
    });
    await ctx.store.enqueueJob({
      webhookEventId: event.id,
      workspaceId,
      accountId,
      maxAttempts: 5,
    });
    const jobs = await ctx.db.query<{ count: number }>(
      'select count(*)::int as count from public.automation_jobs where webhook_event_id = $1',
      [event.id],
    );
    expect(jobs.rows[0]?.count).toBe(1);
  });
});

describe('runs are unique per account and comment', () => {
  it('returns the existing run for a repeated comment', async () => {
    const { event } = await ctx.store.recordWebhookEvent({
      dedupeKey: `ig:1784:comments:dup-${randomUUID()}`,
      workspaceId,
      accountId,
      igAccountId: '17841400000000001',
      field: 'comments',
      commentId: `comment-${randomUUID()}`,
      mediaId: null,
      commenterIgsid: 'ig-1',
      commenterUsername: 'someone',
      commentText: 'GUIDE',
      payload: {},
    });
    const input = {
      workspaceId,
      accountId,
      webhookEventId: event.id,
      ruleId,
      ruleName: 'Rule',
      commentId: event.commentId!,
      mediaId: null,
      commenterUsername: 'someone',
      commenterIgsid: 'ig-1',
      commentText: 'GUIDE',
      matchedKeyword: 'GUIDE',
    };
    const first = await ctx.store.createOrGetRun(input);
    const second = await ctx.store.createOrGetRun(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });
});

describe('workspace deletion cascades tenant data', () => {
  it('removes accounts, rules, resources and runs', async () => {
    const other = await createWorkspaceWithOwner(ctx.store, owner, 'Delete me');
    const account = await createAccount(ctx.store, other.id, { igUserId: '17849999999999999' });
    await createRule(ctx.store, other.id, account.id, owner, { name: 'Temp rule' });
    await ctx.store.createResource({
      workspaceId: other.id,
      title: 'Temp',
      description: null,
      url: 'https://example.com',
      slug: `tmp-${randomUUID().slice(0, 8)}`,
      createdBy: owner,
    });
    await ctx.store.deleteWorkspace(other.id);
    expect(await ctx.store.getWorkspace(other.id)).toBeNull();
    const rows = await ctx.db.query<{ count: number }>(
      'select count(*)::int as count from public.automation_rules where workspace_id = $1',
      [other.id],
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe('account status transitions', () => {
  it('persists needs_reconnect with the Meta error code and clears it on recovery', async () => {
    const broken = await ctx.store.updateAccountStatus(accountId, 'needs_reconnect', 'META_190');
    expect(broken.status).toBe('needs_reconnect');
    expect(broken.lastErrorCode).toBe('META_190');
    expect(broken.lastErrorAt).toBeInstanceOf(Date);

    const recovered = await ctx.store.updateAccountStatus(accountId, 'connected', null);
    expect(recovered.status).toBe('connected');
    expect(recovered.lastErrorCode).toBeNull();
    expect(recovered.lastErrorAt).toBeNull();
  });
});
