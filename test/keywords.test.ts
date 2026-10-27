import { describe, expect, it } from 'vitest';
import { getConfig, parseKeywords, resolveResourceLink } from '../lib/config';
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
  it('enables both follow checks by default', () => {
    expect(getConfig({})).toMatchObject({
      requireFollowBeforePrompt: true,
      requireFollowForLink: true,
    });
  });

  it('treats legacy REQUIRE_FOLLOW_TO_SEND as the fallback for both checks', () => {
    expect(getConfig({ REQUIRE_FOLLOW_TO_SEND: 'false' })).toMatchObject({
      requireFollowBeforePrompt: false,
      requireFollowForLink: false,
    });
  });

  it('lets the specific second-check flag override the legacy flag', () => {
    expect(
      getConfig({ REQUIRE_FOLLOW_TO_SEND: 'true', REQUIRE_FOLLOW_FOR_LINK: 'false' }),
    ).toMatchObject({ requireFollowBeforePrompt: true, requireFollowForLink: false });
  });

  it('provides the two-step message defaults and caps button titles at 20 chars', () => {
    const config = getConfig({ GET_LINK_BUTTON_TEXT: 'Click here to get the link please' });
    expect(config.introMessage).toContain('Thanks for commenting');
    expect(config.getLinkButtonText).toHaveLength(20);
    expect(config.tryAgainButtonText).toBe('Try again');
  });
});


describe('comment match mode and per-Reel link config', () => {
  it('defaults to keyword mode with a link-template final message', () => {
    expect(getConfig({})).toMatchObject({
      commentMatchMode: 'keywords',
      dmMessage: 'Here is your link: {link}',
      mediaLinks: {},
      mediaLinksConfigError: null,
      defaultLinkUrl: null,
    });
  });

  it('parses any-comment mode and resolves a media-specific link before the fallback', () => {
    const config = getConfig({
      COMMENT_MATCH_MODE: 'ANY',
      MEDIA_LINKS_JSON: '{"media-1":"https://example.com/reel-a"}',
      DEFAULT_LINK_URL: 'https://example.com/default',
    });

    expect(config.commentMatchMode).toBe('any');
    expect(resolveResourceLink(config, 'media-1')).toBe('https://example.com/reel-a');
    expect(resolveResourceLink(config, 'media-2')).toBe('https://example.com/default');
  });

  it('reports invalid per-Reel link JSON instead of guessing', () => {
    const config = getConfig({ MEDIA_LINKS_JSON: 'not-json' });
    expect(config.mediaLinks).toEqual({});
    expect(config.mediaLinksConfigError).toContain('MEDIA_LINKS_JSON');
  });
});
