import { normalizeGraphVersion } from './config';

export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'InstagramApiError';
  }
}

export interface QuickReplyInput {
  title: string;
  payload: string;
}

interface BaseSendMessageInput {
  /** Your Instagram professional account id (webhook entry.id), or "me". */
  igAccountId: string;
  message: string;
  quickReplies?: QuickReplyInput[];
  accessToken: string;
  graphVersion?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface SendPrivateReplyInput extends BaseSendMessageInput {
  commentId: string;
}

export interface SendUserMessageInput extends BaseSendMessageInput {
  recipientId: string;
}

export interface SendMessageResult {
  messageId: string | null;
  recipientId: string | null;
}

export type SendPrivateReplyResult = SendMessageResult;

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

type Recipient = { comment_id: string } | { id: string };

async function postInstagramMessage(
  input: BaseSendMessageInput & { recipient: Recipient },
): Promise<SendMessageResult> {
  const version = normalizeGraphVersion(input.graphVersion);
  const url = `https://graph.instagram.com/${version}/${encodeURIComponent(input.igAccountId)}/messages`;
  const fetchFn = input.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);

  const message: Record<string, unknown> = { text: input.message };
  if (input.quickReplies?.length) {
    message.quick_replies = input.quickReplies.map((quickReply) => ({
      content_type: 'text',
      title: quickReply.title.slice(0, 20),
      payload: quickReply.payload,
    }));
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient: input.recipient, message }),
      signal: controller.signal,
    });
  } catch (error) {
    const messageText =
      error instanceof Error && error.name === 'AbortError'
        ? 'Instagram API request timed out'
        : 'Could not reach the Instagram API';
    throw new InstagramApiError(messageText, 0);
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    // Non-JSON body handled below via status.
  }

  if (!response.ok) {
    const errorObj =
      typeof payload.error === 'object' && payload.error !== null
        ? (payload.error as Record<string, unknown>)
        : {};
    const apiMessage =
      typeof errorObj.message === 'string' ? errorObj.message : `HTTP ${response.status}`;
    const code = typeof errorObj.code === 'number' ? errorObj.code : undefined;
    throw new InstagramApiError(
      redact(`Instagram API error${code ? ` ${code}` : ''}: ${apiMessage}`, input.accessToken).slice(0, 300),
      response.status,
      code,
    );
  }

  return {
    messageId: typeof payload.message_id === 'string' ? payload.message_id : null,
    recipientId: typeof payload.recipient_id === 'string' ? payload.recipient_id : null,
  };
}

/**
 * Sends the one private reply Meta allows for a comment. In this app that
 * first message is the thank-you prompt with a quick-reply button.
 */
export async function sendPrivateReply(
  input: SendPrivateReplyInput,
): Promise<SendPrivateReplyResult> {
  return postInstagramMessage({
    ...input,
    recipient: { comment_id: input.commentId },
  });
}

/**
 * Sends a normal conversation message to an IGSID. This is used only after
 * the user taps the prompt button / sends a message, which opens the
 * standard messaging window for the follow-up.
 */
export async function sendMessageToUser(
  input: SendUserMessageInput,
): Promise<SendMessageResult> {
  return postInstagramMessage({
    ...input,
    recipient: { id: input.recipientId },
  });
}

export interface GetUserFollowStatusInput {
  /** Instagram-scoped ID (IGSID) for the commenter/message sender. */
  igsid: string;
  accessToken: string;
  graphVersion?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type FollowCheckResult =
  | { status: 'following' | 'not_following' }
  | { status: 'unverified'; error: string };

function followCheckError(payload: Record<string, unknown>, status: number, token: string): string {
  const errorObj =
    typeof payload.error === 'object' && payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : {};
  const apiMessage =
    typeof errorObj.message === 'string' ? errorObj.message : `HTTP ${status}`;
  const code = typeof errorObj.code === 'number' ? errorObj.code : undefined;
  return redact(
    `Instagram profile API error${code ? ` ${code}` : ''}: ${apiMessage}`,
    token,
  ).slice(0, 300);
}

/**
 * Reads the official `is_user_follow_business` profile field for an IGSID.
 * Returns `unverified` for consent/API errors and missing/non-boolean data
 * instead of guessing whether the person follows the account.
 */
export async function getUserFollowStatus(
  input: GetUserFollowStatusInput,
): Promise<FollowCheckResult> {
  const version = normalizeGraphVersion(input.graphVersion);
  const params = new URLSearchParams({ fields: 'is_user_follow_business' });
  const url = `https://graph.instagram.com/${version}/${encodeURIComponent(input.igsid)}?${params}`;
  const fetchFn = input.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: controller.signal,
    });
  } catch (error) {
    return {
      status: 'unverified',
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Instagram profile API request timed out'
          : 'Could not reach the Instagram profile API',
    };
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return {
      status: 'unverified',
      error: `Instagram profile API returned a non-JSON response (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    return {
      status: 'unverified',
      error: followCheckError(payload, response.status, input.accessToken),
    };
  }

  if (payload.is_user_follow_business === true) return { status: 'following' };
  if (payload.is_user_follow_business === false) return { status: 'not_following' };

  return {
    status: 'unverified',
    error: 'Instagram profile API did not return is_user_follow_business as a boolean',
  };
}


export interface InstagramMediaSummary {
  id: string;
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  shortcode: string | null;
  timestamp: string | null;
  username: string | null;
  commentsCount: number | null;
  likeCount: number | null;
}

export interface ListOwnMediaInput {
  /** Professional account id, or "me" for the token's account. */
  igAccountId?: string | null;
  accessToken: string;
  graphVersion?: string;
  limit?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function apiErrorMessage(
  payload: Record<string, unknown>,
  status: number,
  token: string,
  prefix: string,
): string {
  const errorObj =
    typeof payload.error === 'object' && payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : {};
  const apiMessage =
    typeof errorObj.message === 'string' ? errorObj.message : `HTTP ${status}`;
  const code = typeof errorObj.code === 'number' ? errorObj.code : undefined;
  return redact(`${prefix}${code ? ` ${code}` : ''}: ${apiMessage}`, token).slice(0, 300);
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const rawText = await response.text();
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Lists recent media owned by the token's Instagram professional account.
 * The dashboard uses this to show Reels/posts (with media IDs) before any
 * comment webhook has arrived, so resources can be mapped in advance.
 */
export async function listOwnMedia(input: ListOwnMediaInput): Promise<InstagramMediaSummary[]> {
  const version = normalizeGraphVersion(input.graphVersion);
  const accountId = encodeURIComponent(input.igAccountId?.trim() || 'me');
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 25)));
  const fetchFn = input.fetchFn ?? fetch;
  const fieldSets = [
    'id,comments_count,like_count,media_type,media_url,permalink,shortcode,thumbnail_url,timestamp,username',
    'id,media_type,media_url,permalink,thumbnail_url,timestamp',
    'id,media_type,timestamp',
  ];

  let lastError: InstagramApiError | null = null;
  for (const fields of fieldSets) {
    const params = new URLSearchParams({ fields, limit: String(limit) });
    const url = `https://graph.instagram.com/${version}/${accountId}/media?${params}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.accessToken}` },
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      throw new InstagramApiError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Instagram media API request timed out'
          : 'Could not reach the Instagram media API',
        0,
      );
    } finally {
      clearTimeout(timeout);
    }

    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const code =
        typeof (payload.error as Record<string, unknown> | undefined)?.code === 'number'
          ? ((payload.error as Record<string, unknown>).code as number)
          : undefined;
      lastError = new InstagramApiError(
        apiErrorMessage(payload, response.status, input.accessToken, 'Instagram media API error'),
        response.status,
        code,
      );
      // A reduced field set can succeed if this login type/app version does
      // not expose one of the optional display fields above. Other errors
      // (notably an invalid/expired token) will fail the same way, so stop.
      if (code !== 100) throw lastError;
      continue;
    }

    const data = Array.isArray(payload.data) ? payload.data : [];
    return data.flatMap((raw) => {
      if (typeof raw !== 'object' || raw === null) return [];
      const item = raw as Record<string, unknown>;
      const id = asOptionalString(item.id);
      if (!id) return [];
      return [
        {
          id,
          mediaType: asOptionalString(item.media_type),
          mediaUrl: asOptionalString(item.media_url),
          thumbnailUrl: asOptionalString(item.thumbnail_url),
          permalink: asOptionalString(item.permalink),
          shortcode: asOptionalString(item.shortcode),
          timestamp: asOptionalString(item.timestamp),
          username: asOptionalString(item.username),
          commentsCount: asOptionalNumber(item.comments_count),
          likeCount: asOptionalNumber(item.like_count),
        },
      ];
    });
  }

  throw lastError ?? new InstagramApiError('Instagram media API returned no usable response', 0);
}

export interface SubscribeInstagramWebhooksInput {
  accessToken: string;
  graphVersion?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Subscribes the token's Instagram professional account to this app's
 * comment/message webhooks. This is the account-level companion to the
 * app-level callback configured in the Meta dashboard.
 */
export async function subscribeInstagramWebhooks(
  input: SubscribeInstagramWebhooksInput,
): Promise<void> {
  const version = normalizeGraphVersion(input.graphVersion);
  const params = new URLSearchParams({
    subscribed_fields: 'comments,messages,messaging_postbacks',
  });
  const url = `https://graph.instagram.com/${version}/me/subscribed_apps?${params}`;
  const fetchFn = input.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: controller.signal,
    });
  } catch (error) {
    throw new InstagramApiError(
      error instanceof Error && error.name === 'AbortError'
        ? 'Instagram webhook subscription request timed out'
        : 'Could not reach the Instagram webhook subscription API',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await readJsonResponse(response);
  if (!response.ok || payload.success !== true) {
    throw new InstagramApiError(
      apiErrorMessage(
        payload,
        response.status,
        input.accessToken,
        'Instagram webhook subscription error',
      ),
      response.status,
      typeof (payload.error as Record<string, unknown> | undefined)?.code === 'number'
        ? ((payload.error as Record<string, unknown>).code as number)
        : undefined,
    );
  }
}
