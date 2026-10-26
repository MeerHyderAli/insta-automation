/**
 * Case-insensitive, whole-word keyword matching.
 *
 * "Whole word" means the keyword `link` matches "Link please!" and "🔗 LINK"
 * but not "unlinked". Typo variants are just more keywords, which keeps
 * matching predictable and testable (no fuzzy-distance surprises).
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: lí­nk -> link
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

export function tokenize(normalizedText: string): string[] {
  return normalizedText.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseMatches(normalizedText: string, normalizedPhrase: string): boolean {
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(normalizedPhrase)}($|[^\\p{L}\\p{N}_])`,
    'u',
  );
  return pattern.test(normalizedText);
}

/**
 * Returns the first configured keyword (in config order) that appears in the
 * comment, or null when nothing matches.
 */
export function findKeyword(text: string, keywords: string[]): string | null {
  if (!text.trim() || keywords.length === 0) return null;
  const normalizedText = normalizeForMatch(text);
  const tokens = new Set(tokenize(normalizedText));

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeForMatch(keyword).trim();
    if (!normalizedKeyword) continue;
    if (normalizedKeyword.includes(' ')) {
      if (phraseMatches(normalizedText, normalizedKeyword)) return keyword;
    } else if (tokens.has(normalizedKeyword)) {
      return keyword;
    }
  }
  return null;
}
