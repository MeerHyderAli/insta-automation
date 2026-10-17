import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, bearer, type ApiHarness } from '../helpers/api.js';
import { createAccount, createWorkspaceWithOwner } from '../helpers/factories.js';

let h: ApiHarness;
const userA = { id: randomUUID(), email: 'a@example.test', token: 'token-a' };
const userB = { id: randomUUID(), email: 'b@example.test', token: 'token-b' };
let workspaceA: string;
let accountA: string;

function api() {
  return request(h.app);
}

beforeAll(async () => {
  h = await createApiHarness();
  await h.ctx.createAuthUser({ id: userA.id, email: userA.email, name: 'User A' });
  await h.ctx.createAuthUser({ id: userB.id, email: userB.email, name: 'User B' });
  h.authVerifier.register(userA.token, { id: userA.id, email: userA.email });
  h.authVerifier.register(userB.token, { id: userB.id, email: userB.email });
  workspaceA = (await createWorkspaceWithOwner(h.ctx.store, userA.id, 'Workspace A')).id;
  await createWorkspaceWithOwner(h.ctx.store, userB.id, 'Workspace B');
  accountA = (await createAccount(h.ctx.store, workspaceA, { igUserId: '17841400000000011' })).id;
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('health and public configuration', () => {
  it('serves health without authentication', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('serves a client config with capabilities and no secrets', async () => {
    const res = await api().get('/api/config').expect(200);
    expect(res.body.metaConfigured).toBe(true);
    expect(res.body.followVerification.status).toBe('UNSUPPORTED');
    expect(res.body.followVerification.available).toBe(false);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('test-app-secret');
    expect(serialized).not.toContain('service-role-key');
    expect(serialized).not.toContain('long-lived-token');
    expect(res.body).not.toHaveProperty('database');
  });

  it('reports readiness against the database', async () => {
    const res = await api().get('/api/ready');
    expect([200, 503]).toContain(res.status);
  });
});

describe('authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await api().get('/api/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('rejects an unknown token', async () => {
    await api().get('/api/me').set(bearer('not-a-real-token')).expect(401);
  });

  it('returns the profile and workspaces for a valid token', async () => {
    const res = await api().get('/api/me').set(bearer(userA.token)).expect(200);
    expect(res.body.user.id).toBe(userA.id);
    expect(res.body.profile.email).toBe(userA.email);
    expect(res.body.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual([
      workspaceA,
    ]);
    expect(res.body.workspaces[0].role).toBe('owner');
  });
});

describe('workspaces and tenancy', () => {
  it('creates a workspace with the caller as owner', async () => {
    const res = await api()
      .post('/api/workspaces')
      .set(bearer(userA.token))
      .send({ name: 'Second Studio', timezone: 'Asia/Kolkata' })
      .expect(201);
    expect(res.body.workspace.role).toBe('owner');
    expect(res.body.workspace.timezone).toBe('Asia/Kolkata');
    expect(res.body.workspace.planId).toBe('free');
  });

  it('rejects an invalid IANA timezone', async () => {
    const res = await api()
      .post('/api/workspaces')
      .set(bearer(userA.token))
      .send({ name: 'Bad timezone', timezone: 'Mars/Olympus' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns counts for a member workspace', async () => {
    const res = await api()
      .get(`/api/workspaces/${workspaceA}`)
      .set(bearer(userA.token))
      .expect(200);
    expect(res.body.workspace.id).toBe(workspaceA);
    expect(res.body.counts.accounts).toBe(1);
  });

  it('hides another tenant workspace behind a 404', async () => {
    const res = await api()
      .get(`/api/workspaces/${workspaceA}`)
      .set(bearer(userB.token))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('denies cross-tenant reads of accounts, rules, runs, usage, analytics and members', async () => {
    for (const path of ['accounts', 'rules', 'runs', 'usage', 'analytics', 'members']) {
      await api().get(`/api/workspaces/${workspaceA}/${path}`).set(bearer(userB.token)).expect(404);
    }
  });

  it('denies cross-tenant mutations', async () => {
    await api()
      .patch(`/api/workspaces/${workspaceA}`)
      .set(bearer(userB.token))
      .send({ name: 'Hijacked' })
      .expect(404);
    await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userB.token))
      .send({ name: 'x', accountId: accountA, keywords: ['x'] })
      .expect(404);
    await api()
      .delete(`/api/workspaces/${workspaceA}`)
      .set(bearer(userB.token))
      .send({ confirmName: 'Workspace A' })
      .expect(404);
  });

  it('refuses workspace deletion without the exact name', async () => {
    const id = (await createWorkspaceWithOwner(h.ctx.store, userA.id, 'Delete Me')).id;
    const res = await api()
      .delete(`/api/workspaces/${id}`)
      .set(bearer(userA.token))
      .send({ confirmName: 'delete me' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await api()
      .delete(`/api/workspaces/${id}`)
      .set(bearer(userA.token))
      .send({ confirmName: 'Delete Me' })
      .expect(204);
  });
});

describe('account serialization', () => {
  it('never returns encrypted or plaintext tokens', async () => {
    const res = await api()
      .get(`/api/workspaces/${workspaceA}/accounts`)
      .set(bearer(userA.token))
      .expect(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('IGQV-test-token-should-never-leak');
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toContain('token_iv');
    expect(res.body.accounts[0]).toMatchObject({
      username: 'test.creator',
      status: 'connected',
      permissionsOk: true,
      webhookSubscribed: true,
    });
  });
});

describe('automation rules', () => {
  it('creates a valid rule and normalizes keywords', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({
        name: 'API guide',
        accountId: accountA,
        keywords: ['API', ' api ', 'GUIDE'],
        publicReplyTemplate: 'Hi {{username}}, here is the guide',
        resourceId: null,
        enabled: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.rule.keywords).toEqual(['API', 'GUIDE']);
  });

  it('warns when a private reply is configured without messaging scope', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({
        name: 'Private guide',
        accountId: accountA,
        keywords: ['GUIDE'],
        privateReplyTemplate: 'Here is the guide, {{username}}!',
      })
      .expect(201);
    expect(JSON.stringify(res.body.warnings)).toContain('instagram_business_manage_messages');
  });

  it('rejects an unknown template placeholder', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({
        name: 'Bad placeholder',
        accountId: accountA,
        keywords: ['API'],
        publicReplyTemplate: 'Hi {{first_name}}',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('first_name');
  });

  it('rejects unsupported follow verification explicitly', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({
        name: 'Follow gate',
        accountId: accountA,
        keywords: ['API'],
        publicReplyTemplate: 'Hi',
        followGate: 'verify',
      })
      .expect(422);
    expect(res.body.error.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(res.body.error.message).toMatch(/does not expose follower status/i);
  });

  it('requires a resource when a resource placeholder is used', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({
        name: 'Missing resource',
        accountId: accountA,
        keywords: ['API'],
        publicReplyTemplate: 'Get {{resource_url}}',
      })
      .expect(400);
    expect(JSON.stringify(res.body.error.details)).toContain('no resource is selected');
  });

  it('tests a rule without sending anything', async () => {
    const created = await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({
        name: 'Testable',
        accountId: accountA,
        keywords: ['TOOLS'],
        publicReplyTemplate: 'Hi {{username}}, keyword {{keyword}}',
        privateReplyTemplate: 'Sent it!',
      })
      .expect(201);
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/rules/${created.body.rule.id}/test`)
      .set(bearer(userA.token))
      .send({ commentText: 'any tools for this?' })
      .expect(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.matchedKeyword).toBe('TOOLS');
    expect(res.body.publicReply.text).toContain('sample_commenter');
    expect(res.body.privateReply.text).toBe('Sent it!');
    expect(h.provider.publicReplies).toHaveLength(0);
    expect(h.provider.privateReplies).toHaveLength(0);
  });

  it('enforces the free plan rule limit', async () => {
    const workspace = await h.ctx.store.createWorkspace({
      name: 'Quota workspace',
      slug: `quota-${randomUUID().slice(0, 8)}`,
      planId: 'free',
      timezone: 'UTC',
      createdBy: userA.id,
    });
    const account = await createAccount(h.ctx.store, workspace.id, {
      igUserId: `1784${randomUUID().slice(0, 12)}`,
    });
    for (let index = 0; index < 3; index += 1) {
      await api()
        .post(`/api/workspaces/${workspace.id}/rules`)
        .set(bearer(userA.token))
        .send({
          name: `Rule ${index}`,
          accountId: account.id,
          keywords: ['API'],
          publicReplyTemplate: 'Hi',
        })
        .expect(201);
    }
    const res = await api()
      .post(`/api/workspaces/${workspace.id}/rules`)
      .set(bearer(userA.token))
      .send({ name: 'Rule 4', accountId: account.id, keywords: ['API'], publicReplyTemplate: 'Hi' })
      .expect(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('prevents duplicate rule names inside a workspace', async () => {
    await api()
      .post(`/api/workspaces/${workspaceA}/rules`)
      .set(bearer(userA.token))
      .send({ name: 'API guide', accountId: accountA, keywords: ['X'], publicReplyTemplate: 'Hi' })
      .expect(409);
  });
});

describe('resources and tracked links', () => {
  it('requires HTTPS destinations', async () => {
    const res = await api()
      .post(`/api/workspaces/${workspaceA}/resources`)
      .set(bearer(userA.token))
      .send({ title: 'Insecure', url: 'http://example.com/guide' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a resource, redirects the tracked link and counts the click', async () => {
    const created = await api()
      .post(`/api/workspaces/${workspaceA}/resources`)
      .set(bearer(userA.token))
      .send({ title: 'Guide', url: 'https://example.com/guide' })
      .expect(201);
    const resource = created.body.resource;
    expect(resource.trackedUrl).toBe(`http://api.test/r/${resource.slug}`);

    const redirect = await api().get(`/r/${resource.slug}`).expect(302);
    expect(redirect.headers.location).toBe('https://example.com/guide');
    expect(redirect.headers['cache-control']).toBe('no-store');

    const list = await api()
      .get(`/api/workspaces/${workspaceA}/resources`)
      .set(bearer(userA.token))
      .expect(200);
    const updated = list.body.resources.find((item: { id: string }) => item.id === resource.id);
    expect(updated.clickCount).toBe(1);

    await api().get('/r/does-not-exist').expect(404);
  });
});

describe('usage and analytics', () => {
  it('returns plan limits and Meta limits', async () => {
    const res = await api()
      .get(`/api/workspaces/${workspaceA}/usage`)
      .set(bearer(userA.token))
      .expect(200);
    expect(res.body.plan.id).toBe('creator');
    expect(res.body.metaLimits.privateRepliesPerHour).toBe(750);
    expect(res.body.counts.accounts).toBe(1);
  });

  it('validates the analytics range', async () => {
    await api()
      .get(`/api/workspaces/${workspaceA}/analytics?days=500`)
      .set(bearer(userA.token))
      .expect(400);
    const res = await api()
      .get(`/api/workspaces/${workspaceA}/analytics?days=7`)
      .set(bearer(userA.token))
      .expect(200);
    expect(res.body.analytics.rangeDays).toBe(7);
  });
});

describe('unknown routes', () => {
  it('returns the JSON error envelope for unknown API routes', async () => {
    const res = await api().get('/api/nope').set(bearer(userA.token)).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeTruthy();
  });
});
