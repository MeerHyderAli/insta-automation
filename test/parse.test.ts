import { describe, expect, it } from 'vitest';
import { isInstagramWebhook, parseCommentEvents, parseMessageEvents } from '../lib/parse';

describe('parseCommentEvents', () => {
  it('extracts comment events and ignores other fields', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          time: 1_700_000_000,
          changes: [
            {
              field: 'comments',
              value: {
                id: 'comment-1',
                text: 'LINK please',
                from: { id: 'user-9', username: 'alice' },
                media: { id: 'media-1', media_product_type: 'REELS' },
              },
            },
            { field: 'messages', value: { id: 'ignored' } },
          ],
        },
      ],
    };

    expect(parseCommentEvents(payload)).toEqual([
      {
        commentId: 'comment-1',
        igAccountId: 'ig-1',
        mediaId: 'media-1',
        commenterId: 'user-9',
        username: 'alice',
        text: 'LINK please',
        timestamp: 1_700_000_000,
      },
    ]);
  });

  it('skips malformed entries without throwing', () => {
    expect(parseCommentEvents(null)).toEqual([]);
    expect(parseCommentEvents({ entry: 'nope' })).toEqual([]);
    expect(
      parseCommentEvents({ object: 'instagram', entry: [{ changes: [{ field: 'comments', value: {} }] }] }),
    ).toEqual([]);
  });

  it('identifies the instagram object', () => {
    expect(isInstagramWebhook({ object: 'instagram' })).toBe(true);
    expect(isInstagramWebhook({ object: 'page' })).toBe(false);
  });
});


describe('parseMessageEvents', () => {
  it('extracts quick-reply taps and postbacks while ignoring echoes', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          time: 1_700_000_000,
          messaging: [
            {
              sender: { id: 'user-9' },
              recipient: { id: 'ig-1' },
              timestamp: 1_700_000_000_000,
              message: {
                mid: 'mid-1',
                text: 'Click to get link',
                quick_reply: { payload: 'GET_LINK_V1' },
              },
            },
            {
              sender: { id: 'user-9' },
              recipient: { id: 'ig-1' },
              timestamp: 1_700_000_001_000,
              postback: { mid: 'mid-2', title: 'Try again', payload: 'GET_LINK_V1' },
            },
            {
              sender: { id: 'ig-1' },
              recipient: { id: 'user-9' },
              timestamp: 1_700_000_002_000,
              message: { mid: 'mid-3', text: 'Thanks!', is_echo: true },
            },
          ],
        },
      ],
    };

    expect(parseMessageEvents(payload)).toEqual([
      {
        eventId: 'mid-1',
        igAccountId: 'ig-1',
        senderId: 'user-9',
        recipientId: 'ig-1',
        payload: 'GET_LINK_V1',
        text: 'Click to get link',
        kind: 'quick_reply',
        timestamp: 1_700_000_000_000,
      },
      {
        eventId: 'mid-2',
        igAccountId: 'ig-1',
        senderId: 'user-9',
        recipientId: 'ig-1',
        payload: 'GET_LINK_V1',
        text: 'Try again',
        kind: 'postback',
        timestamp: 1_700_000_001_000,
      },
    ]);
  });
});
