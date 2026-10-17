import type { EncryptedToken } from '../lib/crypto/tokenCipher.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type AccountStatus =
  'connected' | 'needs_reconnect' | 'missing_permissions' | 'disconnected';
export type FollowGate = 'off' | 'instruction';
export type ReplyStatus = 'skipped' | 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';
export type RunStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'skipped';
export type WebhookEventStatus =
  'received' | 'processing' | 'processed' | 'ignored' | 'unsupported' | 'failed';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead';
export type WebhookField = 'comments' | 'live_comments';

export interface ProfileRecord {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanLimits {
  accounts: number;
  rules: number;
  resources: number;
  members: number;
  private_replies_month: number;
  comments_month: number;
  [key: string]: number;
}

export interface PlanRecord {
  id: string;
  name: string;
  description: string | null;
  limits: PlanLimits;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  planId: string;
  timezone: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceWithRole extends WorkspaceRecord {
  role: WorkspaceRole;
  plan: PlanRecord | null;
}

export interface MemberRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
  email: string | null;
  fullName: string | null;
}

export interface AccountRecord {
  id: string;
  workspaceId: string;
  igUserId: string;
  metaUserId: string | null;
  username: string;
  accountType: string | null;
  scopes: string[];
  token: EncryptedToken;
  tokenExpiresAt: Date;
  status: AccountStatus;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  webhookSubscribedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaRecord {
  id: string;
  workspaceId: string;
  accountId: string;
  igMediaId: string;
  mediaType: string | null;
  mediaProductType: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
}

export interface ResourceRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  url: string;
  slug: string;
  clickCount: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuleRecord {
  id: string;
  workspaceId: string;
  accountId: string;
  name: string;
  enabled: boolean;
  mediaId: string | null;
  keywords: string[];
  publicReplyTemplate: string | null;
  privateReplyTemplate: string | null;
  resourceId: string | null;
  followGate: FollowGate;
  priority: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEventRecord {
  id: string;
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
  duplicateCount: number;
  status: WebhookEventStatus;
  errorMessage: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface JobRecord {
  id: string;
  webhookEventId: string;
  workspaceId: string | null;
  accountId: string | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  accountId: string;
  webhookEventId: string | null;
  ruleId: string | null;
  ruleName: string;
  commentId: string;
  mediaId: string | null;
  commenterUsername: string | null;
  commenterIgsid: string | null;
  commentText: string | null;
  matchedKeyword: string | null;
  status: RunStatus;
  skipReason: string | null;
  publicReplyStatus: ReplyStatus;
  publicReplyId: string | null;
  publicReplyError: string | null;
  privateReplyStatus: ReplyStatus;
  privateReplyMessageId: string | null;
  privateReplyError: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  level: 'info' | 'warn' | 'error';
  code: string | null;
  message: string;
  createdAt: Date;
}

export interface UsageSummary {
  planId: string;
  periodStart: string;
  metrics: Record<string, number>;
  limits: PlanLimits;
}

export interface AnalyticsDailyPoint {
  date: string;
  commentsReceived: number;
  publicRepliesSent: number;
  privateRepliesSent: number;
}

export interface AnalyticsSummary {
  rangeDays: number;
  commentsReceived: number;
  eventsProcessed: number;
  keywordMatches: number;
  publicRepliesAttempted: number;
  publicRepliesSent: number;
  privateRepliesAttempted: number;
  privateRepliesSent: number;
  failures: number;
  duplicatesIgnored: number;
  skipped: number;
  resourceClicks: number;
  daily: AnalyticsDailyPoint[];
}

export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  accounts: 1,
  rules: 3,
  resources: 10,
  members: 1,
  private_replies_month: 100,
  comments_month: 500,
};

export interface OAuthStateRecord {
  workspaceId: string;
  userId: string;
  expiresAt: Date;
}
