export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type AccountStatus =
  'connected' | 'needs_reconnect' | 'missing_permissions' | 'disconnected';
export type RunStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'skipped';
export type ReplyStatus = 'skipped' | 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';

export interface PlanLimits {
  accounts: number;
  rules: number;
  resources: number;
  members: number;
  private_replies_month: number;
  comments_month: number;
  [key: string]: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  planId: string;
  planName: string;
  planLimits: PlanLimits | null;
  timezone: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface MeResponse {
  user: { id: string; email: string | null };
  profile: Profile;
  workspaces: Workspace[];
}

export interface Account {
  id: string;
  workspaceId: string;
  igUserId: string;
  username: string;
  accountType: string | null;
  scopes: string[];
  tokenExpiresAt: string;
  tokenExpiresInDays: number;
  status: AccountStatus;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  webhookSubscribed: boolean;
  webhookSubscribedAt: string | null;
  permissionsOk: boolean;
  missingPermissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaItem {
  id: string;
  mediaId: string;
  mediaType: string | null;
  mediaProductType: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
}

export interface Rule {
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
  followGate: 'off' | 'instruction';
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  url: string;
  slug: string;
  trackedUrl: string;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  workspaceId: string;
  accountId: string;
  ruleId: string | null;
  ruleName: string;
  commentId: string;
  mediaId: string | null;
  commenterUsername: string | null;
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
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  level: 'info' | 'warn' | 'error';
  code: string | null;
  message: string;
  createdAt: string;
}

export interface RunDetail {
  run: Run;
  events: RunEvent[];
}

export interface Member {
  userId: string;
  role: WorkspaceRole;
  email: string | null;
  fullName: string | null;
  createdAt: string;
}

export interface AnalyticsDailyPoint {
  date: string;
  commentsReceived: number;
  publicRepliesSent: number;
  privateRepliesSent: number;
}

export interface Analytics {
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

export interface UsageResponse {
  plan: { id: string; name: string; description: string | null; limits: PlanLimits };
  periodStart: string;
  metrics: Record<string, number>;
  counts: { accounts: number; rules: number; resources: number; members: number };
  metaLimits: {
    privateRepliesPerHour: number;
    privateReplyWindowDays: number;
    publicReplyMaxLength: number;
    privateReplyMaxLength: number;
  };
  notes: string[];
}

export interface Capability {
  status: 'VERIFIED' | 'CONDITIONAL' | 'UNVERIFIED' | 'UNSUPPORTED';
  summary: string;
  docs: string;
}

export interface ConfigResponse {
  environment: string;
  demoMode: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  apiPublicUrl: string;
  metaConfigured: boolean;
  graphVersion: string;
  webhookFields: string[];
  capabilities: Record<string, Capability>;
  followVerification: {
    available: boolean;
    status: Capability['status'];
    summary: string;
    docs: string;
    alternative: string;
  };
}

export interface RuleTestResult {
  matched: boolean;
  matchedKeyword: string | null;
  publicReply: { text: string; length: number; limit: number; errors: string[] } | null;
  privateReply: { text: string; length: number; limit: number; errors: string[] } | null;
  notes: string[];
}

export interface RuleInput {
  name: string;
  accountId: string;
  mediaId: string | null;
  keywords: string[];
  publicReplyTemplate: string | null;
  privateReplyTemplate: string | null;
  resourceId: string | null;
  followGate?: 'off' | 'instruction';
  priority?: number;
  enabled?: boolean;
}

export interface ResourceInput {
  title: string;
  description: string | null;
  url: string;
}
