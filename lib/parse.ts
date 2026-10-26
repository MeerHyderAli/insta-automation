import type { ParsedComment } from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;
}

export function isInstagramWebhook(payload: unknown): boolean {
  return asRecord(payload)?.object === 'instagram';
}

/**
 * Extracts comment events from a webhook payload.
 *
 * Documented shape for the `comments` field (Instagram Login):
 * {
 *   object: "instagram",
 *   entry: [{
 *     id: "<IG professional account id>", time: 1234567890,
 *     changes: [{
 *       field: "comments",
 *       value: {
 *         id: "<comment id>", text: "LINK please",
 *         from: { id: "<commenter id>", username: "alice" },
 *         media: { id: "<media id>", media_product_type: "FEED" }
 *       }
 *     }]
 *   }]
 * }
 *
 * Non-comment fields (messages, mentions, ...) are ignored.
 */
export function parseCommentEvents(payload: unknown): ParsedComment[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const comments: ParsedComment[] = [];

  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    const igAccountId = asString(entry.id);
    const timestamp = typeof entry.time === 'number' ? entry.time : null;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const rawChange of changes) {
      const change = asRecord(rawChange);
      if (!change || change.field !== 'comments') continue;
      const value = asRecord(change.value);
      const commentId = asString(value?.id);
      if (!value || !commentId) continue;

      const from = asRecord(value.from);
      const media = asRecord(value.media);
      comments.push({
        commentId,
        igAccountId,
        mediaId: asString(media?.id),
        commenterId: asString(from?.id),
        username: asString(from?.username),
        text: typeof value.text === 'string' ? value.text : '',
        timestamp,
      });
    }
  }

  return comments;
}
