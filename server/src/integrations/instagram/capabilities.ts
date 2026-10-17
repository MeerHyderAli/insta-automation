export type CapabilityStatus = 'VERIFIED' | 'CONDITIONAL' | 'UNVERIFIED' | 'UNSUPPORTED';

export interface Capability {
  status: CapabilityStatus;
  summary: string;
  docs: string;
}

export interface FollowVerificationCapability {
  available: boolean;
  status: CapabilityStatus;
  summary: string;
  docs: string;
  alternative: string;
}

/**
 * Capabilities are based only on official Meta documentation
 * (see docs/META_API_FEASIBILITY.md for URLs and evidence).
 */
export const CAPABILITIES = {
  'instagram.login.oauth': {
    status: 'VERIFIED',
    summary:
      'Instagram API with Instagram Login is supported for Business and Creator accounts. Standard Access is limited to app users; Advanced Access requires App Review.',
    docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login',
  },
  'comments.webhook': {
    status: 'CONDITIONAL',
    summary:
      'The comments webhook requires the app to be Live, Advanced Access for instagram_business_manage_comments, and a public professional account. Delivery is batched and retried; dedupe is mandatory.',
    docs: 'https://developers.facebook.com/docs/instagram-platform/webhooks',
  },
  'comments.public_reply': {
    status: 'VERIFIED',
    summary:
      'POST /<IG_COMMENT_ID>/replies creates a public reply and returns its id. Only top-level comments are supported; hidden comments and Live comments are not.',
    docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation',
  },
  'comments.private_reply': {
    status: 'VERIFIED',
    summary:
      'POST /<IG_USER_ID>/messages with recipient.comment_id sends one private reply per comment, within 7 days (Live: only during the broadcast). Text only in this app.',
    docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/private-replies',
  },
  'follow.verify_at_comment': {
    status: 'UNSUPPORTED',
    summary:
      'Meta does not expose follower status for an arbitrary commenter at comment time. Comments alone do not grant messaging consent for the User Profile API.',
    docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile',
  },
  'follow.check_after_dm': {
    status: 'CONDITIONAL',
    summary:
      'is_user_follow_business can be read only for an IGSID that messaged the account (user consent), not for arbitrary commenters.',
    docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile',
  },
  'resource.click_tracking': {
    status: 'VERIFIED',
    summary:
      'First-party tracked redirects measure clicks. A click is not evidence that someone followed the account.',
    docs: 'docs/META_API_FEASIBILITY.md',
  },
  'ai.suggestions': {
    status: 'UNVERIFIED',
    summary:
      'AI drafting is disabled by default. A provider interface, output validation and a per-workspace daily budget exist; the deterministic template provider is the only implementation and is not exposed in the UI yet.',
    docs: 'docs/IMPLEMENTATION_PLAN.md',
  },
} satisfies Record<string, Capability>;

export function getCapabilities(): typeof CAPABILITIES {
  return CAPABILITIES;
}

export function getFollowVerificationCapability(): FollowVerificationCapability {
  return {
    available: false,
    status: 'UNSUPPORTED',
    summary:
      'Instagram does not provide a way to check whether an arbitrary commenter follows the account. The app will not simulate this.',
    docs: CAPABILITIES['follow.verify_at_comment'].docs,
    alternative:
      'Use follower instruction mode: ask commenters to follow in the reply, then deliver the resource through public/private replies. Clicks are measured, but never treated as proof of following.',
  };
}
