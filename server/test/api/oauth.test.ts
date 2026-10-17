import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, bearer, type ApiHarness } from '../helpers/api.js';
import { cipher, createWorkspaceWithOwner } from '../helpers/factories.js';
import { tokenAad } from '../../src/lib/crypto/tokenCipher.js';
import { hashToken } from '../../src/lib/crypto/signatures.js';

function redirectTarget(res: { headers: Record<string, string | undefined> }): URL {
  const location = res.headers.location;
  if (!location) throw new Error('Expected a Location header on the OAuth callback response.');
  return new URL(location);
}

let h: ApiHarness;
const owner = { id: randomUUID(), email: 'owner@example.test', token: 'owner-token' };
const outsider = { id: randomUUID(), email: 'outsider@example.test', token: 'outsider-token' };
let workspaceId: string;

function api() {
  return request(h.app);
}

function stateFrom(authorizeUrl: string): string {
  const url = new URL(authorizeUrl);
  const state = url.searchParams.get('state');
  if (!state) throw new Error('authorizeUrl did not include a state');
  return state;
}

beforeAll(async () => {
  h = await createApiHarness();
  await h.ctx.createAuthUser({ id: owner.id, email: owner.email });
  await h.ctx.createAuthUser({ id: outsider.id, email: outsider.email });
  h.authVerifier.register(owner.token, { id: owner.id, email: owner.email });
  h.authVerifier.register(outsider.token, { id: outsider.id, email: outsider.email });
  workspaceId = (await createWorkspaceWithOwner(h.ctx.store, owner.id, 'OAuth workspace')).id;
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('OAuth start', () => {
  it('returns an Instagram authorize URL with scope, redirect URI and state', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceId}/oauth/start`)
      .set(bearer(owner.token))
      .expect(200);
    const url = new URL(res.body.authorizeUrl);
    expect(url.hostname).toBe('www.instagram.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://api.test/api/integrations/instagram/callback',
    );
    expect(url.searchParams.get('scope')).toContain('instagram_business_manage_comments');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('refuses to start for a non-member', async () => {
    await api()
      .post(`/api/workspaces/${workspaceId}/oauth/start`)
      .set(bearer(outsider.token))
      .expect(404);
  });

  it('stores only a hash of the state', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceId}/oauth/start`)
      .set(bearer(owner.token))
      .expect(200);
    const state = stateFrom(res.body.authorizeUrl);
    const rows = await h.ctx.db.query<{ state_hash: string }>(
      'select state_hash from public.oauth_states',
    );
    expect(rows.rows.map((row) => row.state_hash)).toContain(hashToken(state));
    expect(rows.rows.map((row) => row.state_hash)).not.toContain(state);
  });
});

describe('OAuth callback', () => {
  async function start(): Promise<string> {
    const res = await api()
      .post(`/api/workspaces/${workspaceId}/oauth/start`)
      .set(bearer(owner.token))
      .expect(200);
    return stateFrom(res.body.authorizeUrl);
  }

  it('exchanges the code, stores an encrypted token and confirms webhooks', async () => {
    const state = await start();
    const res = await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'valid-code', state })
      .expect(302);
    const location = redirectTarget(res);
    expect(location.pathname).toBe('/accounts');
    expect(location.searchParams.get('instagram')).toBe('connected');
    expect(location.searchParams.get('webhook')).toBe('confirmed');
    expect(location.searchParams.get('username')).toBe('test.creator');

    const accounts = await api()
      .get(`/api/workspaces/${workspaceId}/accounts`)
      .set(bearer(owner.token))
      .expect(200);
    expect(accounts.body.accounts).toHaveLength(1);
    const account = accounts.body.accounts[0];
    expect(account.webhookSubscribed).toBe(true);
    expect(JSON.stringify(accounts.body)).not.toContain(h.provider.longLivedToken);

    const stored = await h.ctx.db.query<{
      id: string;
      token_ciphertext: string;
      token_iv: string;
      token_tag: string;
      token_key_version: number;
    }>(
      'select id, token_ciphertext, token_iv, token_tag, token_key_version from public.instagram_accounts',
    );
    expect(stored.rows).toHaveLength(1);
    const row = stored.rows[0]!;
    expect(row.token_ciphertext).not.toContain(h.provider.longLivedToken);
    expect(row.token_key_version).toBe(1);
    const plaintext = cipher.decrypt(
      {
        ciphertext: row.token_ciphertext,
        iv: row.token_iv,
        tag: row.token_tag,
        keyVersion: row.token_key_version,
      },
      tokenAad(row.id),
    );
    expect(plaintext).toBe(h.provider.longLivedToken);
    expect(h.provider.subscriptions).toHaveLength(1);
    expect(h.provider.subscriptions[0]).toContain('comments');
  });

  it('rejects a replayed state', async () => {
    const state = await start();
    await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'valid-code', state })
      .expect(302);
    const res = await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'valid-code', state })
      .expect(302);
    const location = redirectTarget(res);
    expect(location.searchParams.get('instagram')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('state_invalid');
  });

  it('rejects an unknown or missing state without leaking the code', async () => {
    const unknown = await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'secret-code', state: 'not-a-real-state' })
      .expect(302);
    expect(redirectTarget(unknown).searchParams.get('reason')).toBe('state_invalid');
    expect(unknown.headers.location ?? '').not.toContain('secret-code');

    const missing = await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'secret-code' })
      .expect(302);
    expect(redirectTarget(missing).searchParams.get('reason')).toBe('state_invalid');
  });

  it('reports a cancelled authorization without calling the API', async () => {
    const state = await start();
    const callsBefore = h.provider.exchangeCalls;
    const res = await api()
      .get('/api/integrations/instagram/callback')
      .query({ error: 'access_denied', state })
      .expect(302);
    const location = redirectTarget(res);
    expect(location.searchParams.get('reason')).toBe('access_denied');
    expect(h.provider.exchangeCalls).toBe(callsBefore);
  });

  it('keeps the state consumed when the token exchange fails', async () => {
    const state = await start();
    const first = await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'bad-code', state })
      .expect(302);
    expect(redirectTarget(first).searchParams.get('reason')).toBe('token_exchange_failed');
    const retry = await api()
      .get('/api/integrations/instagram/callback')
      .query({ code: 'valid-code', state })
      .expect(302);
    expect(redirectTarget(retry).searchParams.get('reason')).toBe('state_invalid');
  });

  it('does not confirm webhooks when the subscription call fails', async () => {
    h.provider.subscribeError = new Error('subscribe failed');
    try {
      const state = await start();
      const res = await api()
        .get('/api/integrations/instagram/callback')
        .query({ code: 'valid-code', state })
        .expect(302);
      expect(redirectTarget(res).searchParams.get('webhook')).toBe('failed');
      const accounts = await api()
        .get(`/api/workspaces/${workspaceId}/accounts`)
        .set(bearer(owner.token))
        .expect(200);
      expect(accounts.body.accounts[0].webhookSubscribed).toBe(false);
    } finally {
      h.provider.subscribeError = null;
    }
  });
});
