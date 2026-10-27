import { describe, expect, it, vi } from 'vitest';
import {
  getUserFollowStatus,
  InstagramApiError,
  sendMessageToUser,
  sendPrivateReply,
} from '../lib/instagram';

describe('sendPrivateReply', () => {
  it('posts a private reply to the Graph API and returns the message id', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ recipient_id: 'user-9', message_id: 'mid-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await sendPrivateReply({
      igAccountId: 'ig-1',
      commentId: 'comment-1',
      message: 'Here is your link',
      accessToken: 'secret-token',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toEqual({ messageId: 'mid-1', recipientId: 'user-9' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.instagram.com/v25.0/ig-1/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { comment_id: 'comment-1' },
      message: { text: 'Here is your link' },
    });
  });

  it('throws a sanitized error on API failure (token never leaks)', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: 'Bad token secret-token', code: 190 } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      sendPrivateReply({
        igAccountId: 'ig-1',
        commentId: 'comment-1',
        message: 'hi',
        accessToken: 'secret-token',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'InstagramApiError', code: 190 });

    try {
      await sendPrivateReply({
        igAccountId: 'ig-1',
        commentId: 'comment-1',
        message: 'hi',
        accessToken: 'secret-token',
        fetchFn: fetchFn as unknown as typeof fetch,
      });
    } catch (error) {
      expect((error as InstagramApiError).message).not.toContain('secret-token');
      expect((error as InstagramApiError).message).toContain('[REDACTED]');
    }
  });
});


describe('getUserFollowStatus', () => {
  it('reads is_user_follow_business=true without putting the token in the URL', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ is_user_follow_business: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await getUserFollowStatus({
      igsid: 'user-9',
      accessToken: 'secret-token',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toEqual({ status: 'following' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://graph.instagram.com/v25.0/user-9?fields=is_user_follow_business',
    );
    expect(url).not.toContain('secret-token');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });

  it('maps false to not_following', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ is_user_follow_business: false }), { status: 200 }),
    );

    await expect(
      getUserFollowStatus({
        igsid: 'user-9',
        accessToken: 'secret-token',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ status: 'not_following' });
  });

  it('returns unverified for consent/API errors and redacts the token', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { message: 'User consent is required secret-token', code: 10 },
        }),
        { status: 400 },
      ),
    );

    const result = await getUserFollowStatus({
      igsid: 'user-9',
      accessToken: 'secret-token',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.status).toBe('unverified');
    if (result.status === 'unverified') {
      expect(result.error).toContain('User consent is required');
      expect(result.error).not.toContain('secret-token');
    }
  });

  it('returns unverified when the boolean field is missing', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ username: 'alice' }), { status: 200 }));

    const result = await getUserFollowStatus({
      igsid: 'user-9',
      accessToken: 'secret-token',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.status).toBe('unverified');
  });
});


describe('two-step message payloads', () => {
  it('adds a quick-reply button to the private prompt', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ recipient_id: 'user-9', message_id: 'prompt-1' }), {
        status: 200,
      }),
    );

    await sendPrivateReply({
      igAccountId: 'ig-1',
      commentId: 'comment-1',
      message: 'Thanks for commenting!',
      quickReplies: [{ title: 'Click to get link', payload: 'GET_LINK_V1' }],
      accessToken: 'secret-token',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { comment_id: 'comment-1' },
      message: {
        text: 'Thanks for commenting!',
        quick_replies: [
          { content_type: 'text', title: 'Click to get link', payload: 'GET_LINK_V1' },
        ],
      },
    });
  });

  it('sends a follow-up conversation message to the sender IGSID', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ recipient_id: 'user-9', message_id: 'link-1' }), {
        status: 200,
      }),
    );

    const result = await sendMessageToUser({
      igAccountId: 'ig-1',
      recipientId: 'user-9',
      message: 'Here is your link: https://example.com',
      accessToken: 'secret-token',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toEqual({ messageId: 'link-1', recipientId: 'user-9' });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: 'user-9' },
      message: { text: 'Here is your link: https://example.com' },
    });
  });
});
