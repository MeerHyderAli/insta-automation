import { randomUUID } from 'node:crypto';
import { TokenCipher, tokenAad } from '../../src/lib/crypto/tokenCipher.js';
import type { PgStore } from '../../src/db/pgStore.js';
import type { AccountRecord, RuleRecord, WorkspaceRecord } from '../../src/types/domain.js';

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
export const cipher = new TokenCipher(TEST_KEY, 1);

export async function createWorkspaceWithOwner(
  store: PgStore,
  ownerId: string,
  name = 'Test workspace',
): Promise<WorkspaceRecord> {
  return store.createWorkspace({
    name,
    slug: `ws-${randomUUID().slice(0, 8)}`,
    planId: 'creator',
    timezone: 'UTC',
    createdBy: ownerId,
  });
}

export async function createAccount(
  store: PgStore,
  workspaceId: string,
  overrides: Partial<{
    igUserId: string;
    username: string;
    scopes: string[];
    webhookSubscribedAt: Date | null;
    status: AccountRecord['status'];
    tokenExpiresAt: Date;
  }> = {},
): Promise<AccountRecord> {
  const id = randomUUID();
  const token = cipher.encrypt('IGQV-test-token-should-never-leak', tokenAad(id));
  const { account } = await store.upsertAccount({
    id,
    workspaceId,
    igUserId: overrides.igUserId ?? '17841400000000001',
    metaUserId: '99887766',
    username: overrides.username ?? 'test.creator',
    accountType: 'BUSINESS',
    scopes: overrides.scopes ?? ['instagram_business_basic', 'instagram_business_manage_comments'],
    token,
    tokenExpiresAt: overrides.tokenExpiresAt ?? new Date(Date.now() + 30 * 86_400_000),
  });
  if (overrides.status && overrides.status !== 'connected') {
    return store.updateAccountStatus(account.id, overrides.status);
  }
  if (overrides.webhookSubscribedAt !== null) {
    return store.markWebhookSubscribed(account.id);
  }
  return account;
}

export async function createRule(
  store: PgStore,
  workspaceId: string,
  accountId: string,
  createdBy: string,
  overrides: Partial<{
    name: string;
    keywords: string[];
    mediaId: string | null;
    publicReplyTemplate: string | null;
    privateReplyTemplate: string | null;
    enabled: boolean;
    followGate: RuleRecord['followGate'];
  }> = {},
): Promise<RuleRecord> {
  return store.createRule({
    workspaceId,
    accountId,
    name: overrides.name ?? `Rule ${randomUUID().slice(0, 6)}`,
    enabled: overrides.enabled ?? true,
    mediaId: overrides.mediaId ?? null,
    keywords: overrides.keywords ?? ['API'],
    publicReplyTemplate:
      overrides.publicReplyTemplate ?? 'Here you go {{username}}: {{resource_url}}',
    privateReplyTemplate: overrides.privateReplyTemplate ?? 'Sent you the guide, {{username}}!',
    resourceId: null,
    followGate: overrides.followGate ?? 'off',
    priority: 100,
    createdBy,
  });
}
