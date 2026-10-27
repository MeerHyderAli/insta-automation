import type { AppConfig } from './config';
import {
  getUserFollowStatus,
  sendPrivateReply,
  type FollowCheckResult,
} from './instagram';
import { findKeyword } from './keywords';
import type { CommentStore } from './store';
import type { CommentRecord, FollowStatus, ParsedComment, ProcessSummary } from './types';

export interface SendDmInput {
  igAccountId: string;
  commentId: string;
  message: string;
  accessToken: string;
  graphVersion: string;
}

export interface CheckFollowInput {
  igsid: string;
  accessToken: string;
  graphVersion: string;
}

export interface ProcessDeps {
  store: CommentStore;
  config: AppConfig;
  /** Injectable for tests. Defaults to the real Instagram API call. */
  sendDm?: (input: SendDmInput) => Promise<{ messageId: string | null }>;
  /** Injectable for tests. Defaults to Meta's User Profile API. */
  checkFollow?: (input: CheckFollowInput) => Promise<FollowCheckResult>;
  now?: () => Date;
}

const MAX_DM_CHARS = 1000;

export function renderDmMessage(
  template: string,
  values: { username: string | null; keyword: string | null },
): string {
  const username = values.username ? `@${values.username}` : 'there';
  return template
    .replaceAll('{username}', username)
    .replaceAll('{keyword}', values.keyword ?? '')
    .slice(0, MAX_DM_CHARS);
}

function toRecord(comment: ParsedComment, now: Date): CommentRecord {
  return {
    commentId: comment.commentId,
    igAccountId: comment.igAccountId,
    mediaId: comment.mediaId,
    username: comment.username,
    text: comment.text,
    matchedKeyword: null,
    followStatus: 'not_checked',
    dmStatus: 'processing',
    dmMessageId: null,
    error: null,
    receivedAt: now.toISOString(),
  };
}

function safeErrorMessage(error: unknown, accessToken: string | null): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const redacted = accessToken ? message.split(accessToken).join('[REDACTED]') : message;
  return redacted.slice(0, 500);
}

/**
 * Processes parsed comment events:
 * claim (dedupe) -> keyword match -> follower verification -> DM -> record.
 *
 * Follower verification is fail-closed when enabled: the private reply is
 * sent only after Meta's profile API returns `is_user_follow_business=true`.
 * A false value, a missing IGSID, a consent error, or any other inability to
 * verify means no reply is sent.
 */
export async function processCommentEvents(
  comments: ParsedComment[],
  deps: ProcessDeps,
): Promise<ProcessSummary> {
  const { store, config } = deps;
  const sendDm =
    deps.sendDm ?? ((input: SendDmInput) => sendPrivateReply(input));
  const hasInjectedFollowChecker = Boolean(deps.checkFollow);
  const checkFollow =
    deps.checkFollow ?? ((input: CheckFollowInput) => getUserFollowStatus(input));
  const now = deps.now ?? (() => new Date());

  const summary: ProcessSummary = {
    received: 0,
    matched: 0,
    sent: 0,
    dryRun: 0,
    notMatched: 0,
    failed: 0,
    duplicates: 0,
    skippedOwn: 0,
    skippedOtherAccount: 0,
    skippedNotFollowing: 0,
    skippedFollowUnverified: 0,
  };

  for (const comment of comments) {
    summary.received += 1;

    if (config.igAccountId && comment.igAccountId && config.igAccountId !== comment.igAccountId) {
      summary.skippedOtherAccount += 1;
      continue;
    }

    const claimed = await store.tryClaim(toRecord(comment, now()));
    if (!claimed) {
      summary.duplicates += 1;
      continue;
    }

    try {
      // Never DM yourself when you comment on your own post.
      if (
        comment.commenterId &&
        comment.igAccountId &&
        comment.commenterId === comment.igAccountId
      ) {
        await store.update(comment.commentId, { dmStatus: 'skipped_own_comment' });
        summary.skippedOwn += 1;
        continue;
      }

      const matchedKeyword = findKeyword(comment.text, config.keywords);
      if (!matchedKeyword) {
        await store.update(comment.commentId, { dmStatus: 'not_matched' });
        summary.notMatched += 1;
        continue;
      }
      summary.matched += 1;

      let followStatus: FollowStatus = 'not_checked';

      if (config.requireFollow) {
        // Preserve the existing meaning of DRY_RUN (no Instagram API calls)
        // in production code. Tests may inject a checker explicitly, but a
        // local simulated comment must never be treated as a verified follow.
        if (config.dryRun && !hasInjectedFollowChecker) {
          await store.update(comment.commentId, {
            dmStatus: 'skipped_follow_unverified',
            matchedKeyword,
            followStatus: 'unverified',
            error: 'Follow status is not checked in DRY_RUN mode; no reply sent',
          });
          summary.skippedFollowUnverified += 1;
          continue;
        }

        if (!config.accessToken && !config.dryRun) {
          await store.update(comment.commentId, {
            dmStatus: 'failed',
            matchedKeyword,
            followStatus: 'unverified',
            error: 'IG_ACCESS_TOKEN is not configured',
          });
          summary.failed += 1;
          continue;
        }

        if (!comment.commenterId) {
          await store.update(comment.commentId, {
            dmStatus: 'skipped_follow_unverified',
            matchedKeyword,
            followStatus: 'unverified',
            error: 'Webhook did not include the commenter Instagram-scoped ID',
          });
          summary.skippedFollowUnverified += 1;
          continue;
        }

        let followResult: FollowCheckResult;
        try {
          followResult = await checkFollow({
            igsid: comment.commenterId,
            accessToken: config.accessToken ?? '',
            graphVersion: config.graphVersion,
          });
        } catch (error) {
          followResult = {
            status: 'unverified',
            error: safeErrorMessage(error, config.accessToken),
          };
        }

        if (followResult.status === 'not_following') {
          await store.update(comment.commentId, {
            dmStatus: 'skipped_not_following',
            matchedKeyword,
            followStatus: 'not_following',
            error: 'Meta reported that this user does not follow the account',
          });
          summary.skippedNotFollowing += 1;
          continue;
        }

        if (followResult.status === 'unverified') {
          await store.update(comment.commentId, {
            dmStatus: 'skipped_follow_unverified',
            matchedKeyword,
            followStatus: 'unverified',
            error: followResult.error,
          });
          summary.skippedFollowUnverified += 1;
          continue;
        }

        followStatus = 'following';
      }

      if (config.dryRun) {
        await store.update(comment.commentId, {
          dmStatus: 'dry_run',
          matchedKeyword,
          followStatus,
        });
        summary.dryRun += 1;
        continue;
      }
      if (!config.accessToken) {
        await store.update(comment.commentId, {
          dmStatus: 'failed',
          matchedKeyword,
          followStatus,
          error: 'IG_ACCESS_TOKEN is not configured',
        });
        summary.failed += 1;
        continue;
      }
      if (!config.dmMessage) {
        await store.update(comment.commentId, {
          dmStatus: 'failed',
          matchedKeyword,
          followStatus,
          error: 'DM_MESSAGE is not configured',
        });
        summary.failed += 1;
        continue;
      }

      const result = await sendDm({
        igAccountId: comment.igAccountId ?? config.igAccountId ?? 'me',
        commentId: comment.commentId,
        message: renderDmMessage(config.dmMessage, {
          username: comment.username,
          keyword: matchedKeyword,
        }),
        accessToken: config.accessToken,
        graphVersion: config.graphVersion,
      });

      await store.update(comment.commentId, {
        dmStatus: 'sent',
        matchedKeyword,
        followStatus,
        dmMessageId: result.messageId,
      });
      summary.sent += 1;
    } catch (error) {
      await store.update(comment.commentId, {
        dmStatus: 'failed',
        matchedKeyword: findKeyword(comment.text, config.keywords),
        error: safeErrorMessage(error, config.accessToken),
      });
      summary.failed += 1;
    }
  }

  return summary;
}
