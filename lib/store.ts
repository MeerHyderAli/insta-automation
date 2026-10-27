import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { AppConfig } from './config';
import { getConfig } from './config';
import type { CommentPatch, CommentRecord, MediaResource, WebhookReceipt } from './types';

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
  findLatestPendingByCommenterId(commenterId: string): Promise<CommentRecord | null>;
  findPendingByCommentId(commentId: string): Promise<CommentRecord | null>;
  /** Finds the original record whose automation public reply has this comment ID. */
  findRecordByCommentReplyId(commentReplyId: string): Promise<CommentRecord | null>;
  hasHandledCommentForUserMedia(
    commenterId: string,
    mediaId: string,
    excludeCommentId: string,
  ): Promise<boolean>;
  tryClaimClick(commentId: string, eventId: string): Promise<CommentRecord | null>;
  listMediaResources(): Promise<MediaResource[]>;
  getMediaResource(mediaId: string): Promise<MediaResource | null>;
  upsertMediaResource(input: {
    mediaId: string;
    url: string;
    label: string | null;
  }): Promise<MediaResource>;
  deleteMediaResource(mediaId: string): Promise<void>;
  recordWebhookReceipt(receipt: WebhookReceipt): Promise<void>;
  listWebhookReceipts(limit: number): Promise<WebhookReceipt[]>;
}

const PENDING_DM_STATUSES = new Set(['prompt_sent', 'follow_prompt_sent']);
const HANDLED_USER_MEDIA_STATUSES = new Set([
  'processing',
  'checking_follow',
  'prompt_sent',
  'follow_prompt_sent',
  'link_sent',
  'sent',
]);

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
    if (!Array.isArray(parsed)) return [];
    // Fill defaults for fields added after earlier records were written.
    return (parsed as Array<Partial<CommentRecord>>).map((record) => ({
      ...record,
      commenterId: record.commenterId ?? null,
      resourceLink: record.resourceLink ?? null,
      followStatus: record.followStatus ?? 'not_checked',
      commentReplyStatus: record.commentReplyStatus ?? 'not_sent',
      commentReplyId: record.commentReplyId ?? null,
      commentReplyError: record.commentReplyError ?? null,
      lastClickEventId: record.lastClickEventId ?? null,
    })) as CommentRecord[];
  }

  private async writeAll(records: CommentRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  private get resourcesFilePath(): string {
    return this.filePath.endsWith('.json')
      ? `${this.filePath.slice(0, -'.json'.length)}.resources.json`
      : `${this.filePath}.resources.json`;
  }

  private async readResources(): Promise<MediaResource[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.resourcesFilePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Media resource store file is corrupted (invalid JSON): ${this.resourcesFilePath}`);
    }
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Partial<MediaResource>>)
      .filter((resource) => resource.mediaId && resource.url)
      .map((resource) => ({
        mediaId: String(resource.mediaId),
        url: String(resource.url),
        label: resource.label ? String(resource.label) : null,
        updatedAt: resource.updatedAt ? String(resource.updatedAt) : new Date(0).toISOString(),
      }));
  }

  private async writeResources(resources: MediaResource[]): Promise<void> {
    await fs.mkdir(path.dirname(this.resourcesFilePath), { recursive: true });
    const tmpPath = `${this.resourcesFilePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(resources, null, 2), 'utf8');
    await fs.rename(tmpPath, this.resourcesFilePath);
  }

  private get webhookReceiptsFilePath(): string {
    return this.filePath.endsWith('.json')
      ? `${this.filePath.slice(0, -'.json'.length)}.webhooks.json`
      : `${this.filePath}.webhooks.json`;
  }

  private async readWebhookReceipts(): Promise<WebhookReceipt[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.webhookReceiptsFilePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Webhook receipt store file is corrupted (invalid JSON): ${this.webhookReceiptsFilePath}`,
      );
    }
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Partial<WebhookReceipt>>).flatMap((receipt, index) => {
      if (!receipt.status || !receipt.receivedAt) return [];
      return [
        {
          id: receipt.id ? String(receipt.id) : `legacy-${index}`,
          receivedAt: String(receipt.receivedAt),
          status: receipt.status,
          httpStatus: typeof receipt.httpStatus === 'number' ? receipt.httpStatus : 0,
          signaturePresent: receipt.signaturePresent === true,
          payloadObject: receipt.payloadObject ? String(receipt.payloadObject) : null,
          entryCount: typeof receipt.entryCount === 'number' ? receipt.entryCount : 0,
          entryFields: Array.isArray(receipt.entryFields)
            ? receipt.entryFields.map(String)
            : [],
          parsedComments:
            typeof receipt.parsedComments === 'number' ? receipt.parsedComments : 0,
          parsedMessages:
            typeof receipt.parsedMessages === 'number' ? receipt.parsedMessages : 0,
          resultSummary: receipt.resultSummary ? String(receipt.resultSummary) : null,
          error: receipt.error ? String(receipt.error) : null,
        },
      ];
    });
  }

  private async writeWebhookReceipts(receipts: WebhookReceipt[]): Promise<void> {
    await fs.mkdir(path.dirname(this.webhookReceiptsFilePath), { recursive: true });
    const tmpPath = `${this.webhookReceiptsFilePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(receipts, null, 2), 'utf8');
    await fs.rename(tmpPath, this.webhookReceiptsFilePath);
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

  async findLatestPendingByCommenterId(commenterId: string): Promise<CommentRecord | null> {
    const all = await this.readAll();
    return (
      all
        .filter(
          (record) =>
            record.commenterId === commenterId && PENDING_DM_STATUSES.has(record.dmStatus),
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] ?? null
    );
  }

  async findPendingByCommentId(commentId: string): Promise<CommentRecord | null> {
    const all = await this.readAll();
    return (
      all.find(
        (record) => record.commentId === commentId && PENDING_DM_STATUSES.has(record.dmStatus),
      ) ?? null
    );
  }

  async findRecordByCommentReplyId(commentReplyId: string): Promise<CommentRecord | null> {
    const all = await this.readAll();
    return all.find((record) => record.commentReplyId === commentReplyId) ?? null;
  }

  async hasHandledCommentForUserMedia(
    commenterId: string,
    mediaId: string,
    excludeCommentId: string,
  ): Promise<boolean> {
    const all = await this.readAll();
    return all.some(
      (record) =>
        record.commentId !== excludeCommentId &&
        record.commenterId === commenterId &&
        record.mediaId === mediaId &&
        HANDLED_USER_MEDIA_STATUSES.has(record.dmStatus),
    );
  }

  tryClaimClick(commentId: string, eventId: string): Promise<CommentRecord | null> {
    return this.run(async () => {
      const all = await this.readAll();
      const index = all.findIndex((existing) => existing.commentId === commentId);
      if (index === -1) return null;
      const record = all[index];
      if (!PENDING_DM_STATUSES.has(record.dmStatus) || record.lastClickEventId === eventId) {
        return null;
      }
      all[index] = {
        ...record,
        dmStatus: 'checking_follow',
        lastClickEventId: eventId,
        error: null,
      };
      await this.writeAll(all);
      return all[index];
    });
  }

  async listMediaResources(): Promise<MediaResource[]> {
    const resources = await this.readResources();
    return resources.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getMediaResource(mediaId: string): Promise<MediaResource | null> {
    const resources = await this.readResources();
    return resources.find((resource) => resource.mediaId === mediaId) ?? null;
  }

  upsertMediaResource(input: {
    mediaId: string;
    url: string;
    label: string | null;
  }): Promise<MediaResource> {
    return this.run(async () => {
      const resources = await this.readResources();
      const resource: MediaResource = { ...input, updatedAt: new Date().toISOString() };
      const index = resources.findIndex((existing) => existing.mediaId === input.mediaId);
      if (index === -1) resources.push(resource);
      else resources[index] = resource;
      await this.writeResources(resources);
      return resource;
    });
  }

  deleteMediaResource(mediaId: string): Promise<void> {
    return this.run(async () => {
      const resources = await this.readResources();
      await this.writeResources(resources.filter((resource) => resource.mediaId !== mediaId));
    });
  }

  recordWebhookReceipt(receipt: WebhookReceipt): Promise<void> {
    return this.run(async () => {
      const receipts = await this.readWebhookReceipts();
      receipts.push(receipt);
      const trimmed = receipts
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
        .slice(-100);
      await this.writeWebhookReceipts(trimmed);
    });
  }

  async listWebhookReceipts(limit: number): Promise<WebhookReceipt[]> {
    const receipts = await this.readWebhookReceipts();
    return receipts
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, Math.max(0, limit));
  }
}

/* ------------------------------------------------------------------ */
/* Postgres store (production / serverless)                            */
/* ------------------------------------------------------------------ */

interface PgRow {
  comment_id: string;
  commenter_id: string | null;
  ig_account_id: string | null;
  media_id: string | null;
  username: string | null;
  text: string;
  matched_keyword: string | null;
  resource_link: string | null;
  follow_status: CommentRecord['followStatus'] | null;
  dm_status: CommentRecord['dmStatus'];
  dm_message_id: string | null;
  comment_reply_status: CommentRecord['commentReplyStatus'] | null;
  comment_reply_id: string | null;
  comment_reply_error: string | null;
  last_click_event_id: string | null;
  error: string | null;
  received_at: Date | string;
}

const PG_COLUMNS = `comment_id, commenter_id, ig_account_id, media_id, username, text,
              matched_keyword, resource_link, follow_status, dm_status, dm_message_id,
              comment_reply_status, comment_reply_id, comment_reply_error,
              last_click_event_id, error, received_at`;

function mapPgRow(row: PgRow): CommentRecord {
  return {
    commentId: row.comment_id,
    commenterId: row.commenter_id,
    igAccountId: row.ig_account_id,
    mediaId: row.media_id,
    username: row.username,
    text: row.text,
    matchedKeyword: row.matched_keyword,
    resourceLink: row.resource_link,
    followStatus: row.follow_status ?? 'not_checked',
    dmStatus: row.dm_status,
    dmMessageId: row.dm_message_id,
    commentReplyStatus: row.comment_reply_status ?? 'not_sent',
    commentReplyId: row.comment_reply_id,
    commentReplyError: row.comment_reply_error,
    lastClickEventId: row.last_click_event_id,
    error: row.error,
    receivedAt:
      row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
  };
}

interface PgWebhookReceiptRow {
  id: string;
  received_at: Date | string;
  status: WebhookReceipt['status'];
  http_status: number;
  signature_present: boolean;
  payload_object: string | null;
  entry_count: number;
  entry_fields: string;
  parsed_comments: number;
  parsed_messages: number;
  result_summary: string | null;
  error: string | null;
}

function parseEntryFields(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapWebhookReceiptRow(row: PgWebhookReceiptRow): WebhookReceipt {
  return {
    id: row.id,
    receivedAt:
      row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
    status: row.status,
    httpStatus: row.http_status,
    signaturePresent: row.signature_present,
    payloadObject: row.payload_object,
    entryCount: row.entry_count,
    entryFields: parseEntryFields(row.entry_fields),
    parsedComments: row.parsed_comments,
    parsedMessages: row.parsed_messages,
    resultSummary: row.result_summary,
    error: row.error,
  };
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
             commenter_id    TEXT,
             ig_account_id   TEXT,
             media_id        TEXT,
             username        TEXT,
             text            TEXT NOT NULL,
             matched_keyword TEXT,
             resource_link   TEXT,
             follow_status   TEXT,
             dm_status       TEXT NOT NULL,
             dm_message_id   TEXT,
             comment_reply_status TEXT,
             comment_reply_id TEXT,
             comment_reply_error TEXT,
             last_click_event_id TEXT,
             error           TEXT,
             received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
           );
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS follow_status TEXT;
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS commenter_id TEXT;
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS last_click_event_id TEXT;
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS resource_link TEXT;
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS comment_reply_status TEXT;
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS comment_reply_id TEXT;
           ALTER TABLE processed_comments
             ADD COLUMN IF NOT EXISTS comment_reply_error TEXT;
           CREATE INDEX IF NOT EXISTS processed_comments_comment_reply_idx
             ON processed_comments (comment_reply_id);
           CREATE INDEX IF NOT EXISTS processed_comments_received_at_idx
             ON processed_comments (received_at DESC);
           CREATE INDEX IF NOT EXISTS processed_comments_commenter_idx
             ON processed_comments (commenter_id, received_at DESC);
           CREATE TABLE IF NOT EXISTS media_resources (
             media_id   TEXT PRIMARY KEY,
             url        TEXT NOT NULL,
             label      TEXT,
             updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
           );
           CREATE TABLE IF NOT EXISTS webhook_receipts (
             id                TEXT PRIMARY KEY,
             received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
             status            TEXT NOT NULL,
             http_status       INTEGER NOT NULL,
             signature_present BOOLEAN NOT NULL,
             payload_object    TEXT,
             entry_count       INTEGER NOT NULL,
             entry_fields      TEXT NOT NULL,
             parsed_comments   INTEGER NOT NULL,
             parsed_messages   INTEGER NOT NULL,
             result_summary    TEXT,
             error             TEXT
           );
           CREATE INDEX IF NOT EXISTS webhook_receipts_received_at_idx
             ON webhook_receipts (received_at DESC);`,
        )
        .then(() => undefined);
    }
    return this.ready;
  }

  async tryClaim(record: CommentRecord): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO processed_comments
         (comment_id, commenter_id, ig_account_id, media_id, username, text, matched_keyword, resource_link, follow_status, dm_status, dm_message_id, comment_reply_status, comment_reply_id, comment_reply_error, last_click_event_id, error, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (comment_id) DO NOTHING
       RETURNING comment_id`,
      [
        record.commentId,
        record.commenterId,
        record.igAccountId,
        record.mediaId,
        record.username,
        record.text,
        record.matchedKeyword,
        record.resourceLink,
        record.followStatus,
        record.dmStatus,
        record.dmMessageId,
        record.commentReplyStatus,
        record.commentReplyId,
        record.commentReplyError,
        record.lastClickEventId,
        record.error,
        record.receivedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async update(commentId: string, patch: CommentPatch): Promise<void> {
    await this.ensureSchema();
    const columnByField: Record<keyof CommentPatch, string> = {
      commenterId: 'commenter_id',
      dmStatus: 'dm_status',
      matchedKeyword: 'matched_keyword',
      resourceLink: 'resource_link',
      followStatus: 'follow_status',
      dmMessageId: 'dm_message_id',
      commentReplyStatus: 'comment_reply_status',
      commentReplyId: 'comment_reply_id',
      commentReplyError: 'comment_reply_error',
      lastClickEventId: 'last_click_event_id',
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
      `SELECT ${PG_COLUMNS}
         FROM processed_comments
        ORDER BY received_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapPgRow);
  }

  async findLatestPendingByCommenterId(commenterId: string): Promise<CommentRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<PgRow>(
      `SELECT ${PG_COLUMNS}
         FROM processed_comments
        WHERE commenter_id = $1
          AND dm_status IN ('prompt_sent', 'follow_prompt_sent')
        ORDER BY received_at DESC
        LIMIT 1`,
      [commenterId],
    );
    return result.rows[0] ? mapPgRow(result.rows[0]) : null;
  }

  async findPendingByCommentId(commentId: string): Promise<CommentRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<PgRow>(
      `SELECT ${PG_COLUMNS}
         FROM processed_comments
        WHERE comment_id = $1
          AND dm_status IN ('prompt_sent', 'follow_prompt_sent')
        LIMIT 1`,
      [commentId],
    );
    return result.rows[0] ? mapPgRow(result.rows[0]) : null;
  }

  async findRecordByCommentReplyId(commentReplyId: string): Promise<CommentRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<PgRow>(
      `SELECT ${PG_COLUMNS}
         FROM processed_comments
        WHERE comment_reply_id = $1
        LIMIT 1`,
      [commentReplyId],
    );
    return result.rows[0] ? mapPgRow(result.rows[0]) : null;
  }

  async hasHandledCommentForUserMedia(
    commenterId: string,
    mediaId: string,
    excludeCommentId: string,
  ): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT 1
         FROM processed_comments
        WHERE commenter_id = $1
          AND media_id = $2
          AND comment_id <> $3
          AND dm_status IN ('processing', 'checking_follow', 'prompt_sent', 'follow_prompt_sent', 'link_sent', 'sent')
        LIMIT 1`,
      [commenterId, mediaId, excludeCommentId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listMediaResources(): Promise<MediaResource[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{
      media_id: string;
      url: string;
      label: string | null;
      updated_at: Date | string;
    }>(
      `SELECT media_id, url, label, updated_at
         FROM media_resources
        ORDER BY updated_at DESC`,
    );
    return result.rows.map((row) => ({
      mediaId: row.media_id,
      url: row.url,
      label: row.label,
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  }

  async getMediaResource(mediaId: string): Promise<MediaResource | null> {
    const resources = await this.listMediaResources();
    return resources.find((resource) => resource.mediaId === mediaId) ?? null;
  }

  async upsertMediaResource(input: {
    mediaId: string;
    url: string;
    label: string | null;
  }): Promise<MediaResource> {
    await this.ensureSchema();
    const result = await this.pool.query<{
      media_id: string;
      url: string;
      label: string | null;
      updated_at: Date | string;
    }>(
      `INSERT INTO media_resources (media_id, url, label, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (media_id) DO UPDATE
         SET url = EXCLUDED.url,
             label = EXCLUDED.label,
             updated_at = now()
       RETURNING media_id, url, label, updated_at`,
      [input.mediaId, input.url, input.label],
    );
    const row = result.rows[0];
    return {
      mediaId: row.media_id,
      url: row.url,
      label: row.label,
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }

  async deleteMediaResource(mediaId: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(`DELETE FROM media_resources WHERE media_id = $1`, [mediaId]);
  }

  async recordWebhookReceipt(receipt: WebhookReceipt): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO webhook_receipts
         (id, received_at, status, http_status, signature_present, payload_object,
          entry_count, entry_fields, parsed_comments, parsed_messages, result_summary, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        receipt.id,
        receipt.receivedAt,
        receipt.status,
        receipt.httpStatus,
        receipt.signaturePresent,
        receipt.payloadObject,
        receipt.entryCount,
        JSON.stringify(receipt.entryFields),
        receipt.parsedComments,
        receipt.parsedMessages,
        receipt.resultSummary,
        receipt.error,
      ],
    );
    await this.pool.query(
      `DELETE FROM webhook_receipts
        WHERE id NOT IN (
          SELECT id FROM webhook_receipts ORDER BY received_at DESC LIMIT 100
        )`,
    );
  }

  async listWebhookReceipts(limit: number): Promise<WebhookReceipt[]> {
    await this.ensureSchema();
    const result = await this.pool.query<PgWebhookReceiptRow>(
      `SELECT id, received_at, status, http_status, signature_present, payload_object,
              entry_count, entry_fields, parsed_comments, parsed_messages, result_summary, error
         FROM webhook_receipts
        ORDER BY received_at DESC
        LIMIT $1`,
      [Math.max(0, limit)],
    );
    return result.rows.map(mapWebhookReceiptRow);
  }

  async tryClaimClick(commentId: string, eventId: string): Promise<CommentRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<PgRow>(
      `UPDATE processed_comments
          SET dm_status = 'checking_follow',
              last_click_event_id = $2,
              error = NULL
        WHERE comment_id = $1
          AND dm_status IN ('prompt_sent', 'follow_prompt_sent')
          AND (last_click_event_id IS DISTINCT FROM $2)
        RETURNING ${PG_COLUMNS}`,
      [commentId, eventId],
    );
    return result.rows[0] ? mapPgRow(result.rows[0]) : null;
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
