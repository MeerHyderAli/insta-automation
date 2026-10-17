import type { EncryptedToken } from '../lib/crypto/tokenCipher.js';
import type {
  AccountRecord,
  AccountStatus,
  AnalyticsSummary,
  JobRecord,
  MediaRecord,
  MemberRecord,
  OAuthStateRecord,
  PlanRecord,
  ProfileRecord,
  ResourceRecord,
  RuleRecord,
  RunRecord,
  RunStatus,
  RunEventRecord,
  UsageSummary,
  WebhookEventRecord,
  WebhookEventStatus,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceWithRole,
} from '../types/domain.js';

export interface MediaInput {
  igMediaId: string;
  mediaType: string | null;
  mediaProductType: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
}

export interface WebhookEventInput {
  dedupeKey: string;
  workspaceId: string | null;
  accountId: string | null;
  igAccountId: string | null;
  field: string;
  commentId: string | null;
  mediaId: string | null;
  commenterIgsid: string | null;
  commenterUsername: string | null;
  commentText: string | null;
  payload: unknown;
}

export interface RunInput {
  workspaceId: string;
  accountId: string;
  webhookEventId: string;
  ruleId: string;
  ruleName: string;
  commentId: string;
  mediaId: string | null;
  commenterUsername: string | null;
  commenterIgsid: string | null;
  commentText: string | null;
  matchedKeyword: string;
}

export interface RunPatch {
  status?: RunStatus;
  skipReason?: string | null;
  publicReplyStatus?: RunRecord['publicReplyStatus'];
  publicReplyId?: string | null;
  publicReplyError?: string | null;
  privateReplyStatus?: RunRecord['privateReplyStatus'];
  privateReplyMessageId?: string | null;
  privateReplyError?: string | null;
  incrementAttempts?: boolean;
  lastAttemptAt?: Date | null;
}

export interface RunListFilter {
  status?: RunStatus;
  accountId?: string;
  ruleId?: string;
  limit: number;
  offset: number;
}

export interface WorkspaceCounts {
  accounts: number;
  rules: number;
  resources: number;
  members: number;
}

export type JobOutcome = 'retry' | 'dead';

export interface Store {
  ping(): Promise<void>;
  close(): Promise<void>;

  upsertProfile(input: {
    id: string;
    email: string | null;
    fullName?: string | null;
  }): Promise<ProfileRecord>;
  getProfile(id: string): Promise<ProfileRecord | null>;
  updateProfile(
    id: string,
    patch: { fullName?: string | null; avatarUrl?: string | null },
  ): Promise<ProfileRecord>;
  findProfileByEmail(email: string): Promise<ProfileRecord | null>;

  getPlan(id: string): Promise<PlanRecord | null>;
  listPlans(): Promise<PlanRecord[]>;

  createWorkspace(input: {
    name: string;
    slug: string;
    planId: string;
    timezone: string;
    createdBy: string;
  }): Promise<WorkspaceRecord>;
  getWorkspace(id: string): Promise<WorkspaceRecord | null>;
  getWorkspaceForUser(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspace: WorkspaceRecord; role: WorkspaceRole } | null>;
  listWorkspacesForUser(userId: string): Promise<WorkspaceWithRole[]>;
  updateWorkspace(
    id: string,
    patch: { name?: string; timezone?: string },
  ): Promise<WorkspaceRecord>;
  deleteWorkspace(id: string): Promise<void>;

  listMembers(workspaceId: string): Promise<MemberRecord[]>;
  getMembership(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null>;
  addMember(
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<MemberRecord>;
  updateMemberRole(
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
  countMembers(workspaceId: string): Promise<number>;

  listAccounts(workspaceId: string): Promise<AccountRecord[]>;
  getAccount(workspaceId: string, accountId: string): Promise<AccountRecord | null>;
  getAccountById(accountId: string): Promise<AccountRecord | null>;
  getAccountByIgUserId(igUserId: string): Promise<AccountRecord | null>;
  getAccountsByMetaUserId(metaUserId: string): Promise<AccountRecord[]>;
  upsertAccount(input: {
    id: string;
    workspaceId: string;
    igUserId: string;
    metaUserId: string | null;
    username: string;
    accountType: string | null;
    scopes: string[];
    token: EncryptedToken;
    tokenExpiresAt: Date;
  }): Promise<{ account: AccountRecord; created: boolean }>;
  updateAccountToken(
    accountId: string,
    token: EncryptedToken,
    expiresAt: Date,
  ): Promise<AccountRecord>;
  updateAccountStatus(
    accountId: string,
    status: AccountStatus,
    errorCode?: string | null,
  ): Promise<AccountRecord>;
  markWebhookSubscribed(accountId: string): Promise<AccountRecord>;
  disconnectAccount(accountId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  listAccountsNeedingRefresh(before: Date): Promise<AccountRecord[]>;
  countAccounts(workspaceId: string): Promise<number>;

  replaceMedia(workspaceId: string, accountId: string, items: MediaInput[]): Promise<MediaRecord[]>;
  listMedia(workspaceId: string, accountId: string): Promise<MediaRecord[]>;
  getMedia(accountId: string, igMediaId: string): Promise<MediaRecord | null>;

  listRules(workspaceId: string): Promise<RuleRecord[]>;
  getRule(workspaceId: string, ruleId: string): Promise<RuleRecord | null>;
  createRule(input: {
    workspaceId: string;
    accountId: string;
    name: string;
    enabled: boolean;
    mediaId: string | null;
    keywords: string[];
    publicReplyTemplate: string | null;
    privateReplyTemplate: string | null;
    resourceId: string | null;
    followGate: RuleRecord['followGate'];
    priority: number;
    createdBy: string;
  }): Promise<RuleRecord>;
  updateRule(
    workspaceId: string,
    ruleId: string,
    patch: Partial<{
      name: string;
      enabled: boolean;
      mediaId: string | null;
      keywords: string[];
      publicReplyTemplate: string | null;
      privateReplyTemplate: string | null;
      resourceId: string | null;
      followGate: RuleRecord['followGate'];
      priority: number;
    }>,
  ): Promise<RuleRecord>;
  deleteRule(workspaceId: string, ruleId: string): Promise<void>;
  countRules(workspaceId: string): Promise<number>;
  getEnabledRulesForAccount(accountId: string): Promise<RuleRecord[]>;

  listResources(workspaceId: string): Promise<ResourceRecord[]>;
  getResource(workspaceId: string, resourceId: string): Promise<ResourceRecord | null>;
  getResourceBySlug(slug: string): Promise<ResourceRecord | null>;
  createResource(input: {
    workspaceId: string;
    title: string;
    description: string | null;
    url: string;
    slug: string;
    createdBy: string;
  }): Promise<ResourceRecord>;
  updateResource(
    workspaceId: string,
    resourceId: string,
    patch: { title?: string; description?: string | null; url?: string },
  ): Promise<ResourceRecord>;
  deleteResource(workspaceId: string, resourceId: string): Promise<void>;
  countResources(workspaceId: string): Promise<number>;
  recordResourceClick(resource: ResourceRecord, userAgent: string | null): Promise<void>;
  countResourceClicksSince(workspaceId: string, since: Date): Promise<number>;

  createOAuthState(input: {
    stateHash: string;
    workspaceId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null>;
  deleteExpiredOAuthStates(): Promise<void>;

  recordWebhookEvent(input: WebhookEventInput): Promise<{
    event: WebhookEventRecord;
    duplicate: boolean;
  }>;
  updateWebhookEvent(
    id: string,
    status: WebhookEventStatus,
    errorMessage?: string | null,
  ): Promise<void>;
  getWebhookEvent(id: string): Promise<WebhookEventRecord | null>;

  enqueueJob(input: {
    webhookEventId: string;
    workspaceId: string | null;
    accountId: string | null;
    maxAttempts: number;
  }): Promise<void>;
  claimJob(workerId: string): Promise<JobRecord | null>;
  completeJob(jobId: string): Promise<void>;
  rescheduleJob(jobId: string, runAfter: Date, error: string): Promise<JobOutcome>;
  failJob(jobId: string, error: string): Promise<void>;

  createOrGetRun(input: RunInput): Promise<{ run: RunRecord; created: boolean }>;
  updateRun(runId: string, patch: RunPatch): Promise<RunRecord>;
  getRun(workspaceId: string, runId: string): Promise<RunRecord | null>;
  getRunByComment(accountId: string, commentId: string): Promise<RunRecord | null>;
  getRunForEvent(webhookEventId: string): Promise<RunRecord | null>;
  listRuns(
    workspaceId: string,
    filter: RunListFilter,
  ): Promise<{ items: RunRecord[]; total: number }>;
  addRunEvent(input: {
    runId: string;
    workspaceId: string;
    level: 'info' | 'warn' | 'error';
    code: string | null;
    message: string;
  }): Promise<void>;
  listRunEvents(runId: string): Promise<RunEventRecord[]>;
  countPrivateRepliesSince(accountId: string, since: Date): Promise<number>;

  recordMetaDataRequest(input: {
    code: string;
    metaUserId: string | null;
    kind: 'deauthorize' | 'data_deletion';
    details?: Record<string, unknown> | null;
  }): Promise<void>;
  getMetaDataRequest(code: string): Promise<{
    code: string;
    kind: string;
    status: string;
    requestedAt: Date;
    completedAt: Date | null;
  } | null>;

  incrementUsage(
    workspaceId: string,
    metric: string,
    amount: number,
    limit?: number | null,
  ): Promise<number | null>;
  releaseUsage(workspaceId: string, metric: string, amount: number): Promise<void>;
  getUsage(workspaceId: string, plan: PlanRecord): Promise<UsageSummary>;
  getAnalytics(workspaceId: string, days: number): Promise<AnalyticsSummary>;

  recordAudit(input: {
    workspaceId: string | null;
    actorUserId: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
  purgeOldData(webhookRetentionDays: number): Promise<{ events: number; states: number }>;
}
