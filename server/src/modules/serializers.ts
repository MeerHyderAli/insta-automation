import type { AppConfig } from '../config/env.js';
import type {
  AccountRecord,
  MemberRecord,
  ProfileRecord,
  ResourceRecord,
  RuleRecord,
  RunEventRecord,
  RunRecord,
  WebhookEventRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceWithRole,
} from '../types/domain.js';

export const REQUIRED_SCOPES = ['instagram_business_basic', 'instagram_business_manage_comments'];
export const TOKEN_WARNING_DAYS = 7;

export function profileDto(profile: ProfileRecord) {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function workspaceDto(
  workspace: WorkspaceRecord | WorkspaceWithRole,
  role: WorkspaceRole,
  plan: WorkspaceWithRole['plan'] | null = null,
) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    planId: workspace.planId,
    planName: plan?.name ?? ('plan' in workspace ? workspace.plan?.name : null) ?? workspace.planId,
    planLimits: plan?.limits ?? ('plan' in workspace ? workspace.plan?.limits : null) ?? null,
    timezone: workspace.timezone,
    role,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export function memberDto(member: MemberRecord) {
  return {
    userId: member.userId,
    role: member.role,
    email: member.email,
    fullName: member.fullName,
    createdAt: member.createdAt.toISOString(),
  };
}

export function daysUntil(date: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Deliberately excludes encrypted token fields. There is no code path that
 * serialises `account.token`; the browser never receives credential material.
 */
export function accountDto(account: AccountRecord, now = new Date()) {
  const missingPermissions = REQUIRED_SCOPES.filter((scope) => !account.scopes.includes(scope));
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    igUserId: account.igUserId,
    username: account.username,
    accountType: account.accountType,
    scopes: account.scopes,
    tokenExpiresAt: account.tokenExpiresAt.toISOString(),
    tokenExpiresInDays: daysUntil(account.tokenExpiresAt, now),
    status: account.status,
    lastErrorCode: account.lastErrorCode,
    lastErrorAt: account.lastErrorAt?.toISOString() ?? null,
    webhookSubscribed: account.webhookSubscribedAt !== null,
    webhookSubscribedAt: account.webhookSubscribedAt?.toISOString() ?? null,
    permissionsOk: missingPermissions.length === 0,
    missingPermissions,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function ruleDto(rule: RuleRecord) {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    accountId: rule.accountId,
    name: rule.name,
    enabled: rule.enabled,
    mediaId: rule.mediaId,
    keywords: rule.keywords,
    publicReplyTemplate: rule.publicReplyTemplate,
    privateReplyTemplate: rule.privateReplyTemplate,
    resourceId: rule.resourceId,
    followGate: rule.followGate,
    priority: rule.priority,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

export function resourceDto(resource: ResourceRecord, config: AppConfig) {
  return {
    id: resource.id,
    workspaceId: resource.workspaceId,
    title: resource.title,
    description: resource.description,
    url: resource.url,
    slug: resource.slug,
    trackedUrl: `${config.apiPublicUrl}/r/${resource.slug}`,
    clickCount: resource.clickCount,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
  };
}

export function runDto(run: RunRecord) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    accountId: run.accountId,
    ruleId: run.ruleId,
    ruleName: run.ruleName,
    commentId: run.commentId,
    mediaId: run.mediaId,
    commenterUsername: run.commenterUsername,
    commentText: run.commentText,
    matchedKeyword: run.matchedKeyword,
    status: run.status,
    skipReason: run.skipReason,
    publicReplyStatus: run.publicReplyStatus,
    publicReplyId: run.publicReplyId,
    publicReplyError: run.publicReplyError,
    privateReplyStatus: run.privateReplyStatus,
    privateReplyMessageId: run.privateReplyMessageId,
    privateReplyError: run.privateReplyError,
    attempts: run.attempts,
    lastAttemptAt: run.lastAttemptAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function runEventDto(event: RunEventRecord) {
  return {
    id: event.id,
    level: event.level,
    code: event.code,
    message: event.message,
    createdAt: event.createdAt.toISOString(),
  };
}

export function webhookEventDto(event: WebhookEventRecord) {
  return {
    id: event.id,
    field: event.field,
    status: event.status,
    commentId: event.commentId,
    mediaId: event.mediaId,
    duplicateCount: event.duplicateCount,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}
