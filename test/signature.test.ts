import { describe, expect, it } from 'vitest';
import { safeEqualString, signBody, verifyMetaSignature } from '../lib/signature';

describe('verifyMetaSignature', () => {
  const secret = 'test-app-secret';
  const body = JSON.stringify({ object: 'instagram', entry: [] });

  it('accepts a correctly signed body', () => {
    expect(verifyMetaSignature(body, signBody(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyMetaSignature(`${body} `, signBody(body, secret), secret)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyMetaSignature(body, signBody(body, 'other-secret'), secret)).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, 'md5=abc', secret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=not-hex!', secret)).toBe(false);
    expect(verifyMetaSignature(body, signBody(body, secret), null)).toBe(false);
  });
});

describe('safeEqualString', () => {
  it('compares verify tokens', () => {
    expect(safeEqualString('abc123', 'abc123')).toBe(true);
    expect(safeEqualString('abc123', 'abc124')).toBe(false);
    expect(safeEqualString('abc', 'abcd')).toBe(false);
  });
});
