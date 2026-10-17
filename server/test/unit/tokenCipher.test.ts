import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenCipher, tokenAad } from '../../src/lib/crypto/tokenCipher.js';

const key = randomBytes(32).toString('base64');

describe('token encryption', () => {
  it('round-trips a token with account-bound AAD', () => {
    const cipher = new TokenCipher(key, 1);
    const aad = tokenAad('account-1');
    const encrypted = cipher.encrypt('IGQV-super-secret-token', aad);
    expect(encrypted.ciphertext).not.toContain('IGQV');
    expect(cipher.decrypt(encrypted, aad)).toBe('IGQV-super-secret-token');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const cipher = new TokenCipher(key, 1);
    const aad = tokenAad('account-1');
    expect(cipher.encrypt('same', aad).ciphertext).not.toBe(cipher.encrypt('same', aad).ciphertext);
  });

  it('refuses to decrypt with a different account id', () => {
    const cipher = new TokenCipher(key, 1);
    const encrypted = cipher.encrypt('token', tokenAad('account-1'));
    expect(() => cipher.decrypt(encrypted, tokenAad('account-2'))).toThrow();
  });

  it('detects tampering', () => {
    const cipher = new TokenCipher(key, 1);
    const aad = tokenAad('account-1');
    const encrypted = cipher.encrypt('token', aad);
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from('other-token').toString('base64'),
    };
    expect(() => cipher.decrypt(tampered, aad)).toThrow();
  });

  it('rejects a wrong key and unsupported key versions', () => {
    const aad = tokenAad('account-1');
    const encrypted = new TokenCipher(key, 1).encrypt('token', aad);
    expect(() =>
      new TokenCipher(randomBytes(32).toString('base64'), 1).decrypt(encrypted, aad),
    ).toThrow();
    expect(() => new TokenCipher(key, 2).decrypt(encrypted, aad)).toThrow(/key version/i);
    expect(() => new TokenCipher(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
