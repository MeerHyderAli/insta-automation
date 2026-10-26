import { describe, expect, it, vi } from 'vitest';
import { InstagramApiError, sendPrivateReply } from '../lib/instagram';

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
