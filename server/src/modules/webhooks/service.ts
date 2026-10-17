import { randomUUID } from 'node:crypto';
import type { Store } from '../../db/store.js';
import type { AppConfig } from '../../config/env.js';
import type { LoggerLike } from '../../lib/logger.js';
import {
  commentDedupeKey,
  normalizeCommentWebhook,
} from '../../integrations/instagram/normalize.js';
import type { SignedRequestPayload } from '../../lib/crypto/signatures.js';

export interface IngestSummary {
  received: number;
  queued: number;
  duplicates: number;
  ignored: number;
  unsupported: number;
}

const MAX_BATCH = 1000;

/**
 * Durable webhook ingestion. Events are persisted and deduplicated before the
 * HTTP request is acknowledged; processing happens on the worker queue.
 */
export class WebhookService {
  constructor(
    private readonly deps: {
      store: Store;
      config: AppConfig;
      logger: LoggerLike;
    },
  ) {}

  async ingest(payload: unknown): Promise<IngestSummary> {
    const comments = normalizeCommentWebhook(payload);
    const summary: IngestSummary = {
      received: 0,
      queued: 0,
      duplicates: 0,
      ignored: 0,
      unsupported: 0,
    };
    if (comments.length === 0) return summary;
    if (comments.length > MAX_BATCH) {
      this.deps.logger.warn(
        { count: comments.length, max: MAX_BATCH },
        'Webhook batch exceeded 1000 comment entries; truncating',
      );
    }
    for (const comment of comments.slice(0, MAX_BATCH)) {
      summary.received += 1;
      const account = await this.deps.store.getAccountByIgUserId(comment.igAccountId);
      const dedupeKey = commentDedupeKey(comment.igAccountId, comment.field, comment.commentId);
      const { event, duplicate } = await this.deps.store.recordWebhookEvent({
        dedupeKey,
        workspaceId: account?.workspaceId ?? null,
        accountId: account?.id ?? null,
        igAccountId: comment.igAccountId,
        field: comment.field,
        commentId: comment.commentId,
        mediaId: comment.mediaId,
        commenterIgsid: comment.commenterIgsid,
        commenterUsername: comment.commenterUsername,
        commentText: comment.text,
        payload: comment.raw,
      });
      if (duplicate) {
        summary.duplicates += 1;
      }
      if (!account) {
        summary.ignored += 1;
        await this.deps.store
          .updateWebhookEvent(
            event.id,
            'ignored',
            'No connected account for this Instagram account id.',
          )
          .catch(() => undefined);
        continue;
      }
      if (comment.field === 'live_comments') {
        summary.unsupported += 1;
        await this.deps.store
          .updateWebhookEvent(
            event.id,
            'unsupported',
            'Live comment automation is disabled: the private-reply window is limited to the broadcast.',
          )
          .catch(() => undefined);
        continue;
      }
      // Retried deliveries may be persisted without a job if enqueueing failed
      // after the insert. Re-enqueue idempotently for events still "received".
      if (event.status === 'received' || duplicate) {
        await this.deps.store.enqueueJob({
          webhookEventId: event.id,
          workspaceId: account.workspaceId,
          accountId: account.id,
          maxAttempts: this.deps.config.worker.maxAttempts,
        });
        summary.queued += 1;
      }
    }
    return summary;
  }

  private async accountsForMetaUser(metaUserId: string | undefined) {
    if (!metaUserId) return [];
    return this.deps.store.getAccountsByMetaUserId(metaUserId);
  }

  async handleDeauthorize(payload: SignedRequestPayload): Promise<{ accounts: number }> {
    const accounts = await this.accountsForMetaUser(payload.user_id);
    for (const account of accounts) {
      await this.deps.store.disconnectAccount(account.id);
      await this.deps.store.recordAudit({
        workspaceId: account.workspaceId,
        actorUserId: null,
        action: 'instagram.deauthorized_by_meta',
        targetType: 'instagram_account',
        targetId: account.id,
      });
    }
    await this.deps.store.recordMetaDataRequest({
      code: randomUUID(),
      metaUserId: payload.user_id ?? null,
      kind: 'deauthorize',
      details: { accounts: accounts.length },
    });
    this.deps.logger.info({ accounts: accounts.length }, 'Meta deauthorization processed');
    return { accounts: accounts.length };
  }

  async handleDataDeletion(payload: SignedRequestPayload): Promise<{ code: string }> {
    const accounts = await this.accountsForMetaUser(payload.user_id);
    for (const account of accounts) {
      await this.deps.store.recordAudit({
        workspaceId: account.workspaceId,
        actorUserId: null,
        action: 'instagram.data_deletion_requested_via_meta',
        targetType: 'instagram_account',
        targetId: account.id,
        metadata: { metaUserId: payload.user_id ?? null },
      });
      await this.deps.store.deleteAccount(account.id);
    }
    const code = randomUUID();
    await this.deps.store.recordMetaDataRequest({
      code,
      metaUserId: payload.user_id ?? null,
      kind: 'data_deletion',
      details: { accountsDeleted: accounts.length },
    });
    this.deps.logger.info({ accounts: accounts.length }, 'Meta data deletion processed');
    return { code };
  }

  async deletionStatus(code: string) {
    return this.deps.store.getMetaDataRequest(code);
  }
}
