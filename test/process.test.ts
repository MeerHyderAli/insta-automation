import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../lib/config';
import type { FollowCheckResult } from '../lib/instagram';
import {
  processCommentEvents,
  processMessageEvents,
  renderDmMessage,
  type CheckFollowInput,
  type SendDmInput,
  type SendUserDmInput,
} from '../lib/process';
import { FileCommentStore } from '../lib/store';
import { GET_LINK_PAYLOAD, type ParsedComment, type ParsedMessageEvent } from '../lib/types';

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    accessToken: 'test-token',
    appSecret: 'test-secret',
    verifyToken: 'verify-me',
    graphVersion: 'v25.0',
    igAccountId: null,
    keywords: ['link', 'lnik'],
    introMessage: 'Thanks for commenting, {username}! Tap the button below to get your link.',
    dmMessage: 'Here is your link: https://example.com/x',
    notFollowingMessage: 'Please follow this account, then tap Try again.',
    followUnverifiedMessage: 'I could not verify your follow yet. Please tap Try again.',
    getLinkButtonText: 'Click to get link',
    tryAgainButtonText: 'Try again',
    requireFollowBeforePrompt: false,
    requireFollowForLink: false,
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

function testClick(overrides: Partial<ParsedMessageEvent> = {}): ParsedMessageEvent {
  return {
    eventId: 'click-1',
    igAccountId: 'ig-1',
    senderId: 'user-9',
    recipientId: 'ig-1',
    payload: GET_LINK_PAYLOAD,
    text: 'Click to get link',
    kind: 'quick_reply',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function tempStore(): FileCommentStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'comment-process-'));
  return new FileCommentStore(path.join(dir, 'comments.json'));
}

describe('processCommentEvents — first follow check + prompt', () => {
  it('sends exactly one thanks prompt with a Get Link button, even on redelivery', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-1',
      recipientId: 'user-9',
    }));
    const deps = { store, config: testConfig(), sendDm };

    const first = await processCommentEvents([testComment()], deps);
    const redelivery = await processCommentEvents([testComment()], deps);

    expect(first).toMatchObject({ received: 1, matched: 1, promptSent: 1, duplicates: 0 });
    expect(redelivery).toMatchObject({ received: 1, promptSent: 0, duplicates: 1 });
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm.mock.calls[0][0]).toMatchObject({
      igAccountId: 'ig-1',
      commentId: 'comment-1',
      message: 'Thanks for commenting, @alice! Tap the button below to get your link.',
      quickReplyTitle: 'Click to get link',
      quickReplyPayload: GET_LINK_PAYLOAD,
    });
    expect(sendDm.mock.calls[0][0].message).not.toContain('https://example.com/x');

    const [record] = await store.list(50);
    expect(record).toMatchObject({
      dmStatus: 'prompt_sent',
      dmMessageId: 'prompt-1',
      commenterId: 'user-9',
      matchedKeyword: 'link',
    });
  });

  it('sends the prompt only after follow check #1 verifies a follower', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-follower',
      recipientId: 'user-9',
    }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'following' as const,
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-follower' })],
      {
        store,
        config: testConfig({ requireFollowBeforePrompt: true, requireFollowForLink: true }),
        sendDm,
        checkFollow,
      },
    );

    expect(summary).toMatchObject({ matched: 1, promptSent: 1, skippedNotFollowing: 0 });
    expect(checkFollow).toHaveBeenCalledTimes(1);
    expect(checkFollow).toHaveBeenCalledWith({
      igsid: 'user-9',
      accessToken: 'test-token',
      graphVersion: 'v25.0',
    });
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'prompt_sent',
      followStatus: 'following',
    });
  });

  it('does not send even the prompt when check #1 reports not following', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'must-not-send' }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'not_following' as const,
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-nonfollower' })],
      {
        store,
        config: testConfig({ requireFollowBeforePrompt: true, requireFollowForLink: true }),
        sendDm,
        checkFollow,
      },
    );

    expect(summary).toMatchObject({ matched: 1, promptSent: 0, skippedNotFollowing: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'skipped_not_following',
      followStatus: 'not_following',
    });
  });

  it('fails closed at check #1 when follow status cannot be verified', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'must-not-send' }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'unverified' as const,
      error: 'User consent is required to access user profile',
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-unverified' })],
      {
        store,
        config: testConfig({ requireFollowBeforePrompt: true, requireFollowForLink: true }),
        sendDm,
        checkFollow,
      },
    );

    expect(summary).toMatchObject({ matched: 1, promptSent: 0, skippedFollowUnverified: 1 });
    expect(sendDm).not.toHaveBeenCalled();
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'skipped_follow_unverified',
      followStatus: 'unverified',
      error: 'User consent is required to access user profile',
    });
  });

  it('does not treat a DRY_RUN simulated comment as passing check #1', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'must-not-send' }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-dry-gated' })],
      {
        store,
        config: testConfig({
          requireFollowBeforePrompt: true,
          requireFollowForLink: true,
          dryRun: true,
        }),
        sendDm,
      },
    );

    expect(summary).toMatchObject({ matched: 1, promptSent: 0, skippedFollowUnverified: 1 });
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('records but does not prompt comments without a keyword', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'prompt-1' }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-2', text: 'Great reel!' })],
      { store, config: testConfig(), sendDm },
    );

    expect(summary).toMatchObject({ matched: 0, promptSent: 0, notMatched: 1 });
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('matches typo variants case-insensitively', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-2',
      recipientId: 'user-9',
    }));

    const summary = await processCommentEvents(
      [testComment({ commentId: 'comment-3', text: 'pls send LNIK' })],
      { store, config: testConfig(), sendDm },
    );

    expect(summary).toMatchObject({ matched: 1, promptSent: 1 });
    expect((await store.list(50))[0].matchedKeyword).toBe('lnik');
  });

  it('dry run records the match without calling any sender', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'prompt-3' }));

    const summary = await processCommentEvents([testComment({ commentId: 'comment-4' })], {
      store,
      config: testConfig({ dryRun: true }),
      sendDm,
    });

    expect(summary).toMatchObject({ matched: 1, promptSent: 0, dryRun: 1 });
    expect(sendDm).not.toHaveBeenCalled();
  });

  it('skips comments from the account owner and fails cleanly without a token', async () => {
    const store = tempStore();
    const sendDm = vi.fn(async (_input: SendDmInput) => ({ messageId: 'prompt-4' }));

    const own = await processCommentEvents(
      [testComment({ commentId: 'comment-5', commenterId: 'ig-1' })],
      { store, config: testConfig(), sendDm },
    );
    const noToken = await processCommentEvents([testComment({ commentId: 'comment-6' })], {
      store,
      config: testConfig({ accessToken: null }),
      sendDm,
    });

    expect(own).toMatchObject({ promptSent: 0, skippedOwn: 1 });
    expect(noToken).toMatchObject({ matched: 1, promptSent: 0, failed: 1 });
    expect(sendDm).not.toHaveBeenCalled();
  });
});

describe('processMessageEvents — second follow check after button tap', () => {
  it('checks follow TWICE: before the prompt and again before the link', async () => {
    const store = tempStore();
    const config = testConfig({
      requireFollowBeforePrompt: true,
      requireFollowForLink: true,
    });
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-1',
      recipientId: 'user-9',
    }));
    const sendUserDm = vi.fn(async (_input: SendUserDmInput) => ({
      messageId: 'link-1',
      recipientId: 'user-9',
    }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'following' as const,
    }));
    const deps = { store, config, sendDm, sendUserDm, checkFollow };

    await processCommentEvents([testComment()], deps);
    const summary = await processMessageEvents([testClick()], deps);

    // One call from the comment stage, one from the button-tap stage.
    expect(checkFollow).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ clicks: 1, linkSent: 1, followPromptSent: 0 });
    expect(sendUserDm).toHaveBeenCalledTimes(1);
    expect(sendUserDm.mock.calls[0][0]).toMatchObject({
      recipientId: 'user-9',
      message: 'Here is your link: https://example.com/x',
    });
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'link_sent',
      followStatus: 'following',
      dmMessageId: 'link-1',
    });
  });

  it('asks the user to follow and try again when check #2 says not following, then delivers on retry', async () => {
    const store = tempStore();
    const config = testConfig({
      requireFollowBeforePrompt: true,
      requireFollowForLink: true,
    });
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-1',
      recipientId: 'user-9',
    }));
    const sendUserDm = vi
      .fn(async (_input: SendUserDmInput) => ({ messageId: 'follow-prompt-1' }))
      .mockResolvedValueOnce({ messageId: 'follow-prompt-1' })
      .mockResolvedValueOnce({ messageId: 'link-1' });
    const checkFollow = vi
      .fn(async (_input: CheckFollowInput): Promise<FollowCheckResult> => ({
        status: 'following',
      }))
      .mockResolvedValueOnce({ status: 'following' as const }) // check #1
      .mockResolvedValueOnce({ status: 'not_following' as const }) // check #2, first tap
      .mockResolvedValueOnce({ status: 'following' as const }); // check #2, retry tap
    const deps = { store, config, sendDm, sendUserDm, checkFollow };

    await processCommentEvents([testComment()], deps);
    const firstTap = await processMessageEvents([testClick()], deps);

    expect(firstTap).toMatchObject({ clicks: 1, linkSent: 0, followPromptSent: 1 });
    expect(sendUserDm.mock.calls[0][0]).toMatchObject({
      message: 'Please follow this account, then tap Try again.',
      quickReplyTitle: 'Try again',
      quickReplyPayload: GET_LINK_PAYLOAD,
    });
    expect(sendUserDm.mock.calls[0][0].message).not.toContain('https://example.com/x');
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'follow_prompt_sent',
      followStatus: 'not_following',
    });

    const retryTap = await processMessageEvents(
      [testClick({ eventId: 'click-2', text: 'Try again' })],
      deps,
    );
    expect(retryTap).toMatchObject({ clicks: 1, linkSent: 1 });
    expect(checkFollow).toHaveBeenCalledTimes(3);
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'link_sent',
      followStatus: 'following',
    });
  });

  it('sends the unverified try-again prompt (not the link) when check #2 is unverified', async () => {
    const store = tempStore();
    const config = testConfig({ requireFollowForLink: true });
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-1',
      recipientId: 'user-9',
    }));
    const sendUserDm = vi.fn(async (_input: SendUserDmInput) => ({
      messageId: 'follow-prompt-1',
    }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'unverified' as const,
      error: 'User consent is required',
    }));
    const deps = { store, config, sendDm, sendUserDm, checkFollow };

    await processCommentEvents([testComment()], deps);
    const summary = await processMessageEvents([testClick()], deps);

    expect(summary).toMatchObject({ clicks: 1, linkSent: 0, followPromptSent: 1 });
    expect(sendUserDm.mock.calls[0][0].message).toBe(
      'I could not verify your follow yet. Please tap Try again.',
    );
    expect((await store.list(50))[0]).toMatchObject({
      dmStatus: 'follow_prompt_sent',
      followStatus: 'unverified',
    });
  });

  it('ignores a redelivered click with the same event id', async () => {
    const store = tempStore();
    const config = testConfig({ requireFollowForLink: true });
    const sendDm = vi.fn(async (_input: SendDmInput) => ({
      messageId: 'prompt-1',
      recipientId: 'user-9',
    }));
    const sendUserDm = vi.fn(async (_input: SendUserDmInput) => ({
      messageId: 'follow-prompt-1',
    }));
    const checkFollow = vi.fn(async (_input: CheckFollowInput) => ({
      status: 'not_following' as const,
    }));
    const deps = { store, config, sendDm, sendUserDm, checkFollow };

    await processCommentEvents([testComment()], deps);
    await processMessageEvents([testClick()], deps);
    const duplicate = await processMessageEvents([testClick()], deps);

    expect(duplicate).toMatchObject({ clicks: 1, duplicates: 1, followPromptSent: 0 });
    expect(sendUserDm).toHaveBeenCalledTimes(1);
  });

  it('ignores taps with no pending prompt and unrelated messages', async () => {
    const store = tempStore();
    const sendUserDm = vi.fn(async (_input: SendUserDmInput) => ({ messageId: 'x' }));

    const summary = await processMessageEvents(
      [testClick(), testClick({ eventId: 'm-2', payload: null, text: 'hello there' })],
      { store, config: testConfig(), sendUserDm },
    );

    expect(summary).toMatchObject({ received: 2, clicks: 1, noPending: 1, ignored: 1 });
    expect(sendUserDm).not.toHaveBeenCalled();
  });
});

describe('renderDmMessage', () => {
  it('fills placeholders and caps length at 1000 chars', () => {
    expect(renderDmMessage('Hi {username}, key={keyword}', { username: 'bob', keyword: 'link' })).toBe(
      'Hi @bob, key=link',
    );
    expect(renderDmMessage('x'.repeat(1200), { username: null, keyword: null })).toHaveLength(1000);
  });
});
