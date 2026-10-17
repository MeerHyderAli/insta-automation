export interface InstagramProfile {
  igUserId: string;
  metaUserId: string | null;
  username: string;
  accountType: string | null;
}

export interface InstagramMedia {
  id: string;
  mediaType: string | null;
  mediaProductType: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: Date | null;
}

export interface InstagramTokenResult {
  accessToken: string;
  userId: string | null;
  permissions: string[];
  expiresIn: number;
}

export interface LongLivedTokenResult {
  accessToken: string;
  expiresIn: number;
}

/**
 * Narrow interface around the official Instagram Graph API. There is
 * deliberately no method for checking a commenter's follow status: Meta does
 * not expose it for arbitrary commenters.
 */
export interface InstagramProvider {
  readonly configured: boolean;
  buildAuthorizeUrl(input: { state: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<InstagramTokenResult>;
  exchangeLongLivedToken(shortToken: string): Promise<LongLivedTokenResult>;
  refreshToken(token: string): Promise<LongLivedTokenResult>;
  getProfile(token: string): Promise<InstagramProfile>;
  getMedia(token: string, igUserId: string): Promise<InstagramMedia[]>;
  subscribeWebhooks(token: string, fields: string[]): Promise<void>;
  replyToComment(token: string, commentId: string, message: string): Promise<{ id: string }>;
  sendPrivateReply(
    token: string,
    igUserId: string,
    commentId: string,
    message: string,
  ): Promise<{ messageId: string; recipientId: string | null }>;
}
