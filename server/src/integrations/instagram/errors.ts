import { redactSecrets } from '../../lib/redact.js';

export type MetaErrorCategory =
  'rate_limited' | 'transient' | 'token' | 'permission' | 'policy' | 'invalid_request' | 'unknown';

export interface MetaErrorDetails {
  message: string;
  type?: string;
  code?: number;
  subcode?: number;
  fbtraceId?: string;
  httpStatus?: number;
}

/**
 * Meta Graph errors are classified against the official error-handling guide
 * (https://developers.facebook.com/docs/graph-api/guides/error-handling).
 * `retryable` is true only for transient/rate-limit categories.
 */
export class MetaApiError extends Error {
  readonly category: MetaErrorCategory;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly httpStatus?: number;

  constructor(details: MetaErrorDetails) {
    super(redactSecrets(details.message).slice(0, 500));
    this.name = 'MetaApiError';
    this.type = details.type;
    this.code = details.code;
    this.subcode = details.subcode;
    this.fbtraceId = details.fbtraceId;
    this.httpStatus = details.httpStatus;
    this.category = classifyMetaError(details);
  }

  get retryable(): boolean {
    return this.category === 'transient' || this.category === 'rate_limited';
  }

  /** Safe to show a workspace user; never contains the access token. */
  get userMessage(): string {
    switch (this.category) {
      case 'rate_limited':
        return 'Instagram rate limit reached. This will be retried automatically.';
      case 'token':
        return 'The Instagram connection has expired or was revoked. Reconnect the account.';
      case 'permission':
        return 'Instagram denied the action. The account is missing a required permission or app review approval.';
      case 'policy':
        return 'Instagram blocked this action under its platform policies.';
      case 'invalid_request':
        return 'Instagram rejected the request because it is no longer valid.';
      case 'transient':
        return 'Instagram is temporarily unavailable. This will be retried automatically.';
      default:
        return 'Instagram returned an unexpected error.';
    }
  }
}

export function classifyMetaError(details: MetaErrorDetails): MetaErrorCategory {
  const code = details.code;
  const subcode = details.subcode;
  const type = (details.type ?? '').toLowerCase();

  if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limited';
  if (code !== undefined && code >= 80000 && code <= 80006) return 'rate_limited';
  if (code === 1 || code === 2) return 'transient';
  if (details.httpStatus !== undefined && details.httpStatus >= 500) return 'transient';

  const tokenSubcodes = new Set([458, 459, 460, 463, 464, 467, 492]);
  if (
    code === 190 ||
    code === 102 ||
    (subcode !== undefined && tokenSubcodes.has(subcode)) ||
    type.includes('oauthexception')
  ) {
    return 'token';
  }
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299) || code === 3) {
    return 'permission';
  }
  if (code === 368) return 'policy';
  if (code === 100 || code === 506) return 'invalid_request';
  return 'unknown';
}

export function toMetaApiError(
  httpStatus: number,
  body: unknown,
  fallbackMessage = 'Instagram request failed.',
): MetaApiError {
  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  const message = typeof error?.message === 'string' ? error.message : fallbackMessage;
  return new MetaApiError({
    message,
    type: typeof error?.type === 'string' ? error.type : undefined,
    code: typeof error?.code === 'number' ? error.code : undefined,
    subcode: typeof error?.error_subcode === 'number' ? error.error_subcode : undefined,
    fbtraceId: typeof error?.fbtrace_id === 'string' ? error.fbtrace_id : undefined,
    httpStatus,
  });
}
