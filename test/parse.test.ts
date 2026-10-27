import { describe, expect, it } from 'vitest';
import { isInstagramWebhook, parseCommentEvents } from '../lib/parse';

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
