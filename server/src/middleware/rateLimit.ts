import type { RequestHandler } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { RateLimitConfig } from '../config/env.js';
import { errors } from '../lib/errors.js';

function limiter(enabled: boolean, limit: number, windowMs: number): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? '127.0.0.1'),
    handler: (_req, _res, next) => next(errors.rateLimited()),
  });
}

export interface RateLimiters {
  auth: RequestHandler;
  oauth: RequestHandler;
  mutation: RequestHandler;
  webhook: RequestHandler;
}

export function createRateLimiters(config: RateLimitConfig, enabled: boolean): RateLimiters {
  return {
    auth: limiter(enabled, config.authPerMinute, 60_000),
    oauth: limiter(enabled, 20, 60_000),
    mutation: limiter(enabled, config.mutationPerMinute, 60_000),
    webhook: limiter(enabled, config.webhookPerMinute, 60_000),
  };
}
