import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * AES-256-GCM encryption for Instagram access tokens. The account id is used
 * as additional authenticated data so a ciphertext cannot be moved between
 * rows. Keys are versioned to allow rotation.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(
    keyBase64: string,
    private readonly keyVersion = 1,
  ) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64.');
    }
    this.key = key;
  }

  encrypt(plaintext: string, aad: string): EncryptedToken {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(token: EncryptedToken, aad: string): string {
    if (token.keyVersion !== this.keyVersion) {
      throw new Error('Token was encrypted with a different key version.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(token.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(token.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(token.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export function tokenAad(accountId: string): string {
  return `instagram_account:${accountId}`;
}
