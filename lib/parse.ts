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

function asTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rootRecords(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }
  const record = asRecord(payload);
  return record ? [record] : [];
}

export function isInstagramWebhook(payload: unknown): boolean {
  return rootRecords(payload).some((root) => root.object === 'instagram');
}

/**
 * Extracts comment events from a webhook payload.
 *
 * Meta documents two wrappers for the same comment value:
 *
 * - Business Login for Instagram (the setup used by this app) puts
 *   `field: "comments"` and `value: { ... }` directly on each `entry`.
 * - Facebook Login payloads put the same objects in `entry.changes[]`.
 *
 * Support both so a valid Instagram Login notification is never silently
 * ignored just because it does not use the Facebook Login wrapper.
 */
export function parseCommentEvents(payload: unknown): ParsedComment[] {
  const comments: ParsedComment[] = [];
  const seenCommentIds = new Set<string>();

  const addCommentValue = (
    rawValue: unknown,
    igAccountId: string | null,
    timestamp: number | null,
  ) => {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const rawItem of values) {
      const value = asRecord(rawItem);
      const commentId = asString(value?.id) ?? asString(value?.comment_id);
      if (!value || !commentId || seenCommentIds.has(commentId)) continue;
      seenCommentIds.add(commentId);

      const from = asRecord(value.from);
      const media = asRecord(value.media);
      comments.push({
        commentId,
        igAccountId,
        mediaId: asString(media?.id) ?? asString(value.media_id),
        commenterId:
          asString(from?.id) ?? asString(value.sender_id) ?? asString(value.from),
        username: asString(from?.username) ?? asString(value.username),
        text: typeof value.text === 'string' ? value.text : '',
        timestamp,
      });
    }
  };

  for (const root of rootRecords(payload)) {
    const entries = Array.isArray(root.entry) ? root.entry : [];

    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      if (!entry) continue;
      const igAccountId = asString(entry.id);
      const timestamp = asTimestamp(entry.time);

      // Instagram Login shape: entry.field + entry.value.
      if (entry.field === 'comments') {
        addCommentValue(entry.value, igAccountId, timestamp);
      }

      // Facebook Login / generic Webhooks shape: entry.changes[].
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const rawChange of changes) {
        const change = asRecord(rawChange);
        if (!change || change.field !== 'comments') continue;
        addCommentValue(change.value, igAccountId, timestamp);
      }
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
  const entries = rootRecords(payload).flatMap((root) =>
    Array.isArray(root.entry) ? root.entry : [],
  );
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
      const timestamp = asTimestamp(event.timestamp);
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
