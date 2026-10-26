export type DmStatus =
  | 'processing'
  | 'sent'
  | 'failed'
  | 'not_matched'
  | 'dry_run'
  | 'skipped_own_comment';

export interface CommentRecord {
  commentId: string;
  igAccountId: string | null;
  mediaId: string | null;
  username: string | null;
  text: string;
  matchedKeyword: string | null;
  dmStatus: DmStatus;
  dmMessageId: string | null;
  error: string | null;
  /** ISO-8601 */
  receivedAt: string;
}

export type CommentPatch = Partial<
  Pick<CommentRecord, 'dmStatus' | 'matchedKeyword' | 'dmMessageId' | 'error'>
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

export interface ProcessSummary {
  received: number;
  matched: number;
  sent: number;
  dryRun: number;
  notMatched: number;
  failed: number;
  duplicates: number;
  skippedOwn: number;
  skippedOtherAccount: number;
}
