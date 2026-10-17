import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/pglite.js';
import { applyMigrations } from '../../src/db/migrate.js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

let ctx: TestDatabase;

beforeAll(async () => {
  ctx = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

it('applies every migration and records the ledger', async () => {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const ledger = await ctx.db.query<{ version: string }>(
    'select version from public.schema_migrations order by version',
  );
  expect(ledger.rows.map((row) => row.version)).toEqual(files);
});

it('is idempotent when re-applied', async () => {
  const applied = await applyMigrations(ctx.db, MIGRATIONS_DIR);
  // The real directory includes the pgcrypto extension, which Supabase has and
  // PGlite does not. A second run with the same directory is skipped entirely
  // because every version is already in the ledger.
  expect(applied).toEqual([]);
});

it('creates the required tenant tables with RLS enabled', async () => {
  const expected = [
    'profiles',
    'workspaces',
    'workspace_members',
    'instagram_accounts',
    'automation_rules',
    'webhook_events',
    'automation_runs',
    'usage_records',
  ];
  const tables = await ctx.db.query<{ tablename: string; rowsecurity: boolean }>(
    `select tablename, rowsecurity from pg_tables
     where schemaname = 'public' and tablename = any($1::text[])`,
    [expected],
  );
  expect(tables.rows).toHaveLength(expected.length);
  for (const table of tables.rows) {
    expect(table.rowsecurity, `${table.tablename} must have RLS enabled`).toBe(true);
  }
});

it('seeds the plan catalogue', async () => {
  const plans = await ctx.db.query<{ id: string; limits: Record<string, number> }>(
    'select id, limits from public.plans order by id',
  );
  expect(plans.rows.map((row) => row.id)).toEqual(['creator', 'free', 'studio']);
  const free = plans.rows.find((row) => row.id === 'free');
  expect(free?.limits.private_replies_month).toBe(100);
});

it('ships the SQL tenant isolation suite for real Supabase runs', async () => {
  // The SQL suite runs against a real Supabase instance (see README); the RLS
  // assertions here run on PGlite without Docker.
  const { access } = await import('node:fs/promises');
  const file = fileURLToPath(new URL('../../../supabase/tests/rls.test.sql', import.meta.url));
  await expect(access(file)).resolves.toBeUndefined();
});
