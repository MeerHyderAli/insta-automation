/**
 * Case-insensitive keyword matching with Unicode-aware word boundaries.
 * "API" matches "api!", "API." and "Use api please" but not "capital".
 */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

export function normalizeForMatch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function keywordMatches(text: string, keyword: string): boolean {
  const normalizedText = normalizeForMatch(text);
  const normalizedKeyword = normalizeForMatch(keyword);
  if (!normalizedKeyword) return false;
  const pattern = normalizedKeyword.split(' ').map(escapeRegex).join('\\s+');
  const regex = new RegExp(`(?<!${WORD_CHAR})${pattern}(?!${WORD_CHAR})`, 'iu');
  return regex.test(normalizedText);
}

/** Returns the first configured keyword that matches, preserving its casing. */
export function matchKeywords(text: string | null, keywords: string[]): string | null {
  if (!text) return null;
  for (const keyword of keywords) {
    if (keywordMatches(text, keyword)) return keyword;
  }
  return null;
}

/** Deduplicates case-insensitively and normalizes internal whitespace. */
export function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keywords) {
    const cleaned = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}
