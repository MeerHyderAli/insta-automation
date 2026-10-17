import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutomationEngine } from '../../src/automation/engine.js';
import { MetaApiError } from '../../src/integrations/instagram/errors.js';
import { commentDedupeKey } from '../../src/integrations/instagram/normalize.js';
import { createApiHarness, silentLogger, testConfig, type ApiHarness } from '../helpers/api.js';
import {
  cipher,
  createAccount,
  createRule,
  createWorkspaceWithOwner,
} from '../helpers/factories.js';

let h: ApiHarness;
let engine: AutomationEngine;
const owner = randomUUID();
let workspaceId: string;
let accountId: string;
let igAccountId: string;
let accountUsername: string;
let ruleId: string;

async function ingest(comment: {
  id?: string;
  text?: string;
  mediaId?: string | null;
  username?: string;
  field?: 'comments' | 'live_comments';
}) {
  const commentId = comment.id ?? `comment-${randomUUID()}`;
  const { event } = await h.ctx.store.recordWebhookEvent({
    dedupeKey: commentDedupeKey(igAccountId, comment.field ?? 'comments', commentId),
    workspaceId,
    accountId,
    igAccountId,
    field: comment.field ?? 'comments',
    commentId,
    mediaId: comment.mediaId === undefined ? 'media-1' : comment.mediaId,
    commenterIgsid: 'igsid-reviewer',
    commenterUsername: comment.username ?? 'reader',
    commentText: comment.text ?? 'I need the API',
    payload: {},
  });
  return event;
}

async function run(comment: Parameters<typeof ingest>[0] = {}) {
  const event = await ingest(comment);
  const outcome = await engine.processEvent(event.id);
  const saved = await h.ctx.store.getWebhookEvent(event.id);
  const runRecord = await h.ctx.store.getRunByComment(accountId, event.commentId!);
  return { event, outcome, saved, run: runRecord };
}

beforeAll(async () => {
  h = await createApiHarness();
  await h.ctx.createAuthUser({ id: owner, email: 'engine@example.test' });
  engine = new AutomationEngine({
    store: h.ctx.store,
    provider: h.provider,
    cipher,
    config: testConfig(),
    logger: silentLogger,
  });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await createWorkspaceWithOwner(h.ctx.store, owner, `Engine ${suffix}`);
  workspaceId = workspace.id;
  igAccountId = `178414${Date.now().toString().slice(-8)}${suffix.replace(/\D/g, '').padEnd(4, '0').slice(0, 4)}`;
  accountUsername = `engine.creator.${suffix}`;
  const account = await createAccount(h.ctx.store, workspaceId, {
    igUserId: igAccountId,
    username: accountUsername,
  });
  accountId = account.id;
  const rule = await createRule(h.ctx.store, workspaceId, accountId, owner, {
    name: `Rule ${suffix}`,
    keywords: ['API', 'GUIDE'],
    publicReplyTemplate: 'Here you go {{username}}: the guide',
    privateReplyTemplate: 'Sent it, {{username}}!',
  });
  ruleId = rule.id;
  h.provider.publicReplies.length = 0;
  h.provider.privateReplies.length = 0;
  h.provider.replyError = null;
  h.provider.privateReplyError = null;
});

describe('matching and delivery', () => {
  it('sends a public and a private reply and records confirmations', async () => {
    const result = await run({ text: 'api please' });
    expect(result.outcome.result).toBe('completed');
    expect(result.run).toMatchObject({
      status: 'completed',
      matchedKeyword: 'API',
      publicReplyStatus: 'sent',
      privateReplyStatus: 'sent',
      publicReplyId: 'public-reply-1',
      privateReplyMessageId: 'message-1',
    });
    expect(h.provider.publicReplies).toHaveLength(1);
    expect(h.provider.publicReplies[0]!.message).toContain('reader');
    expect(h.provider.privateReplies[0]!.igUserId).toBe(igAccountId);
    expect(h.provider.privateReplies[0]!.message).toContain('Sent it, reader!');
    expect(result.saved?.status).toBe('processed');

    const events = await h.ctx.store.listRunEvents(result.run!.id);
    expect(events.map((event) => event.code)).toEqual(
      expect.arrayContaining(['MATCHED', 'PUBLIC_REPLY_SENT', 'PRIVATE_REPLY_SENT']),
    );
  });

  it('ignores a comment with no keyword', async () => {
    const result = await run({ text: 'nice photo' });
    expect(result.outcome).toMatchObject({ result: 'completed', reason: 'no_keyword_match' });
    expect(result.run).toBeNull();
    expect(result.saved?.status).toBe('ignored');
    expect(h.provider.publicReplies).toHaveLength(0);
  });

  it('ignores the account’s own comment and empty comments', async () => {
    const own = await run({ username: accountUsername, text: 'API' });
    expect(own.outcome.reason).toBe('own_comment');
    expect(own.run).toBeNull();
    expect(h.provider.publicReplies).toHaveLength(0);

    const empty = await run({ text: '   ' });
    expect(empty.outcome.reason).toBe('empty_comment');
  });

  it('does not act on a disabled rule', async () => {
    await h.ctx.store.updateRule(workspaceId, ruleId, { enabled: false });
    const result = await run({ text: 'API' });
    expect(result.outcome.reason).toBe('no_keyword_match');
    expect(result.run).toBeNull();
  });

  it('respects media scoping', async () => {
    await h.ctx.store.updateRule(workspaceId, ruleId, { mediaId: 'media-2' });
    const other = await run({ text: 'API', mediaId: 'media-1' });
    expect(other.run).toBeNull();
    const targeted = await run({ text: 'API', mediaId: 'media-2' });
    expect(targeted.run?.status).toBe('completed');
  });

  it('marks live_comments unsupported without calling Instagram', async () => {
    const result = await run({ text: 'API', field: 'live_comments' });
    expect(result.outcome.reason).toBe('live_comments_not_supported');
    expect(result.saved?.status).toBe('unsupported');
    expect(h.provider.publicReplies).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('collapses a redelivered webhook into the same event', async () => {
    const commentId = `comment-${randomUUID()}`;
    const first = await run({ id: commentId });
    expect(first.run?.publicReplyStatus).toBe('sent');

    const redelivery = await ingest({ id: commentId });
    expect(redelivery.id).toBe(first.event.id);
    expect(redelivery.duplicateCount).toBe(1);
    const outcome = await engine.processEvent(redelivery.id);
    expect(outcome.result).toBe('completed');
    expect(h.provider.publicReplies).toHaveLength(1);
    expect(h.provider.privateReplies).toHaveLength(1);
    const runs = await h.ctx.db.query<{ count: number }>(
      'select count(*)::int as count from public.automation_runs where account_id = $1',
      [accountId],
    );
    expect(runs.rows[0]?.count).toBe(1);
  });

  it('does not send twice when the same comment arrives under a new dedupe key', async () => {
    const commentId = `comment-${randomUUID()}`;
    await run({ id: commentId });

    const { event } = await h.ctx.store.recordWebhookEvent({
      dedupeKey: `manual:retry:${commentId}`,
      workspaceId,
      accountId,
      igAccountId,
      field: 'comments',
      commentId,
      mediaId: 'media-1',
      commenterIgsid: 'igsid-reviewer',
      commenterUsername: 'reader',
      commentText: 'I need the API',
      payload: {},
    });
    const outcome = await engine.processEvent(event.id);
    expect(outcome.result).toBe('completed');
    expect(h.provider.publicReplies).toHaveLength(1);
    expect(h.provider.privateReplies).toHaveLength(1);
  });

  it('is safe to process the same event twice', async () => {
    const event = await ingest({});
    await engine.processEvent(event.id);
    await engine.processEvent(event.id);
    expect(h.provider.publicReplies).toHaveLength(1);
  });
});

describe('error handling and retries', () => {
  it('retries transient Meta errors and keeps the reply pending', async () => {
    h.provider.replyError = new MetaApiError({ message: 'Please retry', code: 2 });
    const result = await run({});
    expect(result.outcome).toMatchObject({ result: 'retry', reason: 'retryable_meta_error' });
    expect(result.run?.publicReplyStatus).toBe('pending');
    expect(result.run?.status).toBe('processing');
    expect(result.saved?.status).toBe('processing');

    h.provider.replyError = null;
    const retryOutcome = await engine.processEvent(result.event.id);
    expect(retryOutcome.result).toBe('completed');
    expect(h.provider.publicReplies).toHaveLength(1);
    expect((await h.ctx.store.getRunByComment(accountId, result.event.commentId!))?.status).toBe(
      'completed',
    );
  });

  it('reschedules rate limits instead of dropping the comment', async () => {
    h.provider.replyError = new MetaApiError({ message: 'Slow down', code: 4 });
    const result = await run({});
    expect(result.outcome.result).toBe('retry');
    expect(result.run?.publicReplyStatus).toBe('pending');
  });

  it('fails permanently on an invalid request without retrying', async () => {
    h.provider.replyError = new MetaApiError({ message: 'Invalid comment', code: 100 });
    const result = await run({});
    expect(result.outcome.result).toBe('completed');
    expect(result.run?.publicReplyStatus).toBe('failed');
    // The private reply still succeeded, so the overall run is partial.
    expect(result.run?.privateReplyStatus).toBe('sent');
    expect(result.run?.status).toBe('partial');
    expect(result.saved?.status).toBe('processed');
    expect(h.provider.publicReplies).toHaveLength(0);
    expect(h.provider.privateReplies).toHaveLength(1);
  });

  it('flips the account to needs_reconnect on an expired token', async () => {
    h.provider.replyError = new MetaApiError({ message: 'Token expired', code: 190 });
    const result = await run({});
    expect(result.run?.publicReplyStatus).toBe('failed');
    const account = await h.ctx.store.getAccountById(accountId);
    expect(account?.status).toBe('needs_reconnect');
    expect(account?.lastErrorCode).toBe('META_190');
  });

  it('records unknown when the network fails before confirmation', async () => {
    h.provider.replyError = new Error('socket hang up');
    const result = await run({});
    expect(result.outcome.result).toBe('completed');
    expect(result.run?.publicReplyStatus).toBe('unknown');
    expect(h.provider.publicReplies).toHaveLength(0);
  });

  it('does not resend a reply left in "sending" after a crash', async () => {
    const event = await ingest({});
    const created = await h.ctx.store.createOrGetRun({
      workspaceId,
      accountId,
      webhookEventId: event.id,
      ruleId,
      ruleName: 'Rule',
      commentId: event.commentId!,
      mediaId: 'media-1',
      commenterUsername: 'reader',
      commenterIgsid: 'igsid-reviewer',
      commentText: 'API',
      matchedKeyword: 'API',
    });
    await h.ctx.store.updateRun(created.run.id, { publicReplyStatus: 'sending' });
    await engine.processEvent(event.id);
    const after = await h.ctx.store.getRun(workspaceId, created.run.id);
    expect(after?.publicReplyStatus).toBe('unknown');
    expect(h.provider.publicReplies).toHaveLength(0);
    const events = await h.ctx.store.listRunEvents(created.run.id);
    expect(events.some((item) => item.code === 'INTERRUPTED')).toBe(true);
  });
});

describe('quotas and windows', () => {
  it('skips the private reply when the monthly quota is exhausted but still replies publicly', async () => {
    const workspace = await h.ctx.store.getWorkspace(workspaceId);
    const plan = await h.ctx.store.getPlan(workspace!.planId);
    await h.ctx.store.incrementUsage(
      workspaceId,
      'private_replies_month',
      plan!.limits.private_replies_month,
    );

    const result = await run({});
    expect(result.run?.publicReplyStatus).toBe('sent');
    expect(result.run?.privateReplyStatus).toBe('skipped');
    expect(result.run?.privateReplyError).toMatch(/quota/i);
    expect(h.provider.privateReplies).toHaveLength(0);
    const events = await h.ctx.store.listRunEvents(result.run!.id);
    expect(events.some((item) => item.code === 'QUOTA_EXCEEDED')).toBe(true);
  });

  it('skips automation when the monthly processed-comment quota is exhausted', async () => {
    const workspace = await h.ctx.store.getWorkspace(workspaceId);
    const plan = await h.ctx.store.getPlan(workspace!.planId);
    await h.ctx.store.incrementUsage(
      workspaceId,
      'comments_processed',
      plan!.limits.comments_month,
    );
    const result = await run({});
    expect(result.outcome.reason).toBe('quota_exceeded');
    expect(result.run?.status).toBe('skipped');
    expect(result.run?.skipReason).toBe('monthly_comment_quota_exceeded');
    expect(h.provider.publicReplies).toHaveLength(0);
  });

  it('skips the private reply outside the 7-day window', async () => {
    const event = await ingest({});
    await h.ctx.db.query(
      "update public.webhook_events set received_at = now() - interval '8 days' where id = $1",
      [event.id],
    );
    const outcome = await engine.processEvent(event.id);
    expect(outcome.result).toBe('completed');
    const runRecord = await h.ctx.store.getRunByComment(accountId, event.commentId!);
    expect(runRecord?.publicReplyStatus).toBe('sent');
    expect(runRecord?.privateReplyStatus).toBe('skipped');
    expect(runRecord?.privateReplyError).toMatch(/7-day/i);
    expect(h.provider.privateReplies).toHaveLength(0);
  });

  it('does not automate for a disconnected account', async () => {
    await h.ctx.store.disconnectAccount(accountId);
    const result = await run({});
    expect(result.run).toBeNull();
    expect(result.saved?.status).toBe('ignored');
    expect(h.provider.publicReplies).toHaveLength(0);
  });
});
