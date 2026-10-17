export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'CAPABILITY_UNAVAILABLE',
  'NOT_CONFIGURED',
  'RECONNECT_REQUIRED',
  'PERMISSION_MISSING',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_VERIFY_FAILED',
  'META_RATE_LIMITED',
  'META_API_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;
  override readonly cause?: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? true;
    this.cause = options.cause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const errors = {
  unauthenticated(message = 'Sign in to continue.'): AppError {
    return new AppError(401, 'UNAUTHENTICATED', message);
  },
  forbidden(message = 'You do not have permission to do that.'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  },
  notFound(message = 'Not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  },
  validation(message = 'Invalid request.', details?: unknown): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, { details });
  },
  conflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'CONFLICT', message, { details });
  },
  rateLimited(message = 'Too many requests. Try again shortly.'): AppError {
    return new AppError(429, 'RATE_LIMITED', message);
  },
  quotaExceeded(message: string, details?: unknown): AppError {
    return new AppError(429, 'QUOTA_EXCEEDED', message, { details });
  },
  capabilityUnavailable(message: string, details?: unknown): AppError {
    return new AppError(422, 'CAPABILITY_UNAVAILABLE', message, { details });
  },
  notConfigured(message = 'This integration is not configured.'): AppError {
    return new AppError(503, 'NOT_CONFIGURED', message);
  },
  reconnectRequired(message: string): AppError {
    return new AppError(409, 'RECONNECT_REQUIRED', message);
  },
  permissionMissing(message: string, details?: unknown): AppError {
    return new AppError(403, 'PERMISSION_MISSING', message, { details });
  },
  metaRateLimited(message = 'Instagram rate limit reached. Retry later.'): AppError {
    return new AppError(429, 'META_RATE_LIMITED', message);
  },
  metaApi(message = 'Instagram rejected the request.'): AppError {
    return new AppError(502, 'META_API_ERROR', message);
  },
  webhookSignatureInvalid(): AppError {
    return new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  },
  webhookVerifyFailed(): AppError {
    return new AppError(403, 'WEBHOOK_VERIFY_FAILED', 'Webhook verification failed.');
  },
  internal(message = 'Something went wrong.', cause?: unknown): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message, { expose: false, cause });
  },
};

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}
