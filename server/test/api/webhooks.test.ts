import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from '../helpers/api.js';
import { createAccount, createWorkspaceWithOwner } from '../helpers/factories.js';
import { hmacSha256Hex } from '../../src/lib/crypto/signatures.js';

let h: ApiHarness;
const owner = randomUUID();
let workspaceId: string;
let accountId: string;

const IG_ACCOUNT_ID = '17841400000000021';

function api() {
  return request(h.app);
}

function commentPayload(commentId: string, overrides: Record<string, unknown> = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_700_000_000_000,
        changes: [
          {
            field: 'comments',
            value: {
              id: commentId,
              text: 'API please',
              from: { id: 'igsid-commenter-1', username: 'reader' },
              media: { id: 'media-1', media_product_type: 'FEED' },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

function signed(body: unknown, secret = 'test-app-secret') {
  const raw = JSON.stringify(body);
  return {
    raw,
    signature: `sha256=${hmacSha256Hex(secret, raw)}`,
  };
}

function postWebhook(body: unknown, signature?: string) {
  const { raw, signature: computed } = signed(body);
  return api()
    .post('/api/webhooks/instagram')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signature ?? computed)
    .send(raw);
}

function signedRequest(payload: Record<string, unknown>, secret = 'test-app-secret') {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${signature}.${encoded}`;
}

beforeAll(async () => {
  h = await createApiHarness();
  await h.ctx.createAuthUser({ id: owner, email: 'owner@example.test' });
  workspaceId = (await createWorkspaceWithOwner(h.ctx.store, owner, 'Webhook workspace')).id;
  accountId = (await createAccount(h.ctx.store, workspaceId, { igUserId: IG_ACCOUNT_ID })).id;
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('verification handshake', () => {
  it('echoes the challenge when the verify token matches', async () => {
    const res = await api()
      .get('/api/webhooks/instagram')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-verify-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(200);
    expect(res.text).toBe('challenge-123');
  });

  it('rejects a wrong token, wrong mode or missing challenge', async () => {
    await api()
      .get('/api/webhooks/instagram')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(403);
    await api()
      .get('/api/webhooks/instagram')
      .query({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'test-verify-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(403);
    await api()
      .get('/api/webhooks/instagram')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token' })
      .expect(403);
  });
});

describe('signature verification', () => {
  it('rejects a missing signature', async () => {
    const body = commentPayload(`c-${randomUUID()}`);
    const res = await api()
      .post('/api/webhooks/instagram')
      .set('content-type', 'application/json')
      .send(JSON.stringify(body))
      .expect(401);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects a tampered body and a wrong secret', async () => {
    const body = commentPayload(`c-${randomUUID()}`);
    const { signature } = signed(body);
    await api()
      .post('/api/webhooks/instagram')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(JSON.stringify(commentPayload(`c-${randomUUID()}`)))
      .expect(401);
    const wrong = signed(body, 'wrong-secret');
    await api()
      .post('/api/webhooks/instagram')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', wrong.signature)
      .send(wrong.raw)
      .expect(401);
  });

  it('never persists an event for an invalid signature', async () => {
    const before = await h.ctx.db.query<{ count: number }>(
      'select count(*)::int as count from public.webhook_events',
    );
    await postWebhook(commentPayload(`c-${randomUUID()}`), `sha256=${'0'.repeat(64)}`).expect(401);
    const after = await h.ctx.db.query<{ count: number }>(
      'select count(*) as count from public.webhook_events',
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});

describe('durable ingestion and dedupe', () => {
  it('stores an event, queues a job and acknowledges with counters', async () => {
    const commentId = `c-${randomUUID()}`;
    const res = await postWebhook(commentPayload(commentId)).expect(200);
    expect(res.body).toMatchObject({ received: true, events: 1, queued: 1, duplicates: 0 });

    const event = await h.ctx.db.query<{ id: string; status: string; comment_text: string }>(
      'select id, status, comment_text from public.webhook_events where comment_id = $1',
      [commentId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]?.status).toBe('received');
    const jobs = await h.ctx.db.query<{ count: number }>(
      'select count(*)::int as count from public.automation_jobs where webhook_event_id = $1',
      [event.rows[0]!.id],
    );
    expect(jobs.rows[0]?.count).toBe(1);
  });

  it('treats a repeated delivery as a duplicate without a second row or job', async () => {
    const commentId = `c-${randomUUID()}`;
    await postWebhook(commentPayload(commentId)).expect(200);
    const second = await postWebhook(commentPayload(commentId)).expect(200);
    expect(second.body.duplicates).toBe(1);
    const events = await h.ctx.db.query<{ duplicate_count: number }>(
      'select duplicate_count from public.webhook_events where comment_id = $1',
      [commentId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.duplicate_count).toBe(1);
    const jobs = await h.ctx.db.query<{ count: number }>(
      `select count(*)::int as count from public.automation_jobs j
       join public.webhook_events e on e.id = j.webhook_event_id
       where e.comment_id = $1`,
      [commentId],
    );
    expect(jobs.rows[0]?.count).toBe(1);
  });

  it('ignores events for an unknown Instagram account instead of failing', async () => {
    const body = commentPayload(`c-${randomUUID()}`);
    body.entry[0]!.id = '17849999999999999';
    const res = await postWebhook(body).expect(200);
    expect(res.body).toMatchObject({ events: 1, queued: 0, ignored: 1 });
    const event = await h.ctx.db.query<{ status: string; workspace_id: string | null }>(
      'select status, workspace_id from public.webhook_events where ig_account_id = $1',
      ['17849999999999999'],
    );
    expect(event.rows[0]).toMatchObject({ status: 'ignored', workspace_id: null });
  });

  it('stores live_comments as unsupported without queueing', async () => {
    const body = commentPayload(`c-${randomUUID()}`);
    body.entry[0]!.changes[0]!.field = 'live_comments';
    const res = await postWebhook(body).expect(200);
    expect(res.body).toMatchObject({ events: 1, queued: 0, unsupported: 1 });
    const event = await h.ctx.db.query<{ status: string; error_message: string }>(
      'select status, error_message from public.webhook_events where field = $1',
      ['live_comments'],
    );
    expect(event.rows[0]?.status).toBe('unsupported');
    expect(event.rows[0]?.error_message).toMatch(/Live comment/i);
  });

  it('accepts an empty entry array with 200', async () => {
    const res = await postWebhook({ object: 'instagram', entry: [] }).expect(200);
    expect(res.body.events).toBe(0);
  });
});

describe('deauthorize and data deletion callbacks', () => {
  it('rejects unsigned or tampered callbacks', async () => {
    await api()
      .post('/api/webhooks/instagram/deauthorize')
      .send({ signed_request: 'garbage' })
      .expect(403);
    await api()
      .post('/api/webhooks/instagram/data-deletion')
      .send({ signed_request: signedRequest({ user_id: '1' }, 'wrong-secret') })
      .expect(403);
  });

  it('disconnects accounts on a signed deauthorize request', async () => {
    const account = await h.ctx.store.getAccountById(accountId);
    expect(account?.status).toBe('connected');
    const res = await api()
      .post('/api/webhooks/instagram/deauthorize')
      .send({ signed_request: signedRequest({ algorithm: 'HMAC-SHA256', user_id: '99887766' }) })
      .expect(200);
    expect(res.body.ok).toBe(true);
    const after = await h.ctx.store.getAccountById(accountId);
    expect(after?.status).toBe('disconnected');
  });

  it('deletes account data and returns a retrievable confirmation code', async () => {
    const other = await createAccount(h.ctx.store, workspaceId, {
      igUserId: '17841400000000022',
      username: 'second.creator',
    });
    const res = await api()
      .post('/api/webhooks/instagram/data-deletion')
      .send({ signed_request: signedRequest({ algorithm: 'HMAC-SHA256', user_id: '99887766' }) })
      .expect(200);
    expect(res.body.confirmation_code).toBeTruthy();
    expect(res.body.url).toContain(res.body.confirmation_code);
    expect(await h.ctx.store.getAccountById(other.id)).toBeNull();

    const status = await api()
      .get('/api/webhooks/instagram/data-deletion/status')
      .query({ code: res.body.confirmation_code })
      .expect(200);
    expect(status.body.status).toBe('completed');
  });

  it('returns 404 for an unknown confirmation code', async () => {
    await api()
      .get('/api/webhooks/instagram/data-deletion/status')
      .query({ code: 'nope' })
      .expect(404);
  });
});
