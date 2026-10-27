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
