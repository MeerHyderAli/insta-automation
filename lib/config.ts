import path from 'node:path';

/**
 * Example default keywords. Override with COMMENT_KEYWORDS in your env —
 * your keyword first, then the typo variants you want to accept.
 */
export const DEFAULT_KEYWORDS = ['link', 'links', 'lnik', 'likn', 'lnk', 'liink', 'linkk'];

export const DEFAULT_INTRO_DM_MESSAGE =
  'Thanks for commenting, {username}! Tap the button below to get your link.';
export const DEFAULT_NOT_FOLLOWING_MESSAGE =
  'You are not following this account yet. Please follow first, then tap “Try again” below to get your link.';
export const DEFAULT_FOLLOW_UNVERIFIED_MESSAGE =
  'I could not verify your follow status yet. Please make sure you follow this account, then tap “Try again” below.';
export const DEFAULT_GET_LINK_BUTTON_TEXT = 'Click to get link';
export const DEFAULT_TRY_AGAIN_BUTTON_TEXT = 'Try again';

export interface AppConfig {
  accessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  graphVersion: string;
  igAccountId: string | null;
  keywords: string[];
  introMessage: string;
  dmMessage: string | null;
  notFollowingMessage: string;
  followUnverifiedMessage: string;
  getLinkButtonText: string;
  tryAgainButtonText: string;
  requireFollowBeforePrompt: boolean;
  requireFollowForLink: boolean;
  dryRun: boolean;
  databaseUrl: string | null;
  dataFile: string;
}

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const value = clean(raw)?.toLowerCase();
  if (!value) return fallback;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function parseBooleanFrom(env: Env, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    if (clean(env[key])) return parseBoolean(env[key], fallback);
  }
  return fallback;
}

function cleanOrDefault(raw: string | undefined, fallback: string): string {
  return clean(raw) ?? fallback;
}

function buttonText(raw: string | undefined, fallback: string): string {
  // Instagram truncates quick-reply titles after 20 characters.
  return cleanOrDefault(raw, fallback).slice(0, 20);
}

export function normalizeGraphVersion(raw: string | null | undefined): string {
  const value = clean(raw ?? undefined) ?? 'v25.0';
  return value.startsWith('v') ? value : `v${value}`;
}

export function parseKeywords(raw: string | undefined): string[] {
  if (!raw?.trim()) return [...DEFAULT_KEYWORDS];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(',')) {
    const keyword = part.trim().toLowerCase();
    if (keyword && !seen.has(keyword)) {
      seen.add(keyword);
      keywords.push(keyword);
    }
  }
  return keywords.length > 0 ? keywords : [...DEFAULT_KEYWORDS];
}

export function getConfig(env: Env = process.env): AppConfig {
  const dataFile =
    clean(env.DATA_FILE) ??
    (env.VERCEL
      ? '/tmp/insta-comment-dm.json'
      : path.join(process.cwd(), 'data', 'comments.json'));

  return {
    accessToken: clean(env.IG_ACCESS_TOKEN),
    appSecret: clean(env.META_APP_SECRET),
    verifyToken: clean(env.META_WEBHOOK_VERIFY_TOKEN),
    graphVersion: normalizeGraphVersion(env.META_GRAPH_VERSION),
    igAccountId: clean(env.IG_ACCOUNT_ID),
    keywords: parseKeywords(env.COMMENT_KEYWORDS),
    introMessage: cleanOrDefault(env.INTRO_DM_MESSAGE, DEFAULT_INTRO_DM_MESSAGE),
    dmMessage: clean(env.DM_MESSAGE),
    notFollowingMessage: cleanOrDefault(
      env.NOT_FOLLOWING_MESSAGE,
      DEFAULT_NOT_FOLLOWING_MESSAGE,
    ),
    followUnverifiedMessage: cleanOrDefault(
      env.FOLLOW_UNVERIFIED_MESSAGE,
      DEFAULT_FOLLOW_UNVERIFIED_MESSAGE,
    ),
    getLinkButtonText: buttonText(env.GET_LINK_BUTTON_TEXT, DEFAULT_GET_LINK_BUTTON_TEXT),
    tryAgainButtonText: buttonText(env.TRY_AGAIN_BUTTON_TEXT, DEFAULT_TRY_AGAIN_BUTTON_TEXT),
    // The follow status is intentionally checked twice. The specific flags
    // win, while REQUIRE_FOLLOW_TO_SEND remains supported as the legacy
    // master switch for deployments created before the two-step flow.
    requireFollowBeforePrompt: parseBooleanFrom(
      env,
      ['REQUIRE_FOLLOW_BEFORE_PROMPT', 'REQUIRE_FOLLOW_TO_SEND'],
      true,
    ),
    requireFollowForLink: parseBooleanFrom(
      env,
      ['REQUIRE_FOLLOW_FOR_LINK', 'REQUIRE_FOLLOW_TO_SEND'],
      true,
    ),
    dryRun: parseBoolean(env.DRY_RUN, false),
    databaseUrl: clean(env.DATABASE_URL),
    dataFile,
  };
}

/** Non-secret config summary for the dashboard / health endpoint. */
export function getConfigStatus(config: AppConfig) {
  return {
    accessTokenConfigured: Boolean(config.accessToken),
    appSecretConfigured: Boolean(config.appSecret),
    verifyTokenConfigured: Boolean(config.verifyToken),
    introMessageConfigured: Boolean(config.introMessage),
    dmMessageConfigured: Boolean(config.dmMessage),
    igAccountIdConfigured: Boolean(config.igAccountId),
    graphVersion: config.graphVersion,
    keywords: config.keywords,
    getLinkButtonText: config.getLinkButtonText,
    tryAgainButtonText: config.tryAgainButtonText,
    requireFollowBeforePrompt: config.requireFollowBeforePrompt,
    requireFollowForLink: config.requireFollowForLink,
    // Deprecated health alias: true only when both checks are enabled.
    requireFollow: config.requireFollowBeforePrompt && config.requireFollowForLink,
    dryRun: config.dryRun,
    storage: config.databaseUrl ? 'postgres' : 'file',
    storageDurable: Boolean(config.databaseUrl),
  } as const;
}
