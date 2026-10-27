import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCommentStore } from '../lib/store';
import type { CommentRecord } from '../lib/types';

function makeRecord(commentId: string, receivedAt: string): CommentRecord {
  return {
    commentId,
    commenterId: 'user-9',
    igAccountId: 'ig-1',
    mediaId: 'media-1',
    username: 'alice',
    text: 'LINK',
    matchedKeyword: null,
    resourceLink: null,
    followStatus: 'not_checked',
    dmStatus: 'processing',
    dmMessageId: null,
    lastClickEventId: null,
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


describe('FileCommentStore click claiming', () => {
  it('finds the latest pending prompt and claims each click only once', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comment-store-'));
    const store = new FileCommentStore(path.join(dir, 'comments.json'));
    const record = makeRecord('comment-9', '2026-10-17T12:00:00.000Z');
    await store.tryClaim(record);
    await store.update('comment-9', { dmStatus: 'prompt_sent' });

    expect((await store.findLatestPendingByCommenterId('user-9'))?.commentId).toBe('comment-9');
    expect((await store.findPendingByCommentId('comment-9'))?.commentId).toBe('comment-9');
    expect(await store.hasHandledCommentForUserMedia('user-9', 'media-1', 'another-comment')).toBe(true);
    expect(await store.hasHandledCommentForUserMedia('user-9', 'media-1', 'comment-9')).toBe(false);
    const claimed = await store.tryClaimClick('comment-9', 'click-1');
    expect(claimed).toMatchObject({ dmStatus: 'checking_follow', lastClickEventId: 'click-1' });
    expect(await store.tryClaimClick('comment-9', 'click-1')).toBeNull();
    expect(await store.findLatestPendingByCommenterId('user-9')).toBeNull();
  });
});


describe('FileCommentStore dashboard media resources', () => {
  it('saves, updates, lists, reloads, and deletes Reel resources', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comment-store-'));
    const filePath = path.join(dir, 'comments.json');
    const store = new FileCommentStore(filePath);

    const saved = await store.upsertMediaResource({
      mediaId: 'media-1',
      url: 'https://example.com/reel-a',
      label: 'Reel A guide',
    });
    expect(saved).toMatchObject({ mediaId: 'media-1', url: 'https://example.com/reel-a' });
    expect((await store.getMediaResource('media-1'))?.label).toBe('Reel A guide');

    await store.upsertMediaResource({
      mediaId: 'media-1',
      url: 'https://example.com/reel-a-v2',
      label: null,
    });
    const reloaded = new FileCommentStore(filePath);
    expect(await reloaded.listMediaResources()).toHaveLength(1);
    expect((await reloaded.getMediaResource('media-1'))?.url).toBe('https://example.com/reel-a-v2');

    await reloaded.deleteMediaResource('media-1');
    expect(await reloaded.getMediaResource('media-1')).toBeNull();
  });
});
