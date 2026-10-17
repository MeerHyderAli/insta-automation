import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Db, SqlClient, SqlResult } from '../../src/db/db.js';
import { applyMigrations } from '../../src/db/migrate.js';
import { PgStore } from '../../src/db/pgStore.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

/**
 * PGlite adapter for the same `Db` interface used by the production PgDb.
 * PGlite does not bundle pgcrypto; `gen_random_uuid()` is built in on the
 * bundled PostgreSQL 18, so the extension line is removed from a temporary copy
 * of the migrations. Supabase itself provides pgcrypto.
 */
export class PgliteDb implements Db {
  constructor(readonly pglite: PGlite) {}

  async query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<T>> {
    if (values !== undefined && values.length > 0) {
      const result = await this.pglite.query<T>(text, values as unknown[]);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    }
    const results = await this.pglite.exec(text);
    const last = results[results.length - 1];
    return {
      rows: (last?.rows ?? []) as T[],
      rowCount: last?.affectedRows ?? last?.rows?.length ?? 0,
    };
  }

  async withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    await this.pglite.exec('begin');
    try {
      const result = await fn(this);
      await this.pglite.exec('commit');
      return result;
    } catch (error) {
      await this.pglite.exec('rollback').catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pglite.close();
  }
}

async function prepareMigrations(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'insta-migrations-'));
  for (const file of await readdir(MIGRATIONS_DIR)) {
    if (!file.endsWith('.sql')) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await writeFile(
      path.join(directory, file),
      sql.replace(
        /create extension if not exists pgcrypto;/gi,
        '-- pgcrypto not bundled in PGlite',
      ),
      'utf8',
    );
  }
  return directory;
}

export interface TestDatabase {
  db: PgliteDb;
  pglite: PGlite;
  store: PgStore;
  createAuthUser: (input: { id: string; email: string; name?: string }) => Promise<void>;
  asUser: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pglite = await PGlite.create();
  // Supabase provides these roles/schema; mirror the minimum needed here.
  await pglite.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  const directory = await prepareMigrations();
  const db = new PgliteDb(pglite);
  try {
    await applyMigrations(db, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const store = new PgStore(db);
  return {
    db,
    pglite,
    store,
    async createAuthUser({ id, email, name }) {
      await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
        id,
        email,
        JSON.stringify(name ? { full_name: name } : {}),
      ]);
      await store.upsertProfile({ id, email });
    },
    async asUser(userId, fn) {
      await db.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);
      await pglite.exec('set role authenticated');
      try {
        return await fn();
      } finally {
        await pglite.exec('reset role');
        await db.query("select set_config('request.jwt.claims', '', false)");
      }
    },
    async close() {
      await pglite.close();
    },
  };
}
