import type { ParsedComment, ParsedMessageEvent } from './types';

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
 *         from: { id: "<commenter IGSID>", username: "alice" },
 *         media: { id: "<media id>", media_product_type: "FEED" }
 *       }
 *     }]
 *   }]
 * }
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
      const commentId = asString(value?.id) ?? asString(value?.comment_id);
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

/**
 * Extracts user messaging interactions (quick-reply taps, postbacks and
 * ordinary text) from `entry[].messaging[]`. Echoes of messages sent by the
 * professional account are ignored.
 */
export function parseMessageEvents(payload: unknown): ParsedMessageEvent[] {
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const events: ParsedMessageEvent[] = [];

  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    const igAccountId = asString(entry.id);
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const rawEvent of messaging) {
      const event = asRecord(rawEvent);
      if (!event) continue;

      const senderId = asString(asRecord(event.sender)?.id);
      if (!senderId) continue;

      const message = asRecord(event.message);
      const postback = asRecord(event.postback);
      if (!message && !postback) continue;
      if (message?.is_echo === true || message?.is_deleted === true) continue;

      const quickReply = asRecord(message?.quick_reply);
      const payloadValue = asString(quickReply?.payload) ?? asString(postback?.payload);
      const text =
        typeof message?.text === 'string'
          ? message.text
          : typeof postback?.title === 'string'
            ? postback.title
            : '';
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : null;
      const eventId =
        asString(message?.mid) ??
        asString(postback?.mid) ??
        `${senderId}:${timestamp ?? 'unknown'}:${payloadValue ?? text}`;

      events.push({
        eventId,
        igAccountId,
        senderId,
        recipientId: asString(asRecord(event.recipient)?.id),
        payload: payloadValue,
        text,
        kind: quickReply ? 'quick_reply' : postback ? 'postback' : 'text',
        timestamp,
      });
    }
  }

  return events;
}
