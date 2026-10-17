const PATTERNS: Array<[RegExp, string]> = [
  [/\bEAA[A-Za-z0-9._-]{10,}/g, '[redacted-token]'],
  [/\bIGQV[A-Za-z0-9._-]{10,}/g, '[redacted-token]'],
  [/(access_token|client_secret|refresh_token|code|signed_request)=([^&\s]+)/gi, '$1=[redacted]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]'],
  [/("access_token"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2'],
];

/** Best-effort scrub for free-text fields (error messages, logs). */
export function redactSecrets(value: string): string {
  return PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}
