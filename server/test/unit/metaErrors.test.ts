import { describe, expect, it } from 'vitest';
import {
  classifyMetaError,
  MetaApiError,
  toMetaApiError,
} from '../../src/integrations/instagram/errors.js';
import { redactSecrets } from '../../src/lib/redact.js';

describe('Meta error classification', () => {
  it('classifies rate limits', () => {
    for (const code of [4, 17, 32, 613, 80000, 80006]) {
      expect(classifyMetaError({ message: 'limit', code })).toBe('rate_limited');
    }
  });

  it('classifies transient server and retryable errors', () => {
    expect(classifyMetaError({ message: 'unknown', code: 1 })).toBe('transient');
    expect(classifyMetaError({ message: 'service', code: 2 })).toBe('transient');
    expect(classifyMetaError({ message: 'bad gateway', httpStatus: 502 })).toBe('transient');
  });

  it('classifies token, permission, policy and invalid request errors', () => {
    expect(classifyMetaError({ message: 'expired', code: 190 })).toBe('token');
    expect(classifyMetaError({ message: 'disabled', code: 100, subcode: 459 })).toBe('token');
    expect(classifyMetaError({ message: 'permission', code: 10 })).toBe('permission');
    expect(classifyMetaError({ message: 'capability', code: 3 })).toBe('permission');
    expect(classifyMetaError({ message: 'policy', code: 368 })).toBe('policy');
    expect(classifyMetaError({ message: 'invalid', code: 100 })).toBe('invalid_request');
    expect(classifyMetaError({ message: 'duplicate', code: 506 })).toBe('invalid_request');
  });

  it('only retries transient and rate-limit categories', () => {
    expect(new MetaApiError({ message: 'x', code: 4 }).retryable).toBe(true);
    expect(new MetaApiError({ message: 'x', code: 190 }).retryable).toBe(false);
    expect(new MetaApiError({ message: 'x', code: 368 }).retryable).toBe(false);
    expect(new MetaApiError({ message: 'x', code: 100 }).retryable).toBe(false);
    expect(new MetaApiError({ message: 'x', httpStatus: 500 }).retryable).toBe(true);
  });

  it('never echoes access tokens in error messages', () => {
    const error = toMetaApiError(400, {
      error: {
        message: 'Bad token IGQVJabc1234567890 for access_token=IGQVJabc1234567890',
        code: 190,
        error_subcode: 463,
        fbtrace_id: 'trace-1',
        type: 'OAuthException',
      },
    });
    expect(error.message).not.toContain('IGQVJabc1234567890');
    expect(error.userMessage).toContain('Reconnect');
    expect(error.fbtraceId).toBe('trace-1');
    expect(error.subcode).toBe(463);
  });

  it('redacts common credential shapes in free text', () => {
    const text = redactSecrets(
      'token EAAaverylongtokenvalue12345 and access_token=abc123&code=xyz Bearer abc.def.ghi',
    );
    expect(text).not.toContain('EAAaverylongtokenvalue12345');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('code=xyz');
    expect(text).not.toContain('Bearer abc.def.ghi');
  });
});
