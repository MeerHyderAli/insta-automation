import path from 'node:path';

/**
 * Example default keywords. Override with COMMENT_KEYWORDS in your env —
 * your keyword first, then the typo variants you want to accept.
 */
export const DEFAULT_KEYWORDS = ['link', 'links', 'lnik', 'likn', 'lnk', 'liink', 'linkk'];

export interface AppConfig {
  accessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  graphVersion: string;
  igAccountId: string | null;
  keywords: string[];
  dmMessage: string | null;
  requireFollow: boolean;
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
    dmMessage: clean(env.DM_MESSAGE),
    // Follower-only is the product rule requested for this app. It can be
    // disabled explicitly for local pipeline testing, but missing config must
    // never silently allow replies to non-followers.
    requireFollow: parseBoolean(env.REQUIRE_FOLLOW_TO_SEND, true),
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
    dmMessageConfigured: Boolean(config.dmMessage),
    igAccountIdConfigured: Boolean(config.igAccountId),
    graphVersion: config.graphVersion,
    keywords: config.keywords,
    requireFollow: config.requireFollow,
    dryRun: config.dryRun,
    storage: config.databaseUrl ? 'postgres' : 'file',
    storageDurable: Boolean(config.databaseUrl),
  } as const;
}
