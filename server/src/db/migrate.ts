import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgDb, type Db } from './db.js';
import { loadConfig } from '../config/env.js';
import { createLogger } from '../lib/logger.js';

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

const LEDGER_SQL = `
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
`;

export async function applyMigrations(
  db: Db,
  directory: string = MIGRATIONS_DIR,
  logger: { info: (msg: string) => void; warn: (msg: string) => void } | null = null,
): Promise<string[]> {
  await db.query(LEDGER_SQL);
  const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  const appliedRows = await db.query<{ version: string }>(
    'select version from public.schema_migrations',
  );
  const applied = new Set(appliedRows.rows.map((row) => row.version));
  const freshlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(directory, file), 'utf8');
    logger?.info(`Applying migration ${file}`);
    await db.withTransaction(async (tx) => {
      await tx.query(sql);
      await tx.query('insert into public.schema_migrations (version) values ($1)', [file]);
    });
    freshlyApplied.push(file);
    applied.add(file);
  }

  if (freshlyApplied.length === 0) logger?.info('Database is up to date.');
  return freshlyApplied;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  if (!config.database.url) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }
  const db = new PgDb(config.database.url, { ssl: config.database.ssl });
  try {
    const applied = await applyMigrations(db, MIGRATIONS_DIR, {
      info: (message) => logger.info(message),
      warn: (message) => logger.warn(message),
    });
    logger.info({ applied }, 'Migrations complete');
  } finally {
    await db.close();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
