import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Signs a raw body the way Meta does. Used by tests and the simulate script. */
export function signBody(rawBody: string, appSecret: string): string {
  const digest = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Verifies `X-Hub-Signature-256: sha256=<HMAC-SHA256(raw body, app secret)>`.
 * The comparison is constant-time. Never parse/re-serialize the JSON first —
 * the signature covers the exact raw bytes Meta sent.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | null | undefined,
): boolean {
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = Buffer.from(signBody(rawBody, appSecret).slice('sha256='.length), 'hex');
  const providedHex = signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  const provided = Buffer.from(providedHex, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Constant-time string comparison that does not leak length. */
export function safeEqualString(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}
