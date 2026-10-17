import { describe, expect, it } from 'vitest';
import {
  keywordMatches,
  matchKeywords,
  normalizeForMatch,
  normalizeKeywords,
} from '../../src/automation/matcher.js';

describe('keyword matching', () => {
  it('is case-insensitive', () => {
    expect(keywordMatches('API', 'api')).toBe(true);
    expect(keywordMatches('api', 'API')).toBe(true);
    expect(keywordMatches('I need The Guide', 'guide')).toBe(true);
  });

  it('matches whole words, not substrings', () => {
    expect(keywordMatches('API!', 'API')).toBe(true);
    expect(keywordMatches('Use api please', 'API')).toBe(true);
    expect(keywordMatches('capital letters', 'API')).toBe(false);
    expect(keywordMatches('rapid response', 'API')).toBe(false);
  });

  it('supports multi-word keywords with flexible whitespace', () => {
    expect(keywordMatches('free   guide please', 'free guide')).toBe(true);
    expect(keywordMatches('freeguide', 'free guide')).toBe(false);
  });

  it('handles punctuation and Unicode letters at boundaries', () => {
    expect(keywordMatches('«API»', 'API')).toBe(true);
    expect(keywordMatches('pro-mpts', 'pro')).toBe(true); // hyphen is a boundary
    expect(keywordMatches('prompts', 'pro')).toBe(false);
    expect(keywordMatches('prompts', 'PROMPT')).toBe(false);
  });

  it('returns the first configured keyword that matches, preserving its casing', () => {
    expect(matchKeywords('I want the Guide and api', ['API', 'Guide'])).toBe('API');
    expect(matchKeywords('nothing here', ['API'])).toBeNull();
    expect(matchKeywords(null, ['API'])).toBeNull();
  });

  it('normalizes keywords case-insensitively and trims whitespace', () => {
    expect(normalizeKeywords([' API ', 'api', 'Guide', '', 'TOOLS  pack'])).toEqual([
      'API',
      'Guide',
      'TOOLS pack',
    ]);
  });

  it('normalizes NFKC and whitespace for matching', () => {
    expect(normalizeForMatch('  ＡＰＩ   please ')).toBe('api please');
  });
});
