import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashToken,
  hmacSha256Hex,
  randomToken,
  safeEqualHex,
  verifyHubSignature,
  verifySignedRequest,
  verifyWebhookChallenge,
} from '../../src/lib/crypto/signatures.js';

const secret = 'test-app-secret';

describe('X-Hub-Signature-256', () => {
  const body = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }));
  const valid = `sha256=${hmacSha256Hex(secret, body)}`;

  it('accepts a valid signature over the raw body', () => {
    expect(verifyHubSignature(body, valid, secret)).toBe(true);
  });

  it('rejects a modified body or wrong secret', () => {
    expect(verifyHubSignature(Buffer.from('{}'), valid, secret)).toBe(false);
    expect(verifyHubSignature(body, valid, 'other-secret')).toBe(false);
  });

  it('rejects missing, malformed or unprefixed signatures', () => {
    expect(verifyHubSignature(undefined, valid, secret)).toBe(false);
    expect(verifyHubSignature(body, undefined, secret)).toBe(false);
    expect(verifyHubSignature(body, 'deadbeef', secret)).toBe(false);
    expect(verifyHubSignature(body, `sha1=${hmacSha256Hex(secret, body)}`, secret)).toBe(false);
    expect(verifyHubSignature(body, valid, undefined)).toBe(false);
  });

  it('compares equal-length hex strings safely', () => {
    expect(safeEqualHex('00ff', '00ff')).toBe(true);
    expect(safeEqualHex('00ff', '00fe')).toBe(false);
    expect(safeEqualHex('zz', 'zz')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });
});

describe('signed requests', () => {
  it('verifies Meta-style base64url signed requests', () => {
    const payload = Buffer.from(
      JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '12345', issued_at: 1700000000 }),
    ).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    const parsed = verifySignedRequest(`${signature}.${payload}`, secret);
    expect(parsed?.user_id).toBe('12345');
  });

  it('rejects tampering and malformed input', () => {
    const payload = Buffer.from(JSON.stringify({ user_id: '1' })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(verifySignedRequest(`x${signature}.${payload}`, secret)).toBeNull();
    expect(verifySignedRequest(`${signature}.${payload}`, 'wrong')).toBeNull();
    expect(verifySignedRequest('not-a-signed-request', secret)).toBeNull();
    expect(verifySignedRequest(undefined, secret)).toBeNull();
  });
});

describe('webhook challenge and token helpers', () => {
  it('requires subscribe mode and the exact verify token', () => {
    expect(verifyWebhookChallenge('subscribe', 'token-123', 'token-123')).toBe(true);
    expect(verifyWebhookChallenge('subscribe', 'token-124', 'token-123')).toBe(false);
    expect(verifyWebhookChallenge('unsubscribe', 'token-123', 'token-123')).toBe(false);
    expect(verifyWebhookChallenge('subscribe', 'token-123', null)).toBe(false);
  });

  it('creates high-entropy state tokens and stable hashes', () => {
    const token = randomToken(32);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(randomToken(32)));
  });
});
