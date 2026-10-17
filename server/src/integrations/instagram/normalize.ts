export type CommentWebhookField = 'comments' | 'live_comments';

export interface NormalizedComment {
  igAccountId: string;
  field: CommentWebhookField;
  commentId: string;
  mediaId: string | null;
  mediaProductType: string | null;
  commenterIgsid: string | null;
  commenterUsername: string | null;
  text: string | null;
  publishedAt: Date | null;
  raw: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberToDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const ms = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseValue(
  igAccountId: string,
  field: CommentWebhookField,
  value: Record<string, unknown>,
  raw: unknown,
  entryTime: unknown,
): NormalizedComment | null {
  const commentId = asString(value.id);
  if (!commentId) return null;
  const from = asRecord(value.from);
  const media = asRecord(value.media);
  const timestamp = asString(value.timestamp);
  return {
    igAccountId,
    field,
    commentId,
    mediaId: media ? asString(media.id) : null,
    mediaProductType: media ? asString(media.media_product_type) : null,
    commenterIgsid: from ? asString(from.id) : null,
    commenterUsername: from ? asString(from.username) : null,
    text: typeof value.text === 'string' ? value.text : null,
    publishedAt:
      timestamp && !Number.isNaN(Date.parse(timestamp))
        ? new Date(timestamp)
        : numberToDate(entryTime),
    raw,
  };
}

/**
 * Normalizes Instagram Login webhook deliveries. Documented shape:
 * entry[].id / entry[].time / entry[].changes[].field / .value.
 * The flattened entry.field/entry.value variant is accepted defensively for
 * payloads produced by some app configurations.
 */
export function normalizeCommentWebhook(payload: unknown): NormalizedComment[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.entry)) return [];
  const comments: NormalizedComment[] = [];

  for (const rawEntry of root.entry) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    const igAccountId = asString(entry.id);
    if (!igAccountId) continue;

    if (Array.isArray(entry.changes)) {
      for (const rawChange of entry.changes) {
        const change = asRecord(rawChange);
        if (!change) continue;
        const field = change.field;
        if (field !== 'comments' && field !== 'live_comments') continue;
        const value = asRecord(change.value);
        if (!value) continue;
        const parsed = parseValue(igAccountId, field, value, rawChange, entry.time);
        if (parsed) comments.push(parsed);
      }
      continue;
    }

    if (entry.field === 'comments' || entry.field === 'live_comments') {
      const value = asRecord(entry.value);
      if (!value) continue;
      const parsed = parseValue(igAccountId, entry.field, value, rawEntry, entry.time);
      if (parsed) comments.push(parsed);
    }
  }
  return comments;
}

/** Stable, bounded dedupe key. Meta can deliver the same event more than once. */
export function commentDedupeKey(igAccountId: string, field: string, commentId: string): string {
  return `ig:${igAccountId}:${field}:${commentId}`;
}
