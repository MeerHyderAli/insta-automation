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

export interface SendPrivateReplyInput {
  /** Your Instagram professional account id (webhook entry.id), or "me". */
  igAccountId: string;
  commentId: string;
  message: string;
  accessToken: string;
  graphVersion?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface SendPrivateReplyResult {
  messageId: string | null;
  recipientId: string | null;
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

/**
 * Sends the one private reply Meta allows for a comment.
 *
 * POST https://graph.instagram.com/<version>/<IG_USER_ID>/messages
 *   { "recipient": { "comment_id": "<COMMENT_ID>" },
 *     "message":   { "text": "..." } }
 * -> { "recipient_id": "...", "message_id": "..." }
 *
 * Rules from Meta's docs: at most one message per comment, within 7 days
 * of the comment (for Live, only during the broadcast). Delivery is only
 * treated as confirmed when this call succeeds.
 */
export async function sendPrivateReply(
  input: SendPrivateReplyInput,
): Promise<SendPrivateReplyResult> {
  const version = normalizeGraphVersion(input.graphVersion);
  const url = `https://graph.instagram.com/${version}/${encodeURIComponent(input.igAccountId)}/messages`;
  const fetchFn = input.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { comment_id: input.commentId },
        message: { text: input.message },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Instagram API request timed out'
        : 'Could not reach the Instagram API';
    throw new InstagramApiError(message, 0);
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

export interface GetUserFollowStatusInput {
  /** Instagram-scoped ID (IGSID) for the commenter. */
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
 *
 * GET https://graph.instagram.com/<version>/<IGSID>
 *   ?fields=is_user_follow_business
 *
 * Meta only guarantees profile access after the user has granted messaging
 * consent (for example by messaging the professional account). A comment by
 * itself does not grant that consent. This function therefore returns
 * `unverified` for API/consent errors and missing/non-boolean data instead
 * of guessing whether the person follows the account.
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
