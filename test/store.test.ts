import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCommentStore } from '../lib/store';
import type { CommentRecord } from '../lib/types';

function makeRecord(commentId: string, receivedAt: string): CommentRecord {
  return {
    commentId,
    igAccountId: 'ig-1',
    mediaId: 'media-1',
    username: 'alice',
    text: 'LINK',
    matchedKeyword: null,
    dmStatus: 'processing',
    dmMessageId: null,
    error: null,
    receivedAt,
  };
}

describe('FileCommentStore', () => {
  it('claims a comment id only once', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comment-store-'));
    const store = new FileCommentStore(path.join(dir, 'comments.json'));
    const record = makeRecord('comment-1', '2026-10-17T10:00:00.000Z');

    expect(await store.tryClaim(record)).toBe(true);
    expect(await store.tryClaim(record)).toBe(false);
  });

  it('updates and lists newest first', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comment-store-'));
    const store = new FileCommentStore(path.join(dir, 'comments.json'));
    await store.tryClaim(makeRecord('comment-1', '2026-10-17T10:00:00.000Z'));
    await store.tryClaim(makeRecord('comment-2', '2026-10-17T11:00:00.000Z'));
    await store.update('comment-1', { dmStatus: 'sent', dmMessageId: 'mid-1' });

    const list = await store.list(50);
    expect(list.map((record) => record.commentId)).toEqual(['comment-2', 'comment-1']);
    expect(list[1].dmStatus).toBe('sent');
    expect(list[1].dmMessageId).toBe('mid-1');
  });
});
