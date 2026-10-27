import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../lib/config';
import {
  processCommentEvents,
  renderDmMessage,
  type CheckFollowInput,
  type SendDmInput,
} from '../lib/process';
import { FileCommentStore } from '../lib/store';
import type { ParsedComment } from '../lib/types';

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    accessToken: 'test-token',
    appSecret: 'test-secret',
    verifyToken: 'verify-me',
    graphVersion: 'v25.0',
    igAccountId: null,
    keywords: ['link', 'lnik'],
    dmMessage: 'Hey {username}! Here is the link: https://example.com/x',
    requireFollow: false,
    dryRun: false,
    databaseUrl: null,
    dataFile: 'unused.json',
    ...overrides,
  };
}

function testComment(overrides: Partial<ParsedComment> = {}): ParsedComment {
  return {
    commentId: 'comment-1',
    igAccountId: 'ig-1',
    mediaId: 'media-1',
    commenterId: 'user-9',
    username: 'alice',
    text: 'LINK please!',
    timestamp: null,
    ...overrides,
  };
}

function tempStore(): FileCommentStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'comment-process-'));
  return new FileCommentStore(path.join(dir, 'comments.json'));
}

describe('processCommentEvents', () => {
  it('sends exactly one DM for a matching comment, even on redelivery', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-1' }));
    const deps = { store, config: testConfig(), sendDm };

    const first = await processCommentEvents([testComment()], deps);
    const redelivery = await processCommentEvents([testComment()], deps);

    expect(first).toMatchObject({ received: 1, matched: 1, sent: 1, duplicates: 0 });
    expect(redelivery).toMatchObject({ received: 1, sent: 0, duplicates: 1 });
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm.mock.calls[0][0]).toMatchObject({
      igAccountId: 'ig-1',
      commentId: 'comment-1',
      message: 'Hey @alice! Here is the link: https://example.com/x',
    });

    const [record] = await store.list(50);
    expect(record.dmStatus).toBe('sent');
    expect(record.dmMessageId).toBe('mid-1');
    expect(record.matchedKeyword).toBe('link');
  });

  it('sends only after Meta verifies the commenter follows the account', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-follower' }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'following' as const,
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-follower' })],
      { store, config: testConfig({ requireFollow: true }), sendDm, checkFollow },
    );

    expect(summary).toMatchObject({ matched: 1, sent: 1, skippedNotFollowing: 0 });
    expect(checkFollow).toHaveBeenCalledWith({
      igsid: 'user-9',
      accessToken: 'test-token',
      graphVersion: 'v25.0',
    });
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'sent',
      followStatus: 'following',
    });
  });

  it('does not send when Meta reports the commenter is not a follower', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'must-not-send' }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'not_following' as const,
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-nonfollower' })],
      { store, config: testConfig({ requireFollow: true }), sendDm, checkFollow },
    );

    expect(summary).toMatchObject({ matched: 1, sent: 0, skippedNotFollowing: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'skipped_not_following',
      followStatus: 'not_following',
    });
  });

  it('fails closed when follow status cannot be verified', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'must-not-send' }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'unverified' as const,
      error: 'User consent is required to access user profile',
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-unverified' })],
      { store, config: testConfig({ requireFollow: true }), sendDm, checkFollow },
    );

    expect(summary).toMatchObject({ matched: 1, sent: 0, skippedFollowUnverified: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'skipped_follow_unverified',
      followStatus: 'unverified',
      error: 'User consent is required to access user profile',
    });
  });

  it('does not treat a DRY_RUN simulated comment as a verified follower', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'must-not-send' }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-dry-gated' })],
      { store, config: testConfig({ requireFollow: true, dryRun: true }), sendDm },
    );

    expect(summary).toMatchObject({ matched: 1, sent: 0, dryRun: 0, skippedFollowUnverified: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0].dmStatus).toBe('skipped_follow_unverified');
  });

  it('records but does not DM comments without a keyword', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-1' }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-2', text: 'Great reel!' })],
      { store, config: testConfig(), sendDm },
    );

    expect(summary).toMatchObject({ matched: 0, sent: 0, notMatched: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0].dmStatus).toBe('not_matched');
  });

  it('matches typo variants case-insensitively', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-2' }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-3', text: 'pls send LNIK' })],
      { store, config: testConfig(), sendDm },
    );

    expect(summary).toMatchObject({ matched: 1, sent: 1 });
    expect((await store.list(50))[0].matchedKeyword).toBe('lnik');
  });

  it('dry run records the match without calling the sender', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-3' }));

    const summary = await processCommentEvents([testComment({ commentId: 'comment-4' })], {
      store,
      config: testConfig({ dryRun: true }),
      sendDm,
    });

    expect(summary).toMatchObject({ matched: 1, sent: 0, dryRun: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0].dmStatus).toBe('dry_run');
  });

  it('skips comments from the account owner', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-4' }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-5', commenterId: 'ig-1' })],
      { store, config: testConfig(), sendDm },
    );

    expect(summary).toMatchObject({ sent: 0, skippedOwn: 1 });
    expect((await store.list(50))[0].dmStatus).toBe('skipped_own_comment');
  });

  it('fails cleanly (no fake success) when the token is missing', async () => {
    const store = tempStore();
    const summary = await processCommentEvents([testComment({ commentId: 'comment-6' })], {
      store,
      config: testConfig({ accessToken: null }),
      sendDm: vi.fn(async (_input: SendDmInput) => ({ messageId: 'mid-5' })),
    });

    expect(summary).toMatchObject({ matched: 1, sent: 0, failed: 1 });
    const [record] = await store.list(50);
    expect(record.dmStatus).toBe('failed');
    expect(record.error).toContain('IG_ACCESS_TOKEN');
  });

  it('records an Instagram API failure as failed, not sent', async () => {
    const store = tempStore();
    const summary = await processCommentEvents([testComment({ commentId: 'comment-7' })], {
      store,
      config: testConfig(),
      sendDm: vi.fn(async (_input: SendDmInput) => {
        throw new Error('Instagram API error 10: permission denied');
      }),
    });

    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    expect((await store.list(50))[0].dmStatus).toBe('failed');
  });
});

describe('renderDmMessage', () => {
  it('fills placeholders and caps length at 1000 chars', () => {
    expect(renderDmMessage('Hi {username}, key={keyword}', { username: 'bob', keyword: 'link' }))
      .toBe('Hi @bob, key=link');
    expect(renderDmMessage('x'.repeat(1200), { username: null, keyword: null })).toHaveLength(1000);
  });
});
