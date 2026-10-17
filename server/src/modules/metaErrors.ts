import { AppError, errors } from '../lib/errors.js';
import { MetaApiError } from '../integrations/instagram/errors.js';

/**
 * Converts an integration error into a safe API error. Raw Meta messages are
 * never returned to the browser (they can contain request echoes); only the
 * user-facing summary and non-sensitive error identifiers are included.
 */
export function metaErrorToAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!(error instanceof MetaApiError)) {
    return errors.internal('The Instagram request failed.');
  }
  const details = {
    code: error.code ?? null,
    subcode: error.subcode ?? null,
    fbtraceId: error.fbtraceId ?? null,
    category: error.category,
  };
  switch (error.category) {
    case 'token':
      return new AppError(409, 'RECONNECT_REQUIRED', error.userMessage, { details });
    case 'permission':
      return new AppError(403, 'PERMISSION_MISSING', error.userMessage, { details });
    case 'rate_limited':
      return new AppError(429, 'META_RATE_LIMITED', error.userMessage, { details });
    case 'transient':
      return new AppError(503, 'META_API_ERROR', error.userMessage, { details });
    case 'policy':
    case 'invalid_request':
      return new AppError(422, 'META_API_ERROR', error.userMessage, { details });
    default:
      return new AppError(502, 'META_API_ERROR', error.userMessage, { details });
  }
}
