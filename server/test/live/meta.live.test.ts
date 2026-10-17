/**
 * Read-only integration checks against the real Instagram Graph API.
 *
 * These tests are opt-in because they require a real long-lived token and, if
 * writes are enabled, they create real comments/messages on a real account.
 *
 * Required:
 *   LIVE_META_TESTS=1
 *   IG_LIVE_ACCESS_TOKEN=<long-lived Instagram Login token>
 * Optional:
 *   IG_LIVE_USER_ID=<expected professional account id>
 *   META_GRAPH_VERSION=v26.0
 *
 * Explicit opt-in for writes (creates real public/private messages):
 *   LIVE_META_ALLOW_WRITES=1
 *   IG_LIVE_COMMENT_ID=<id of a comment on the account's own media>
 */
import { describe, expect, it } from 'vitest';
import { GraphInstagramProvider } from '../../src/integrations/instagram/graphProvider.js';

const enabled = process.env.LIVE_META_TESTS === '1';
const token = process.env.IG_LIVE_ACCESS_TOKEN ?? '';
const expectedUserId = process.env.IG_LIVE_USER_ID ?? '';
const graphVersion = process.env.META_GRAPH_VERSION ?? 'v26.0';
const writeEnabled =
  enabled && process.env.LIVE_META_ALLOW_WRITES === '1' && Boolean(process.env.IG_LIVE_COMMENT_ID);

function makeProvider(): GraphInstagramProvider {
  if (!token) {
    throw new Error(
      'LIVE_META_TESTS=1 requires IG_LIVE_ACCESS_TOKEN. Do not commit real tokens; export it in your shell.',
    );
  }
  return new GraphInstagramProvider({
    appId: process.env.META_APP_ID ?? 'live-test-app-id',
    appSecret: process.env.META_APP_SECRET ?? 'live-test-app-secret',
    redirectUri:
      process.env.META_REDIRECT_URI ??
      'https://example.invalid/api/integrations/instagram/callback',
    graphVersion,
    scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
  });
}

describe.skipIf(!enabled)('live Instagram Graph API (read-only)', () => {
  it('fetches the connected professional account profile', async () => {
    const provider = makeProvider();
    const profile = await provider.getProfile(token);
    expect(profile.igUserId).toMatch(/^\d{5,}$/);
    expect(profile.username.length).toBeGreaterThan(0);
    if (expectedUserId) expect(profile.igUserId).toBe(expectedUserId);
  });

  it('lists media for the connected account', async () => {
    const provider = makeProvider();
    const profile = await provider.getProfile(token);
    const media = await provider.getMedia(token, profile.igUserId);
    expect(Array.isArray(media)).toBe(true);
    for (const item of media) expect(item.id).toBeTruthy();
  });
});

describe.skipIf(!writeEnabled)('live Instagram Graph API (write opt-in)', () => {
  it('posts a public reply to the configured comment', async () => {
    const provider = makeProvider();
    const commentId = process.env.IG_LIVE_COMMENT_ID!;
    const result = await provider.replyToComment(
      token,
      commentId,
      'Live integration check (automated).',
    );
    expect(result.id).toBeTruthy();
  });
});
