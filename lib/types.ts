export const GET_LINK_PAYLOAD = 'GET_LINK_V1';

export type DmStatus =
  | 'processing'
  | 'checking_follow'
  | 'prompt_sent'
  | 'follow_prompt_sent'
  | 'link_sent'
  | 'sent'
  | 'failed'
  | 'not_matched'
  | 'dry_run'
  | 'skipped_own_comment'
  | 'skipped_not_following'
  | 'skipped_follow_unverified';

export type FollowStatus = 'following' | 'not_following' | 'unverified' | 'not_checked';

export interface CommentRecord {
  commentId: string;
  commenterId: string | null;
  igAccountId: string | null;
  mediaId: string | null;
  username: string | null;
  text: string;
  matchedKeyword: string | null;
  followStatus: FollowStatus;
  dmStatus: DmStatus;
  dmMessageId: string | null;
  lastClickEventId: string | null;
  error: string | null;
  /** ISO-8601 */
  receivedAt: string;
}

export type CommentPatch = Partial<
  Pick<
    CommentRecord,
    | 'commenterId'
    | 'dmStatus'
    | 'matchedKeyword'
    | 'followStatus'
    | 'dmMessageId'
    | 'lastClickEventId'
    | 'error'
  >
>;

export interface ParsedComment {
  commentId: string;
  igAccountId: string | null;
  mediaId: string | null;
  commenterId: string | null;
  username: string | null;
  text: string;
  /** Unix seconds from the webhook entry, when present. */
  timestamp: number | null;
}

export interface ParsedMessageEvent {
  /** Meta message/postback id, or a deterministic fallback for dedupe. */
  eventId: string;
  igAccountId: string | null;
  senderId: string;
  recipientId: string | null;
  payload: string | null;
  text: string;
  kind: 'quick_reply' | 'postback' | 'text';
  /** Unix milliseconds from the messaging event, when present. */
  timestamp: number | null;
}

export interface ProcessSummary {
  received: number;
  matched: number;
  promptSent: number;
  dryRun: number;
  notMatched: number;
  failed: number;
  duplicates: number;
  skippedOwn: number;
  skippedOtherAccount: number;
  skippedNotFollowing: number;
  skippedFollowUnverified: number;
}

export interface MessageProcessSummary {
  received: number;
  clicks: number;
  linkSent: number;
  followPromptSent: number;
  duplicates: number;
  ignored: number;
  noPending: number;
  failed: number;
  dryRun: number;
}
