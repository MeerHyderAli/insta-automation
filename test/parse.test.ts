import { describe, expect, it } from 'vitest';
import {
  isInstagramWebhook,
  parseCommentEvents,
  parseMessageEvents,
  summarizeWebhookPayload,
} from '../lib/parse';

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
        parentId: null,
        selfIgScopedId: null,
        timestamp: 1_700_000_000,
      },
    ]);
  });

  it('extracts the Business Login for Instagram entry.field/value shape', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          time: 1_700_000_000,
          field: 'comments',
          value: {
            id: 'comment-2',
            text: 'resource please',
            from: { id: 'user-10', username: 'bob' },
            media: { id: 'media-2', media_product_type: 'REELS' },
          },
        },
      ],
    };

    expect(parseCommentEvents(payload)).toEqual([
      {
        commentId: 'comment-2',
        igAccountId: 'ig-1',
        mediaId: 'media-2',
        commenterId: 'user-10',
        username: 'bob',
        text: 'resource please',
        parentId: null,
        selfIgScopedId: null,
        timestamp: 1_700_000_000,
      },
    ]);
  });

  it('extracts parent and self-comment identifiers used for reply-loop prevention', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          time: 1_700_000_000,
          field: 'comments',
          value: {
            id: 'reply-1',
            parent_id: 'comment-1',
            text: 'check your DM',
            from: {
              id: 'ig-1',
              username: 'account-owner',
              self_ig_scoped_id: 'ig-1',
            },
            media: { id: 'media-1', media_product_type: 'REELS' },
          },
        },
      ],
    };

    expect(parseCommentEvents(payload)[0]).toMatchObject({
      commentId: 'reply-1',
      parentId: 'comment-1',
      selfIgScopedId: 'ig-1',
    });
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

  it('summarizes webhook shape without exposing payload values', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          field: 'comments',
          value: { id: 'comment-1', text: 'do not expose this' },
          messaging: [{ sender: { id: 'user-9' }, message: { mid: 'm1', text: 'private' } }],
        },
        {
          id: 'ig-1',
          changes: [{ field: 'live_comments', value: { id: 'comment-2' } }],
        },
      ],
    };

    const summary = summarizeWebhookPayload(payload);
    expect(summary).toEqual({
      payloadObject: 'instagram',
      entryCount: 2,
      entryFields: ['comments', 'live_comments', 'messages'],
    });
    expect(JSON.stringify(summary)).not.toContain('do not expose this');
    expect(JSON.stringify(summary)).not.toContain('user-9');
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
