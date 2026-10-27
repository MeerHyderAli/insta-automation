import { resolveResourceLink, type AppConfig } from './config';
import {
  getUserFollowStatus,
  replyToComment,
  sendMessageToUser,
  sendPrivateReply,
  type FollowCheckResult,
} from './instagram';
import { findKeyword } from './keywords';
import type { CommentStore } from './store';
import {
  ANY_COMMENT_TRIGGER,
  GET_LINK_PAYLOAD,
  type CommentRecord,
  type FollowStatus,
  type MessageProcessSummary,
  type ParsedComment,
  type ParsedMessageEvent,
  type ProcessSummary,
} from './types';

export interface SendDmInput {
  igAccountId: string;
  commentId: string;
  message: string;
  quickReplyTitle?: string;
  quickReplyPayload?: string;
  accessToken: string;
  graphVersion: string;
}

export interface SendUserDmInput {
  igAccountId: string;
  recipientId: string;
  message: string;
  quickReplyTitle?: string;
  quickReplyPayload?: string;
  accessToken: string;
  graphVersion: string;
}

export interface CheckFollowInput {
  igsid: string;
  accessToken: string;
  graphVersion: string;
}

export interface ReplyToCommentInputForProcess {
  commentId: string;
  message: string;
  accessToken: string;
  graphVersion: string;
}

interface CommentReplyResultForProcess {
  commentId: string | null;
}

interface SendResult {
  messageId: string | null;
  recipientId?: string | null;
}

export interface ProcessDeps {
  store: CommentStore;
  config: AppConfig;
  /** Injectable for tests. Defaults to the real private-reply API call. */
  sendDm?: (input: SendDmInput) => Promise<SendResult>;
  /** Injectable for tests. Defaults to the real conversation-message call. */
  sendUserDm?: (input: SendUserDmInput) => Promise<SendResult>;
  /** Injectable for tests. Defaults to Meta's User Profile API. */
  checkFollow?: (input: CheckFollowInput) => Promise<FollowCheckResult>;
  /** Injectable for tests. Defaults to Meta's public comment-reply API. */
  replyToComment?: (
    input: ReplyToCommentInputForProcess,
  ) => Promise<CommentReplyResultForProcess>;
  now?: () => Date;
}

const MAX_DM_CHARS = 1000;

export function renderDmMessage(
  template: string,
  values: { username: string | null; keyword: string | null; link?: string | null },
): string {
  const username = values.username ? `@${values.username}` : 'there';
  const link = values.link ?? '';
  let rendered = template
    .replaceAll('{username}', username)
    .replaceAll('{keyword}', values.keyword ?? '')
    .replaceAll('{link}', link);
  if (link && !template.includes('{link}')) rendered = `${rendered} ${link}`;
  return rendered.slice(0, MAX_DM_CHARS);
}

function matchComment(comment: ParsedComment, config: AppConfig): string | null {
  if (config.commentMatchMode === 'any') {
    return comment.text.trim() ? ANY_COMMENT_TRIGGER : null;
  }
  return findKeyword(comment.text, config.keywords);
}

function keywordForMessage(matchedKeyword: string | null): string {
  return matchedKeyword === ANY_COMMENT_TRIGGER ? '' : (matchedKeyword ?? '');
}

function getLinkPayloadForComment(commentId: string): string {
  return `${GET_LINK_PAYLOAD}:${commentId}`;
}

function commentIdFromGetLinkPayload(payload: string | null): string | null {
  const prefix = `${GET_LINK_PAYLOAD}:`;
  return payload?.startsWith(prefix) ? payload.slice(prefix.length) || null : null;
}

async function resolveDashboardFirstResourceLink(
  store: CommentStore,
  config: AppConfig,
  mediaId: string | null,
): Promise<string | null> {
  if (mediaId) {
    const dashboardResource = await store.getMediaResource(mediaId);
    if (dashboardResource) return dashboardResource.url;
  }
  return resolveResourceLink(config, mediaId);
}

function usesPerMediaLinks(config: AppConfig): boolean {
  return (
    Object.keys(config.mediaLinks).length > 0 ||
    Boolean(config.defaultLinkUrl) ||
    config.dmMessage.includes('{link}')
  );
}

function toRecord(comment: ParsedComment, now: Date): CommentRecord {
  return {
    commentId: comment.commentId,
    commenterId: comment.commenterId,
    igAccountId: comment.igAccountId,
    mediaId: comment.mediaId,
    username: comment.username,
    text: comment.text,
    matchedKeyword: null,
    resourceLink: null,
    followStatus: 'not_checked',
    dmStatus: 'processing',
    dmMessageId: null,
    commentReplyStatus: 'not_sent',
    commentReplyId: null,
    commentReplyError: null,
    lastClickEventId: null,
    error: null,
    receivedAt: now.toISOString(),
  };
}

function safeErrorMessage(error: unknown, accessToken: string | null): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const redacted = accessToken ? message.split(accessToken).join('[REDACTED]') : message;
  return redacted.slice(0, 500);
}

async function runFollowCheck(
  checkFollow: (input: CheckFollowInput) => Promise<FollowCheckResult>,
  input: CheckFollowInput,
): Promise<FollowCheckResult> {
  try {
    return await checkFollow(input);
  } catch (error) {
    return {
      status: 'unverified',
      error: safeErrorMessage(error, input.accessToken),
    };
  }
}

type PublicCommentReplyOutcome = 'following' | 'not_following' | 'unverified';

function publicCommentReplyTemplate(
  config: AppConfig,
  outcome: PublicCommentReplyOutcome,
): string {
  if (outcome === 'following') return config.commentReplyFollowingMessage;
  if (outcome === 'not_following') return config.commentReplyNotFollowingMessage;
  return config.commentReplyUnverifiedMessage;
}

/**
 * Sends and records the optional public reply as a separate action. It must
 * never throw into the DM flow: a failed public reply does not undo a prompt
 * or change the strict second follow check.
 */
async function sendPublicCommentReply(input: {
  comment: ParsedComment;
  matchedKeyword: string;
  outcome: PublicCommentReplyOutcome;
  config: AppConfig;
  store: CommentStore;
  summary: ProcessSummary;
  reply: (
    replyInput: ReplyToCommentInputForProcess,
  ) => Promise<CommentReplyResultForProcess>;
}): Promise<void> {
  const { comment, config, store, summary } = input;

  try {
    if (!config.commentReplyEnabled) {
      await store.update(comment.commentId, {
        commentReplyStatus: 'skipped',
        commentReplyError: null,
      });
      return;
    }

    if (config.dryRun) {
      await store.update(comment.commentId, {
        commentReplyStatus: 'dry_run',
        commentReplyError: null,
      });
      return;
    }

    if (!config.accessToken) {
      await store.update(comment.commentId, {
        commentReplyStatus: 'failed',
        commentReplyError: 'IG_ACCESS_TOKEN is not configured',
      });
      summary.commentRepliesFailed += 1;
      return;
    }

    const result = await input.reply({
      commentId: comment.commentId,
      message: renderDmMessage(
        publicCommentReplyTemplate(config, input.outcome),
        {
          username: comment.username,
          keyword: keywordForMessage(input.matchedKeyword),
        },
      ),
      accessToken: config.accessToken,
      graphVersion: config.graphVersion,
    });

    await store.update(comment.commentId, {
      commentReplyStatus: 'sent',
      commentReplyId: result.commentId,
      commentReplyError: null,
    });
    summary.commentRepliesSent += 1;
  } catch (error) {
    summary.commentRepliesFailed += 1;
    try {
      await store.update(comment.commentId, {
        commentReplyStatus: 'failed',
        commentReplyError: safeErrorMessage(error, config.accessToken),
      });
    } catch {
      // The public reply is an auxiliary action; storage failure here must
      // not turn an already-sent DM prompt into a failed DM.
    }
  }
}

/**
 * Comment stage:
 * claim -> keyword match -> FOLLOW CHECK #1 -> thank-you prompt + button.
 *
 * The first check is fail-closed when enabled. It runs before even the
 * prompt DM: false/unverified means no private reply at all. A second,
 * separate check runs after the button tap in processMessageEvents().
 */
export async function processCommentEvents(
  comments: ParsedComment[],
  deps: ProcessDeps,
): Promise<ProcessSummary> {
  const { store, config } = deps;
  const sendDm =
    deps.sendDm ??
    ((input: SendDmInput) =>
      sendPrivateReply({
        igAccountId: input.igAccountId,
        commentId: input.commentId,
        message: input.message,
        quickReplies:
          input.quickReplyTitle && input.quickReplyPayload
            ? [{ title: input.quickReplyTitle, payload: input.quickReplyPayload }]
            : undefined,
        accessToken: input.accessToken,
        graphVersion: input.graphVersion,
      }));
  const hasInjectedFollowChecker = Boolean(deps.checkFollow);
  const checkFollow =
    deps.checkFollow ?? ((input: CheckFollowInput) => getUserFollowStatus(input));
  const replyToPublicComment =
    deps.replyToComment ??
    ((input: ReplyToCommentInputForProcess) => replyToComment(input));
  const now = deps.now ?? (() => new Date());

  const summary: ProcessSummary = {
    received: 0,
    matched: 0,
    promptSent: 0,
    commentRepliesSent: 0,
    commentRepliesFailed: 0,
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
      const isOwnComment = Boolean(
        comment.commenterId &&
          ((comment.igAccountId && comment.commenterId === comment.igAccountId) ||
            (config.igAccountId && comment.commenterId === config.igAccountId) ||
            (comment.selfIgScopedId && comment.commenterId === comment.selfIgScopedId)),
      );
      const isAutomationReply = Boolean(
        await store.findRecordByCommentReplyId(comment.commentId),
      );
      if (isOwnComment || isAutomationReply) {
        await store.update(comment.commentId, {
          dmStatus: 'skipped_own_comment',
          commentReplyStatus: 'skipped',
        });
        summary.skippedOwn += 1;
        continue;
      }

      const matchedKeyword = matchComment(comment, config);
      if (!matchedKeyword) {
        await store.update(comment.commentId, { dmStatus: 'not_matched' });
        summary.notMatched += 1;
        continue;
      }

      // In any-comment mode, one person gets at most one prompt/link flow
      // per Reel/post; extra comments on the same media are recorded only.
      if (
        config.commentMatchMode === 'any' &&
        comment.commenterId &&
        comment.mediaId &&
        (await store.hasHandledCommentForUserMedia(
          comment.commenterId,
          comment.mediaId,
          comment.commentId,
        ))
      ) {
        await store.update(comment.commentId, {
          dmStatus: 'skipped_duplicate_for_media',
          matchedKeyword,
          error: 'This user already has a prompt or link flow for this Reel/post',
        });
        summary.duplicates += 1;
        continue;
      }
      summary.matched += 1;

      // Select this Reel/post's resource now and store it on the record, so
      // a later button tap cannot accidentally deliver another Reel's link.
      const resourceLink = await resolveDashboardFirstResourceLink(store, config, comment.mediaId);
      if (!resourceLink && config.mediaLinksConfigError) {
        await store.update(comment.commentId, {
          dmStatus: 'failed',
          matchedKeyword,
          resourceLink: null,
          error: config.mediaLinksConfigError,
        });
        summary.failed += 1;
        continue;
      }
      if (usesPerMediaLinks(config) && !resourceLink) {
        await store.update(comment.commentId, {
          dmStatus: 'failed',
          matchedKeyword,
          resourceLink: null,
          error: comment.mediaId
            ? `No link configured for media ${comment.mediaId}; add it in the dashboard Reel resources section (or MEDIA_LINKS_JSON / DEFAULT_LINK_URL)`
            : 'Webhook did not include a media id and DEFAULT_LINK_URL is not configured',
        });
        summary.failed += 1;
        continue;
      }
      await store.update(comment.commentId, { matchedKeyword, resourceLink });

      let followStatus: FollowStatus = 'not_checked';

      // FOLLOW CHECK #1 — before the "Thanks for commenting" prompt DM.
      // Meta only grants User Profile consent after a messaging interaction,
      // so a comment-first user is normally unverified here (error 230).
      // PROMPT_UNVERIFIED_COMMENTERS lets that user receive the prompt; the
      // button tap is the messaging interaction used by strict check #2.
      if (config.requireFollowBeforePrompt) {
        const commenterId = comment.commenterId;

        if (config.dryRun && !hasInjectedFollowChecker) {
          if (!config.promptUnverifiedCommenters) {
            await store.update(comment.commentId, {
              dmStatus: 'skipped_follow_unverified',
              matchedKeyword,
              followStatus: 'unverified',
              error: 'Follow status is not checked in DRY_RUN mode; no reply sent',
            });
            summary.skippedFollowUnverified += 1;
            continue;
          }
          followStatus = 'unverified';
        } else if (!config.accessToken && !config.dryRun) {
          await store.update(comment.commentId, {
            dmStatus: 'failed',
            matchedKeyword,
            followStatus: 'unverified',
            error: 'IG_ACCESS_TOKEN is not configured',
          });
          summary.failed += 1;
          continue;
        } else if (!commenterId) {
          if (!config.promptUnverifiedCommenters) {
            await store.update(comment.commentId, {
              dmStatus: 'skipped_follow_unverified',
              matchedKeyword,
              followStatus: 'unverified',
              error: 'Webhook did not include the commenter Instagram-scoped ID',
            });
            summary.skippedFollowUnverified += 1;
            continue;
          }
          followStatus = 'unverified';
        } else {
          const followResult = await runFollowCheck(checkFollow, {
            igsid: commenterId,
            accessToken: config.accessToken ?? '',
            graphVersion: config.graphVersion,
          });

          if (followResult.status === 'not_following') {
            await store.update(comment.commentId, {
              dmStatus: 'skipped_not_following',
              matchedKeyword,
              followStatus: 'not_following',
              error: 'First follow check: Meta reported that this user does not follow the account',
            });
            summary.skippedNotFollowing += 1;
            await sendPublicCommentReply({
              comment,
              matchedKeyword,
              outcome: 'not_following',
              config,
              store,
              summary,
              reply: replyToPublicComment,
            });
            continue;
          }

          if (followResult.status === 'unverified') {
            if (!config.promptUnverifiedCommenters) {
              await store.update(comment.commentId, {
                dmStatus: 'skipped_follow_unverified',
                matchedKeyword,
                followStatus: 'unverified',
                error: followResult.error,
              });
              summary.skippedFollowUnverified += 1;
              continue;
            }
            followStatus = 'unverified';
          } else {
            followStatus = 'following';
          }
        }
      }

      if (config.dryRun) {
        await store.update(comment.commentId, {
          dmStatus: 'dry_run',
          matchedKeyword,
          followStatus,
          commentReplyStatus: config.commentReplyEnabled ? 'dry_run' : 'skipped',
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
      const result = await sendDm({
        igAccountId: comment.igAccountId ?? config.igAccountId ?? 'me',
        commentId: comment.commentId,
        message: renderDmMessage(config.introMessage, {
          username: comment.username,
          keyword: keywordForMessage(matchedKeyword),
        }),
        quickReplyTitle: config.getLinkButtonText,
        quickReplyPayload: getLinkPayloadForComment(comment.commentId),
        accessToken: config.accessToken,
        graphVersion: config.graphVersion,
      });

      await store.update(comment.commentId, {
        dmStatus: 'prompt_sent',
        matchedKeyword,
        followStatus,
        // The private-reply response returns the recipient IGSID. Prefer it
        // for matching the later messaging webhook sender.id.
        commenterId: result.recipientId ?? comment.commenterId,
        dmMessageId: result.messageId,
        error: null,
      });
      summary.promptSent += 1;
      await sendPublicCommentReply({
        comment,
        matchedKeyword,
        outcome: followStatus === 'following' ? 'following' : 'unverified',
        config,
        store,
        summary,
        reply: replyToPublicComment,
      });
    } catch (error) {
      await store.update(comment.commentId, {
        dmStatus: 'failed',
        matchedKeyword: matchComment(comment, config),
        error: safeErrorMessage(error, config.accessToken),
      });
      summary.failed += 1;
    }
  }

  return summary;
}

function isGetLinkTrigger(event: ParsedMessageEvent, config: AppConfig): boolean {
  if (event.payload === GET_LINK_PAYLOAD || commentIdFromGetLinkPayload(event.payload)) return true;
  const text = event.text.trim().toLowerCase();
  if (!text) return false;
  return new Set([
    config.getLinkButtonText.toLowerCase(),
    config.tryAgainButtonText.toLowerCase(),
    'click to get link',
    'click here to get link',
    'get link',
    'try again',
  ]).has(text);
}

/**
 * Button-tap stage:
 * find pending prompt -> atomically claim this click -> FOLLOW CHECK #2 ->
 * link message, or follow/try-again prompt.
 *
 * The second check is deliberate even though the comment already passed
 * check #1: the user may have unfollowed between commenting and tapping,
 * and the tap gives us a messaging IGSID for the profile lookup.
 */
export async function processMessageEvents(
  events: ParsedMessageEvent[],
  deps: ProcessDeps,
): Promise<MessageProcessSummary> {
  const { store, config } = deps;
  const sendUserDm =
    deps.sendUserDm ??
    ((input: SendUserDmInput) =>
      sendMessageToUser({
        igAccountId: input.igAccountId,
        recipientId: input.recipientId,
        message: input.message,
        quickReplies:
          input.quickReplyTitle && input.quickReplyPayload
            ? [{ title: input.quickReplyTitle, payload: input.quickReplyPayload }]
            : undefined,
        accessToken: input.accessToken,
        graphVersion: input.graphVersion,
      }));
  const checkFollow =
    deps.checkFollow ?? ((input: CheckFollowInput) => getUserFollowStatus(input));

  const summary: MessageProcessSummary = {
    received: 0,
    clicks: 0,
    linkSent: 0,
    followPromptSent: 0,
    duplicates: 0,
    ignored: 0,
    noPending: 0,
    failed: 0,
    dryRun: 0,
  };

  for (const event of events) {
    summary.received += 1;

    if (config.igAccountId && event.igAccountId && config.igAccountId !== event.igAccountId) {
      summary.ignored += 1;
      continue;
    }
    if (event.igAccountId && event.senderId === event.igAccountId) {
      summary.ignored += 1;
      continue;
    }
    if (!isGetLinkTrigger(event, config)) {
      summary.ignored += 1;
      continue;
    }
    summary.clicks += 1;

    // New buttons encode the exact comment/Reel in their payload. This
    // matters when one user has pending prompts from different Reels:
    // never fall back to a different Reel for an exact-payload tap.
    const payloadCommentId = commentIdFromGetLinkPayload(event.payload);
    let pending: CommentRecord | null;
    if (payloadCommentId) {
      const exactPending = await store.findPendingByCommentId(payloadCommentId);
      pending =
        exactPending && exactPending.commenterId === event.senderId ? exactPending : null;
    } else {
      pending = await store.findLatestPendingByCommenterId(event.senderId);
    }
    if (!pending) {
      summary.noPending += 1;
      continue;
    }
    if (pending.lastClickEventId === event.eventId) {
      summary.duplicates += 1;
      continue;
    }
    if (config.dryRun) {
      summary.dryRun += 1;
      continue;
    }
    if (!config.accessToken) {
      await store.update(pending.commentId, {
        error: 'IG_ACCESS_TOKEN is not configured',
      });
      summary.failed += 1;
      continue;
    }
    // Dashboard edits for this exact Reel win at tap time (useful for
    // correcting a link), then the snapshot stored with the comment, then
    // the optional env mapping/fallback.
    const dashboardResource = pending.mediaId
      ? await store.getMediaResource(pending.mediaId)
      : null;
    const resourceLink =
      dashboardResource?.url ??
      pending.resourceLink ??
      resolveResourceLink(config, pending.mediaId);
    if (!resourceLink && (config.mediaLinksConfigError || usesPerMediaLinks(config))) {
      await store.update(pending.commentId, {
        error:
          config.mediaLinksConfigError ??
          (pending.mediaId
            ? `No link configured for media ${pending.mediaId}; add it in the dashboard Reel resources section (or MEDIA_LINKS_JSON / DEFAULT_LINK_URL)`
            : 'No DEFAULT_LINK_URL configured for this comment'),
      });
      summary.failed += 1;
      continue;
    }

    const previousPendingStatus = pending.dmStatus;
    const claimed = await store.tryClaimClick(pending.commentId, event.eventId);
    if (!claimed) {
      summary.ignored += 1;
      continue;
    }

    let latestFollowStatus: FollowStatus = claimed.followStatus;
    try {
      // FOLLOW CHECK #2 — after the Get Link / Try again button tap.
      if (config.requireFollowForLink) {
        const followResult = await runFollowCheck(checkFollow, {
          igsid: event.senderId,
          accessToken: config.accessToken,
          graphVersion: config.graphVersion,
        });

        if (followResult.status === 'not_following' || followResult.status === 'unverified') {
          latestFollowStatus = followResult.status;
          const promptTemplate =
            followResult.status === 'not_following'
              ? config.notFollowingMessage
              : config.followUnverifiedMessage;
          const promptResult = await sendUserDm({
            igAccountId: event.igAccountId ?? claimed.igAccountId ?? config.igAccountId ?? 'me',
            recipientId: event.senderId,
            message: renderDmMessage(promptTemplate, {
              username: claimed.username,
              keyword: keywordForMessage(claimed.matchedKeyword),
            }),
            quickReplyTitle: config.tryAgainButtonText,
            quickReplyPayload: getLinkPayloadForComment(claimed.commentId),
            accessToken: config.accessToken,
            graphVersion: config.graphVersion,
          });

          await store.update(claimed.commentId, {
            dmStatus: 'follow_prompt_sent',
            followStatus: latestFollowStatus,
            resourceLink,
            dmMessageId: promptResult.messageId,
            error:
              followResult.status === 'unverified'
                ? followResult.error
                : 'Second follow check: Meta reported that this user does not follow the account',
          });
          summary.followPromptSent += 1;
          continue;
        }

        latestFollowStatus = 'following';
      }

      const linkResult = await sendUserDm({
        igAccountId: event.igAccountId ?? claimed.igAccountId ?? config.igAccountId ?? 'me',
        recipientId: event.senderId,
        message: renderDmMessage(config.dmMessage, {
          username: claimed.username,
          keyword: keywordForMessage(claimed.matchedKeyword),
          link: resourceLink,
        }),
        accessToken: config.accessToken,
        graphVersion: config.graphVersion,
      });

      await store.update(claimed.commentId, {
        dmStatus: 'link_sent',
        followStatus: latestFollowStatus,
        resourceLink,
        dmMessageId: linkResult.messageId,
        error: null,
      });
      summary.linkSent += 1;
    } catch (error) {
      // Restore the pending state so a later, distinct tap/text can retry.
      await store.update(claimed.commentId, {
        dmStatus: previousPendingStatus,
        followStatus: latestFollowStatus,
        resourceLink,
        error: safeErrorMessage(error, config.accessToken),
      });
      summary.failed += 1;
    }
  }

  return summary;
}
