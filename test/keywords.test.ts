import { describe, expect, it } from 'vitest';
import { getConfig, parseKeywords } from '../lib/config';
import { findKeyword } from '../lib/keywords';

const KEYWORDS = ['link', 'links', 'lnik', 'likn'];

describe('findKeyword', () => {
  it('matches case-insensitively', () => {
    expect(findKeyword('LINK please!', KEYWORDS)).toBe('link');
    expect(findKeyword('please send the Link', KEYWORDS)).toBe('link');
  });

  it('matches configured typo variants', () => {
    expect(findKeyword('lnik pls', KEYWORDS)).toBe('lnik');
    expect(findKeyword('give me likn', KEYWORDS)).toBe('likn');
  });

  it('matches with emoji and punctuation around the word', () => {
    expect(findKeyword('🔗 link???', KEYWORDS)).toBe('link');
    expect(findKeyword('#link', KEYWORDS)).toBe('link');
  });

  it('does not match inside other words', () => {
    expect(findKeyword('this account is unlinked from that', KEYWORDS)).toBeNull();
    expect(findKeyword('hyperlinkers unite', KEYWORDS)).toBeNull();
  });

  it('supports multi-word phrases', () => {
    expect(findKeyword('send link please', ['send link'])).toBe('send link');
    expect(findKeyword('send the link please', ['send link'])).toBeNull();
  });

  it('returns null for empty text or no match', () => {
    expect(findKeyword('', KEYWORDS)).toBeNull();
    expect(findKeyword('great post!', KEYWORDS)).toBeNull();
  });

  it('ignores accents', () => {
    expect(findKeyword('LÍNK please', KEYWORDS)).toBe('link');
  });
});

describe('parseKeywords', () => {
  it('splits, trims, lowercases and dedupes', () => {
    expect(parseKeywords(' Guide, GUIDE ,prompt ')).toEqual(['guide', 'prompt']);
  });

  it('falls back to defaults when empty', () => {
    expect(parseKeywords('')).toContain('link');
    expect(parseKeywords(undefined)).toContain('link');
  });
});


describe('follow gate config', () => {
  it('requires a verified follow by default', () => {
    expect(getConfig({}).requireFollow).toBe(true);
    expect(getConfig({ REQUIRE_FOLLOW_TO_SEND: 'true' }).requireFollow).toBe(true);
  });

  it('allows an explicit local-testing opt-out', () => {
    expect(getConfig({ REQUIRE_FOLLOW_TO_SEND: 'false' }).requireFollow).toBe(false);
  });
});
