import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { AppConfig } from './config';
import { getConfig } from './config';
import type { CommentPatch, CommentRecord } from './types';

/**
 * Durable record of every comment we have seen.
 *
 * The critical operation is `tryClaim`: it atomically records a comment id
 * the first time it is seen. The webhook handler claims a comment BEFORE
 * sending any DM, so Meta redeliveries (it retries for up to 36h) and
 * duplicate notifications can never produce a second DM. That is
 * at-most-once delivery — the safe side to err on, because Meta only
 * allows one private reply per comment anyway.
 */
export interface CommentStore {
  tryClaim(record: CommentRecord): Promise<boolean>;
  update(commentId: string, patch: CommentPatch): Promise<void>;
  list(limit: number): Promise<CommentRecord[]>;
}

/* ------------------------------------------------------------------ */
/* Local JSON file store (local dev / single small server)             */
/* ------------------------------------------------------------------ */

export class FileCommentStore implements CommentStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxRecords = 500,
  ) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readAll(): Promise<CommentRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Comment store file is corrupted (invalid JSON): ${this.filePath}`);
    }
    return Array.isArray(parsed) ? (parsed as CommentRecord[]) : [];
  }

  private async writeAll(records: CommentRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  tryClaim(record: CommentRecord): Promise<boolean> {
    return this.run(async () => {
      const all = await this.readAll();
      if (all.some((existing) => existing.commentId === record.commentId)) return false;
      all.push(record);
      const trimmed = all
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
        .slice(-this.maxRecords);
      await this.writeAll(trimmed);
      return true;
    });
  }

  update(commentId: string, patch: CommentPatch): Promise<void> {
    return this.run(async () => {
      const all = await this.readAll();
      const index = all.findIndex((existing) => existing.commentId === commentId);
      if (index === -1) return;
      all[index] = { ...all[index], ...patch };
      await this.writeAll(all);
    });
  }

  async list(limit: number): Promise<CommentRecord[]> {
    const all = await this.readAll();
    return all.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
  }
}

/* ------------------------------------------------------------------ */
/* Postgres store (production / serverless)                            */
/* ------------------------------------------------------------------ */

interface PgRow {
  comment_id: string;
  ig_account_id: string | null;
  media_id: string | null;
  username: string | null;
  text: string;
  matched_keyword: string | null;
  dm_status: CommentRecord['dmStatus'];
  dm_message_id: string | null;
  error: string | null;
  received_at: Date | string;
}

export class PostgresCommentStore implements CommentStore {
  private readonly pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3 });
  }

  private ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool
        .query(
          `CREATE TABLE IF NOT EXISTS processed_comments (
             comment_id      TEXT PRIMARY KEY,
             ig_account_id   TEXT,
             media_id        TEXT,
             username        TEXT,
             text            TEXT NOT NULL,
             matched_keyword TEXT,
             dm_status       TEXT NOT NULL,
             dm_message_id   TEXT,
             error           TEXT,
             received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
           );
           CREATE INDEX IF NOT EXISTS processed_comments_received_at_idx
             ON processed_comments (received_at DESC);`,
        )
        .then(() => undefined);
    }
    return this.ready;
  }

  async tryClaim(record: CommentRecord): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO processed_comments
         (comment_id, ig_account_id, media_id, username, text, matched_keyword, dm_status, dm_message_id, error, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (comment_id) DO NOTHING
       RETURNING comment_id`,
      [
        record.commentId,
        record.igAccountId,
        record.mediaId,
        record.username,
        record.text,
        record.matchedKeyword,
        record.dmStatus,
        record.dmMessageId,
        record.error,
        record.receivedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async update(commentId: string, patch: CommentPatch): Promise<void> {
    await this.ensureSchema();
    const columnByField: Record<keyof CommentPatch, string> = {
      dmStatus: 'dm_status',
      matchedKeyword: 'matched_keyword',
      dmMessageId: 'dm_message_id',
      error: 'error',
    };
    const values: unknown[] = [commentId];
    const sets: string[] = [];
    for (const [field, column] of Object.entries(columnByField) as [keyof CommentPatch, string][]) {
      if (patch[field] !== undefined) {
        values.push(patch[field]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length === 0) return;
    await this.pool.query(
      `UPDATE processed_comments SET ${sets.join(', ')} WHERE comment_id = $1`,
      values,
    );
  }

  async list(limit: number): Promise<CommentRecord[]> {
    await this.ensureSchema();
    const result = await this.pool.query<PgRow>(
      `SELECT comment_id, ig_account_id, media_id, username, text,
              matched_keyword, dm_status, dm_message_id, error, received_at
         FROM processed_comments
        ORDER BY received_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      commentId: row.comment_id,
      igAccountId: row.ig_account_id,
      mediaId: row.media_id,
      username: row.username,
      text: row.text,
      matchedKeyword: row.matched_keyword,
      dmStatus: row.dm_status,
      dmMessageId: row.dm_message_id,
      error: row.error,
      receivedAt:
        row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
    }));
  }
}

/* ------------------------------------------------------------------ */
/* Factory (one store per server process)                              */
/* ------------------------------------------------------------------ */

const globalForStore = globalThis as typeof globalThis & { __commentStore?: CommentStore };

export function createStore(config: AppConfig): CommentStore {
  return config.databaseUrl
    ? new PostgresCommentStore(config.databaseUrl)
    : new FileCommentStore(config.dataFile);
}

export function getStore(config: AppConfig = getConfig()): CommentStore {
  globalForStore.__commentStore ??= createStore(config);
  return globalForStore.__commentStore;
}

export function resetStoreForTests(): void {
  globalForStore.__commentStore = undefined;
}
