import pino, { type Logger as PinoLogger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { redactSecrets } from './redact.js';

/**
 * Keys whose values must never reach logs. pino's redaction handles structured
 * fields; `redactSecretsInText` covers free-text (error messages from Meta).
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  'body.password',
  'body.access_token',
  'body.code',
  'password',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'client_secret',
  'clientSecret',
  'appSecret',
  'token',
  'authorization',
  '*.token',
  '*.accessToken',
  '*.access_token',
];

export function redactSecretsInText(value: string): string {
  return redactSecrets(value);
}

export type LoggerLike = Pick<PinoLogger, 'debug' | 'info' | 'warn' | 'error'>;

export function createLogger(level: string, name = 'insta-automation'): PinoLogger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

export function loggerFromConfig(config: Pick<AppConfig, 'logLevel'>): PinoLogger {
  return createLogger(config.logLevel);
}
