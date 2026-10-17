import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 in hex, as used by X-Hub-Signature-256. */
export function hmacSha256Hex(secret: string, payload: Buffer | string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verifies Meta's `X-Hub-Signature-256: sha256=<hex>` header against the raw
 * request body. The raw body must be captured before JSON parsing.
 */
export function verifyHubSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match?.[1]) return false;
  return safeEqualHex(hmacSha256Hex(appSecret, rawBody), match[1]);
}

export interface SignedRequestPayload {
  algorithm?: string;
  user_id?: string;
  issued_at?: number;
  [key: string]: unknown;
}

/**
 * Meta deauthorize / data-deletion callbacks send `signed_request=<sig>.<payload>`
 * where sig is HMAC-SHA256(app secret, payload-b64url), both base64url.
 */
export function verifySignedRequest(
  signedRequest: string | undefined,
  appSecret: string | undefined,
): SignedRequestPayload | null {
  if (!signedRequest || !appSecret) return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedSignature, encodedPayload] = parts;
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url');
  const provided = Buffer.from(encodedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as SignedRequestPayload;
    if (typeof payload !== 'object' || payload === null) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyWebhookChallenge(
  mode: string | undefined,
  provided: string,
  expected: string | null,
): boolean {
  if (mode !== 'subscribe' || !expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
