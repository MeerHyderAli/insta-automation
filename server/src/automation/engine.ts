import type { AppConfig } from '../config/env.js';
import type { Store } from '../db/store.js';
import { MetaApiError } from '../integrations/instagram/errors.js';
import type { InstagramProvider } from '../integrations/instagram/provider.js';
import { tokenAad, type TokenCipher } from '../lib/crypto/tokenCipher.js';
import { redactSecrets } from '../lib/redact.js';
import type { LoggerLike } from '../lib/logger.js';
import type {
  AccountRecord,
  ResourceRecord,
  RuleRecord,
  RunRecord,
  WebhookEventRecord,
} from '../types/domain.js';
import { matchKeywords } from './matcher.js';
import {
  applyFollowInstructions,
  PRIVATE_REPLY_MAX_LENGTH,
  PUBLIC_REPLY_MAX_LENGTH,
  renderTemplate,
  type TemplateContext,
  validateTemplate,
} from './templates.js';

export type ProcessResult = 'completed' | 'retry' | 'dead';

export interface ProcessOutcome {
  result: ProcessResult;
  reason?: string;
}

const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface EngineDependencies {
  store: Store;
  provider: InstagramProvider;
  cipher: TokenCipher;
  config: AppConfig;
  logger: LoggerLike;
}

function deriveRunStatus(run: RunRecord): RunRecord['status'] {
  const statuses = [run.publicReplyStatus, run.privateReplyStatus].filter(
    (status) => status !== 'skipped',
  );
  if (statuses.length === 0) return 'skipped';
  if (statuses.some((status) => status === 'pending' || status === 'sending')) return 'processing';
  const sent = statuses.filter((status) => status === 'sent').length;
  if (sent === statuses.length) return 'completed';
  if (sent > 0) return 'partial';
  if (statuses.every((status) => status === 'failed')) return 'failed';
  return 'partial';
}

function classifySendFailure(error: unknown): {
  action: 'retry' | 'failed' | 'unknown';
  message: string;
  category: string;
} {
  if (error instanceof MetaApiError) {
    if (error.retryable)
      return { action: 'retry', message: error.userMessage, category: error.category };
    if (error.category === 'token' || error.category === 'permission') {
      return { action: 'failed', message: error.userMessage, category: error.category };
    }
    if (error.category === 'policy' || error.category === 'invalid_request') {
      return { action: 'failed', message: error.userMessage, category: error.category };
    }
    return { action: 'unknown', message: error.userMessage, category: error.category };
  }
  return {
    action: 'unknown',
    message: 'The request failed before Instagram confirmed delivery.',
    category: 'network',
  };
}

export class AutomationEngine {
  constructor(private readonly deps: EngineDependencies) {}

  /**
   * Processes one persisted webhook event. Safe to call more than once: a run
   * is unique per (account, comment) and reply actions are only attempted from
   * a not-yet-attempted state.
   */
  async processEvent(eventId: string): Promise<ProcessOutcome> {
    const { store, logger } = this.deps;
    const event = await store.getWebhookEvent(eventId);
    if (!event) return { result: 'dead', reason: 'event_not_found' };
    if (['processed', 'ignored', 'unsupported', 'failed'].includes(event.status)) {
      return { result: 'completed' };
    }

    await store.updateWebhookEvent(event.id, 'processing');

    if (event.field === 'live_comments') {
      await store.updateWebhookEvent(event.id, 'unsupported', 'live_comments_not_supported');
      return { result: 'completed', reason: 'live_comments_not_supported' };
    }
    if (!event.commentId) {
      await store.updateWebhookEvent(event.id, 'ignored', 'missing_comment_id');
      return { result: 'completed', reason: 'missing_comment_id' };
    }

    const account = event.accountId
      ? await store.getAccountById(event.accountId)
      : event.igAccountId
        ? await store.getAccountByIgUserId(event.igAccountId)
        : null;

    if (!account) {
      await store.updateWebhookEvent(event.id, 'ignored', 'account_not_found');
      return { result: 'completed', reason: 'account_not_found' };
    }

    if (account.status !== 'connected') {
      await store.updateWebhookEvent(event.id, 'ignored', `account_${account.status}`);
      return { result: 'completed', reason: `account_${account.status}` };
    }

    if (!event.commentText || event.commentText.trim().length === 0) {
      await store.updateWebhookEvent(event.id, 'ignored', 'empty_comment');
      return { result: 'completed', reason: 'empty_comment' };
    }
    if (
      event.commenterIgsid === account.igUserId ||
      (event.commenterUsername ?? '').toLowerCase() === account.username.toLowerCase()
    ) {
      await store.updateWebhookEvent(event.id, 'ignored', 'own_comment');
      return { result: 'completed', reason: 'own_comment' };
    }

    const workspace = await store.getWorkspace(account.workspaceId);
    if (!workspace) {
      await store.updateWebhookEvent(event.id, 'failed', 'workspace_missing');
      return { result: 'dead', reason: 'workspace_missing' };
    }
    const plan = await store.getPlan(workspace.planId);
    if (!plan) {
      await store.updateWebhookEvent(event.id, 'failed', 'plan_missing');
      return { result: 'dead', reason: 'plan_missing' };
    }

    let run: RunRecord | null = null;
    let created = false;

    if (event.workspaceId === null) {
      // Defensive: an event persisted without an account can never be processed.
      await store.updateWebhookEvent(event.id, 'ignored', 'account_not_found');
      return { result: 'completed', reason: 'account_not_found' };
    }

    const rules = await store.getEnabledRulesForAccount(account.id);
    const eligible = rules.filter(
      (rule) => rule.mediaId === null || rule.mediaId === event.mediaId,
    );
    let matchedRule: RuleRecord | null = null;
    let matchedKeyword: string | null = null;
    for (const rule of eligible) {
      const keyword = matchKeywords(event.commentText, rule.keywords);
      if (keyword) {
        matchedRule = rule;
        matchedKeyword = keyword;
        break;
      }
    }

    if (!matchedRule) {
      await store.updateWebhookEvent(event.id, 'ignored', 'no_keyword_match');
      await store
        .incrementUsage(account.workspaceId, 'events_processed', 1)
        .catch((cause) => this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'));
      return { result: 'completed', reason: 'no_keyword_match' };
    }

    const existingRun = await store.getRunByComment(account.id, event.commentId);
    if (existingRun) {
      run = existingRun;
    } else {
      const result = await store.createOrGetRun({
        workspaceId: account.workspaceId,
        accountId: account.id,
        webhookEventId: event.id,
        ruleId: matchedRule.id,
        ruleName: matchedRule.name,
        commentId: event.commentId,
        mediaId: event.mediaId,
        commenterUsername: event.commenterUsername,
        commenterIgsid: event.commenterIgsid,
        commentText: event.commentText,
        matchedKeyword: matchedKeyword ?? '',
      });
      run = result.run;
      created = result.created;
    }

    if (!run) {
      await store.updateWebhookEvent(event.id, 'failed', 'run_creation_failed');
      return { result: 'dead', reason: 'run_creation_failed' };
    }

    if (!created) {
      if (['completed', 'partial', 'failed', 'skipped'].includes(run.status)) {
        await store.updateWebhookEvent(event.id, run.status === 'failed' ? 'failed' : 'processed');
        return { result: 'completed', reason: 'already_processed' };
      }
      // A retried job continues an existing run; templates come from its rule.
    } else {
      const quota = await store.incrementUsage(
        account.workspaceId,
        'comments_processed',
        1,
        plan.limits.comments_month ?? null,
      );
      if (quota === null) {
        run = await store.updateRun(run.id, {
          status: 'skipped',
          skipReason: 'monthly_comment_quota_exceeded',
        });
        await store.addRunEvent({
          runId: run.id,
          workspaceId: account.workspaceId,
          level: 'warn',
          code: 'QUOTA_EXCEEDED',
          message: 'Monthly processed-comment limit reached; the comment was not automated.',
        });
        await store.updateWebhookEvent(event.id, 'ignored', 'monthly_comment_quota_exceeded');
        return { result: 'completed', reason: 'quota_exceeded' };
      }
      await store
        .incrementUsage(account.workspaceId, 'keyword_matches', 1)
        .catch((cause) => this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'));
      await store
        .incrementUsage(account.workspaceId, 'events_processed', 1)
        .catch((cause) => this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'));
      await store.addRunEvent({
        runId: run.id,
        workspaceId: account.workspaceId,
        level: 'info',
        code: 'MATCHED',
        message: `Matched keyword “${matchedKeyword ?? ''}” for automation “${run.ruleName}”.`,
      });
    }

    const rule = run.ruleId ? await store.getRule(account.workspaceId, run.ruleId) : null;
    if (!rule) {
      await store.updateRun(run.id, { status: 'skipped', skipReason: 'rule_deleted' });
      await store.updateWebhookEvent(event.id, 'ignored', 'rule_deleted');
      return { result: 'completed', reason: 'rule_deleted' };
    }

    const resource = rule.resourceId
      ? await store.getResource(account.workspaceId, rule.resourceId)
      : null;

    let shouldRetry = false;
    const context = this.buildContext(account, event, matchedKeyword ?? '', resource, rule);
    let token: string;
    try {
      token = this.deps.cipher.decrypt(account.token, tokenAad(account.id));
    } catch {
      await store.updateRun(run.id, { status: 'failed', skipReason: 'token_unavailable' });
      await store.updateAccountStatus(account.id, 'needs_reconnect', 'token_unavailable');
      await store.updateWebhookEvent(event.id, 'failed', 'token_unavailable');
      await store.addRunEvent({
        runId: run.id,
        workspaceId: account.workspaceId,
        level: 'error',
        code: 'RECONNECT_REQUIRED',
        message: 'The stored Instagram token could not be decrypted. Reconnect the account.',
      });
      return { result: 'dead', reason: 'token_unavailable' };
    }

    // Public reply ---------------------------------------------------------
    if (run.publicReplyStatus === 'sending') {
      run = await store.updateRun(run.id, {
        publicReplyStatus: 'unknown',
        publicReplyError: 'The server stopped before Instagram confirmed the reply.',
      });
      await store.addRunEvent({
        runId: run.id,
        workspaceId: account.workspaceId,
        level: 'warn',
        code: 'INTERRUPTED',
        message: 'Public reply state was left "sending" after an interruption; it was not resent.',
      });
    }

    if (
      rule.publicReplyTemplate &&
      (run.publicReplyStatus === 'skipped' || run.publicReplyStatus === 'pending')
    ) {
      const message = renderTemplate(rule.publicReplyTemplate, context);
      const templateErrors = validateTemplate(rule.publicReplyTemplate, {
        maxLength: PUBLIC_REPLY_MAX_LENGTH,
        label: 'Public reply',
        resourceAvailable: Boolean(resource),
      });
      if (templateErrors.length > 0 || message.length > PUBLIC_REPLY_MAX_LENGTH) {
        run = await store.updateRun(run.id, {
          publicReplyStatus: 'failed',
          publicReplyError: redactSecrets(
            templateErrors[0] ?? 'Rendered public reply exceeds the length limit.',
          ),
        });
        await store.addRunEvent({
          runId: run.id,
          workspaceId: account.workspaceId,
          level: 'error',
          code: 'TEMPLATE_INVALID',
          message: 'Public reply template failed validation at send time.',
        });
      } else {
        run = await store.updateRun(run.id, {
          publicReplyStatus: 'sending',
          incrementAttempts: true,
          lastAttemptAt: new Date(),
        });
        await store
          .incrementUsage(account.workspaceId, 'public_replies_attempted', 1)
          .catch((cause) =>
            this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'),
          );
        try {
          const reply = await this.deps.provider.replyToComment(token, event.commentId, message);
          run = await store.updateRun(run.id, {
            publicReplyStatus: 'sent',
            publicReplyId: reply.id,
            publicReplyError: null,
          });
          await store
            .incrementUsage(account.workspaceId, 'public_replies_sent', 1)
            .catch((cause) =>
              this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'),
            );
          await store.addRunEvent({
            runId: run.id,
            workspaceId: account.workspaceId,
            level: 'info',
            code: 'PUBLIC_REPLY_SENT',
            message: 'Instagram confirmed the public reply.',
          });
        } catch (error) {
          const failure = classifySendFailure(error);
          const nextStatus =
            failure.action === 'retry'
              ? 'pending'
              : failure.action === 'unknown'
                ? 'unknown'
                : 'failed';
          run = await store.updateRun(run.id, {
            publicReplyStatus: nextStatus,
            publicReplyError: redactSecrets(failure.message),
          });
          await this.handleAccountFailure(account, error);
          await store.addRunEvent({
            runId: run.id,
            workspaceId: account.workspaceId,
            level: failure.action === 'retry' ? 'warn' : 'error',
            code: failure.category.toUpperCase(),
            message: `Public reply not sent: ${redactSecrets(failure.message)}`,
          });
          if (failure.action === 'retry') shouldRetry = true;
        }
      }
    }

    // Private reply (one per comment, 7-day window) ------------------------
    if (run.privateReplyStatus === 'sending') {
      run = await store.updateRun(run.id, {
        privateReplyStatus: 'unknown',
        privateReplyError: 'The server stopped before Instagram confirmed the message.',
      });
      await store.addRunEvent({
        runId: run.id,
        workspaceId: account.workspaceId,
        level: 'warn',
        code: 'INTERRUPTED',
        message: 'Private reply state was left "sending" after an interruption; it was not resent.',
      });
    }

    if (
      rule.privateReplyTemplate &&
      (run.privateReplyStatus === 'skipped' || run.privateReplyStatus === 'pending')
    ) {
      const age = Date.now() - event.receivedAt.getTime();
      if (age > PRIVATE_REPLY_WINDOW_MS) {
        run = await store.updateRun(run.id, {
          privateReplyStatus: 'skipped',
          privateReplyError: 'The 7-day private-reply window has passed.',
        });
        await store.addRunEvent({
          runId: run.id,
          workspaceId: account.workspaceId,
          level: 'warn',
          code: 'WINDOW_EXPIRED',
          message: 'Private reply skipped: Instagram only allows it within 7 days of the comment.',
        });
      } else {
        const sentLastHour = await store.countPrivateRepliesSince(
          account.id,
          new Date(Date.now() - 60 * 60 * 1000),
        );
        if (sentLastHour >= this.deps.config.worker.privateRepliesPerHour) {
          run = await store.updateRun(run.id, {
            privateReplyStatus: 'skipped',
            privateReplyError: 'Local hourly private-reply safety limit reached.',
          });
          await store.addRunEvent({
            runId: run.id,
            workspaceId: account.workspaceId,
            level: 'warn',
            code: 'RATE_LIMIT_LOCAL',
            message: `Private reply skipped: local budget of ${this.deps.config.worker.privateRepliesPerHour}/hour reached.`,
          });
        } else {
          const rendered = applyFollowInstructions(
            renderTemplate(rule.privateReplyTemplate, context),
            rule.followGate,
            account.username,
          );
          if (rendered.length > PRIVATE_REPLY_MAX_LENGTH) {
            run = await store.updateRun(run.id, {
              privateReplyStatus: 'failed',
              privateReplyError: `Rendered private reply exceeds ${PRIVATE_REPLY_MAX_LENGTH} characters.`,
            });
            await store.addRunEvent({
              runId: run.id,
              workspaceId: account.workspaceId,
              level: 'error',
              code: 'TEMPLATE_INVALID',
              message: 'Private reply template failed validation at send time.',
            });
          } else {
            const quota = await store.incrementUsage(
              account.workspaceId,
              'private_replies_month',
              1,
              plan.limits.private_replies_month ?? null,
            );
            if (quota === null) {
              run = await store.updateRun(run.id, {
                privateReplyStatus: 'skipped',
                privateReplyError: 'Monthly private-reply quota reached.',
              });
              await store.addRunEvent({
                runId: run.id,
                workspaceId: account.workspaceId,
                level: 'warn',
                code: 'QUOTA_EXCEEDED',
                message:
                  'Private reply skipped: the plan monthly private-reply quota is exhausted.',
              });
            } else {
              run = await store.updateRun(run.id, {
                privateReplyStatus: 'sending',
                incrementAttempts: true,
                lastAttemptAt: new Date(),
              });
              await store
                .incrementUsage(account.workspaceId, 'private_replies_attempted', 1)
                .catch((cause) =>
                  this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'),
                );
              try {
                const message = await this.deps.provider.sendPrivateReply(
                  token,
                  account.igUserId,
                  event.commentId,
                  rendered,
                );
                run = await store.updateRun(run.id, {
                  privateReplyStatus: 'sent',
                  privateReplyMessageId: message.messageId,
                  privateReplyError: null,
                });
                await store
                  .incrementUsage(account.workspaceId, 'private_replies_sent', 1)
                  .catch((cause) =>
                    this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'),
                  );
                await store.addRunEvent({
                  runId: run.id,
                  workspaceId: account.workspaceId,
                  level: 'info',
                  code: 'PRIVATE_REPLY_SENT',
                  message: 'Instagram confirmed the private reply.',
                });
              } catch (error) {
                const failure = classifySendFailure(error);
                if (failure.action === 'retry') {
                  await store
                    .releaseUsage(account.workspaceId, 'private_replies_month', 1)
                    .catch((cause) =>
                      this.deps.logger.warn({ err: cause }, 'Usage accounting update failed'),
                    );
                  run = await store.updateRun(run.id, {
                    privateReplyStatus: 'pending',
                    privateReplyError: redactSecrets(failure.message),
                  });
                  shouldRetry = true;
                } else if (failure.action === 'unknown') {
                  run = await store.updateRun(run.id, {
                    privateReplyStatus: 'unknown',
                    privateReplyError: redactSecrets(failure.message),
                  });
                } else {
                  run = await store.updateRun(run.id, {
                    privateReplyStatus: 'failed',
                    privateReplyError: redactSecrets(failure.message),
                  });
                }
                await this.handleAccountFailure(account, error);
                await store.addRunEvent({
                  runId: run.id,
                  workspaceId: account.workspaceId,
                  level: failure.action === 'retry' ? 'warn' : 'error',
                  code: failure.category.toUpperCase(),
                  message: `Private reply not confirmed: ${redactSecrets(failure.message)}`,
                });
              }
            }
          }
        }
      }
    }

    const status = deriveRunStatus(run);
    run = await store.updateRun(run.id, { status });
    if (shouldRetry) {
      await store.updateWebhookEvent(event.id, 'processing', 'retrying');
    } else {
      const eventStatus =
        status === 'failed' ? 'failed' : status === 'skipped' ? 'ignored' : 'processed';
      await store.updateWebhookEvent(event.id, eventStatus, null);
    }

    logger.info(
      {
        eventId: event.id,
        runId: run.id,
        workspaceId: account.workspaceId,
        status,
        publicReplyStatus: run.publicReplyStatus,
        privateReplyStatus: run.privateReplyStatus,
      },
      'Automation event processed',
    );

    if (shouldRetry) return { result: 'retry', reason: 'retryable_meta_error' };
    return { result: 'completed' };
  }

  private buildContext(
    account: AccountRecord,
    event: WebhookEventRecord,
    keyword: string,
    resource: ResourceRecord | null,
    rule: RuleRecord,
  ): TemplateContext {
    return {
      username: event.commenterUsername ?? 'there',
      keyword,
      resourceUrl: resource?.url ?? '',
      resourceTitle: resource?.title ?? '',
      accountUsername: account.username,
      followInstructions: applyFollowInstructions('', rule.followGate, account.username).trim(),
    };
  }

  private async handleAccountFailure(account: AccountRecord, error: unknown): Promise<void> {
    if (!(error instanceof MetaApiError)) return;
    if (error.category === 'token') {
      await this.deps.store
        .updateAccountStatus(account.id, 'needs_reconnect', `META_${error.code ?? 'TOKEN'}`)
        .catch((cause) => {
          this.deps.logger.error(
            { err: cause, accountId: account.id },
            'Failed to mark Instagram account as needing reconnection',
          );
        });
    } else if (error.category === 'permission') {
      await this.deps.store
        .updateAccountStatus(
          account.id,
          'missing_permissions',
          `META_${error.code ?? 'PERMISSION'}`,
        )
        .catch((cause) => {
          this.deps.logger.error(
            { err: cause, accountId: account.id },
            'Failed to flag missing Instagram permissions',
          );
        });
    }
  }
}
