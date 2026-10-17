import { ApiError, type Api } from './api';
import type {
  Account,
  Analytics,
  ConfigResponse,
  MediaItem,
  MeResponse,
  Member,
  Resource,
  ResourceInput,
  Rule,
  RuleTestResult,
  Run,
  RunDetail,
  RunStatus,
  UsageResponse,
  Workspace,
} from './types';

/**
 * In-browser demo backend. It is deliberately fake and every screen labels it
 * as sample data. It never claims that a message was delivered by Instagram:
 * the seeded runs are marked "Sample" and the global banner explains this.
 */
const STORAGE_KEY = 'commentpilot.demo.v1';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_1 = '44444444-4444-4444-8444-444444444444';
const RESOURCE_2 = '55555555-5555-4555-8555-555555555555';
const RESOURCE_3 = '66666666-6666-4666-8666-666666666666';
const RULE_1 = '77777777-7777-4777-8777-777777777777';
const RULE_2 = '88888888-8888-4888-8888-888888888888';
const RULE_3 = '99999999-9999-4999-8999-999999999999';

const PLAN_LIMITS = {
  accounts: 2,
  rules: 20,
  resources: 50,
  members: 3,
  private_replies_month: 2000,
  comments_month: 5000,
};

const now = () => Date.now();
const iso = (msAgo: number) => new Date(now() - msAgo).toISOString();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function thumbnail(label: string, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/><text x="50%" y="50%" fill="white" font-family="system-ui" font-size="24" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface DemoState {
  version: 1;
  workspace: Workspace;
  profile: { id: string; email: string; fullName: string };
  members: Member[];
  accounts: Account[];
  media: MediaItem[];
  rules: Rule[];
  resources: Resource[];
  runs: Run[];
  counters: Record<string, number>;
}

function seed(): DemoState {
  const workspace: Workspace = {
    id: WORKSPACE_ID,
    name: 'Demo Studio',
    slug: 'demo-studio',
    planId: 'creator',
    planName: 'Creator',
    planLimits: PLAN_LIMITS,
    timezone: 'Asia/Kolkata',
    role: 'owner',
    createdAt: iso(64 * DAY_MS),
  };
  const account: Account = {
    id: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    igUserId: '17841400000000001',
    username: 'demo.creator',
    accountType: 'MEDIA_CREATOR',
    scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
    tokenExpiresAt: new Date(now() + 52 * DAY_MS).toISOString(),
    tokenExpiresInDays: 52,
    status: 'connected',
    lastErrorCode: null,
    lastErrorAt: null,
    webhookSubscribed: true,
    webhookSubscribedAt: iso(30 * DAY_MS),
    permissionsOk: true,
    missingPermissions: [],
    createdAt: iso(31 * DAY_MS),
    updatedAt: iso(2 * DAY_MS),
  };
  const media: MediaItem[] = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      mediaId: '17900000000000001',
      mediaType: 'VIDEO',
      mediaProductType: 'REELS',
      caption: '5 AI tools that save me hours every week — comment TOOLS and I will send the list.',
      permalink: 'https://www.instagram.com/reel/demo-tools/',
      thumbnailUrl: thumbnail('AI TOOLS', '#f97316', '#db2777'),
      publishedAt: iso(9 * DAY_MS),
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      mediaId: '17900000000000002',
      mediaType: 'IMAGE',
      mediaProductType: 'FEED',
      caption: 'The prompt framework I use for every carousel. Comment PROMPT for the template.',
      permalink: 'https://www.instagram.com/p/demo-prompt/',
      thumbnailUrl: thumbnail('PROMPTS', '#6366f1', '#0ea5e9'),
      publishedAt: iso(18 * DAY_MS),
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      mediaId: '17900000000000003',
      mediaType: 'CAROUSEL_ALBUM',
      mediaProductType: 'FEED',
      caption: 'Build your first API integration this weekend. Comment API for the starter guide.',
      permalink: 'https://www.instagram.com/p/demo-api/',
      thumbnailUrl: thumbnail('APIs', '#10b981', '#134e4a'),
      publishedAt: iso(26 * DAY_MS),
    },
  ];
  const resources: Resource[] = [
    {
      id: RESOURCE_1,
      workspaceId: WORKSPACE_ID,
      title: 'Free AI Tools Guide',
      description: 'A curated list of ten tools with pricing and setup notes.',
      url: 'https://example.com/ai-tools-guide',
      slug: 'demo-guide',
      trackedUrl: 'https://example.com/r/demo-guide',
      clickCount: 37,
      createdAt: iso(28 * DAY_MS),
      updatedAt: iso(3 * DAY_MS),
    },
    {
      id: RESOURCE_2,
      workspaceId: WORKSPACE_ID,
      title: 'API Starter Checklist',
      description: 'Endpoint checklist, auth notes and a Postman collection.',
      url: 'https://example.com/api-starter',
      slug: 'demo-api',
      trackedUrl: 'https://example.com/r/demo-api',
      clickCount: 21,
      createdAt: iso(20 * DAY_MS),
      updatedAt: iso(20 * DAY_MS),
    },
    {
      id: RESOURCE_3,
      workspaceId: WORKSPACE_ID,
      title: 'Prompt Framework',
      description: 'The 5-part prompt template used in the carousel.',
      url: 'https://example.com/prompt-framework',
      slug: 'demo-prompt',
      trackedUrl: 'https://example.com/r/demo-prompt',
      clickCount: 12,
      createdAt: iso(15 * DAY_MS),
      updatedAt: iso(15 * DAY_MS),
    },
  ];
  const rules: Rule[] = [
    {
      id: RULE_1,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_ID,
      name: 'GUIDE keyword — free guide',
      enabled: true,
      mediaId: null,
      keywords: ['GUIDE', 'FREE'],
      publicReplyTemplate:
        'Sent you a DM, @{{username}}! Follow @{{account_username}} so you do not miss the next one.',
      privateReplyTemplate:
        'Hey @{{username}} — here is the free AI tools guide you asked for: {{resource_url}}\n\nEnjoy!',
      resourceId: RESOURCE_1,
      followGate: 'instruction',
      priority: 10,
      createdAt: iso(27 * DAY_MS),
      updatedAt: iso(2 * DAY_MS),
    },
    {
      id: RULE_2,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_ID,
      name: 'API / TOOLS keyword',
      enabled: true,
      mediaId: null,
      keywords: ['API', 'TOOLS'],
      publicReplyTemplate: null,
      privateReplyTemplate:
        'Here is the API starter checklist, @{{username}}: {{resource_url}}\n\nReply here if you get stuck.',
      resourceId: RESOURCE_2,
      followGate: 'off',
      priority: 20,
      createdAt: iso(19 * DAY_MS),
      updatedAt: iso(19 * DAY_MS),
    },
    {
      id: RULE_3,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_ID,
      name: 'PROMPT keyword (paused)',
      enabled: false,
      mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      keywords: ['PROMPT'],
      publicReplyTemplate: 'DMing you the prompt framework, @{{username}} 📩',
      privateReplyTemplate: 'The prompt framework is here: {{resource_url}}',
      resourceId: RESOURCE_3,
      followGate: 'off',
      priority: 30,
      createdAt: iso(14 * DAY_MS),
      updatedAt: iso(4 * DAY_MS),
    },
  ];

  const comments: Array<{
    username: string;
    text: string;
    keyword: string | null;
    ruleId: string | null;
    ago: number;
    status: RunStatus;
    publicStatus: Run['publicReplyStatus'];
    privateStatus: Run['privateReplyStatus'];
    publicError?: string;
    privateError?: string;
  }> = [
    {
      username: 'ananya.builds',
      text: 'GUIDE please! This is exactly what I needed',
      keyword: 'GUIDE',
      ruleId: RULE_1,
      ago: 2 * HOUR_MS,
      status: 'completed',
      publicStatus: 'sent',
      privateStatus: 'sent',
    },
    {
      username: 'rahul_dev',
      text: 'API — does the checklist include webhooks?',
      keyword: 'API',
      ruleId: RULE_2,
      ago: 3 * HOUR_MS,
      status: 'completed',
      publicStatus: 'skipped',
      privateStatus: 'sent',
    },
    {
      username: 'mia.creates',
      text: 'FREE guide 🤍',
      keyword: 'FREE',
      ruleId: RULE_1,
      ago: 5 * HOUR_MS,
      status: 'partial',
      publicStatus: 'sent',
      privateStatus: 'failed',
      privateError: 'Private replies are limited to one per comment.',
    },
    {
      username: 'arjun.ai',
      text: 'TOOLS',
      keyword: 'TOOLS',
      ruleId: RULE_2,
      ago: 8 * HOUR_MS,
      status: 'completed',
      publicStatus: 'skipped',
      privateStatus: 'sent',
    },
    {
      username: 'sara.design',
      text: 'GUIDE',
      keyword: 'GUIDE',
      ruleId: RULE_1,
      ago: 20 * HOUR_MS,
      status: 'completed',
      publicStatus: 'sent',
      privateStatus: 'sent',
    },
    {
      username: 'capital_letters',
      text: 'I read a CAPITAL markets report',
      keyword: null,
      ruleId: null,
      ago: 26 * HOUR_MS,
      status: 'skipped',
      publicStatus: 'skipped',
      privateStatus: 'skipped',
    },
    {
      username: 'dev.sam',
      text: 'API',
      keyword: 'API',
      ruleId: RULE_2,
      ago: 2 * DAY_MS,
      status: 'completed',
      publicStatus: 'skipped',
      privateStatus: 'sent',
    },
    {
      username: 'neha.codes',
      text: 'Free guide please',
      keyword: 'FREE',
      ruleId: RULE_1,
      ago: 2 * DAY_MS + 4 * HOUR_MS,
      status: 'completed',
      publicStatus: 'sent',
      privateStatus: 'sent',
    },
    {
      username: 'theo.pm',
      text: 'TOOLS are good but the pricing changed',
      keyword: 'TOOLS',
      ruleId: RULE_2,
      ago: 3 * DAY_MS,
      status: 'processing',
      publicStatus: 'pending',
      privateStatus: 'pending',
    },
    {
      username: 'isha.makes',
      text: 'GUIDE',
      keyword: 'GUIDE',
      ruleId: RULE_1,
      ago: 4 * DAY_MS,
      status: 'failed',
      publicStatus: 'failed',
      privateStatus: 'failed',
      publicError: 'Instagram rate limit reached. This will be retried automatically.',
      privateError: 'The Instagram connection needs to be reconnected.',
    },
    {
      username: 'noah.builds',
      text: 'This is so helpful, thanks!',
      keyword: null,
      ruleId: null,
      ago: 5 * DAY_MS,
      status: 'skipped',
      publicStatus: 'skipped',
      privateStatus: 'skipped',
    },
    {
      username: 'priya.designs',
      text: 'API please',
      keyword: 'API',
      ruleId: RULE_2,
      ago: 6 * DAY_MS,
      status: 'completed',
      publicStatus: 'skipped',
      privateStatus: 'sent',
    },
    {
      username: 'leo.growth',
      text: 'FREE',
      keyword: 'FREE',
      ruleId: RULE_1,
      ago: 7 * DAY_MS,
      status: 'partial',
      publicStatus: 'sent',
      privateStatus: 'unknown',
      privateError: 'Instagram did not confirm delivery before the request timed out.',
    },
    {
      username: 'aisha.ux',
      text: 'GUIDE me please',
      keyword: 'GUIDE',
      ruleId: RULE_1,
      ago: 8 * DAY_MS,
      status: 'completed',
      publicStatus: 'sent',
      privateStatus: 'sent',
    },
    {
      username: 'tom.codes',
      text: 'PROMPT',
      keyword: null,
      ruleId: null,
      ago: 9 * DAY_MS,
      status: 'skipped',
      publicStatus: 'skipped',
      privateStatus: 'skipped',
    },
    {
      username: 'zoya.creates',
      text: 'TOOLS',
      keyword: 'TOOLS',
      ruleId: RULE_2,
      ago: 10 * DAY_MS,
      status: 'completed',
      publicStatus: 'skipped',
      privateStatus: 'sent',
    },
    {
      username: 'kabir.dev',
      text: 'Api integration help',
      keyword: 'API',
      ruleId: RULE_2,
      ago: 11 * DAY_MS,
      status: 'completed',
      publicStatus: 'skipped',
      privateStatus: 'sent',
    },
    {
      username: 'emma.studio',
      text: 'GUIDE',
      keyword: 'GUIDE',
      ruleId: RULE_1,
      ago: 12 * DAY_MS,
      status: 'completed',
      publicStatus: 'sent',
      privateStatus: 'sent',
    },
  ];

  const runs: Run[] = comments.map((entry, index) => {
    const rule = rules.find((item) => item.id === entry.ruleId) ?? null;
    const createdAt = iso(entry.ago);
    return {
      id: `run-${String(index + 1).padStart(3, '0')}`,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_ID,
      ruleId: entry.ruleId,
      ruleName: rule?.name ?? 'No matching automation',
      commentId: `comment-${index + 1}`,
      mediaId:
        index % 3 === 0
          ? media[0]!.mediaId
          : index % 3 === 1
            ? media[2]!.mediaId
            : media[1]!.mediaId,
      commenterUsername: entry.username,
      commentText: entry.text,
      matchedKeyword: entry.keyword,
      status: entry.status,
      skipReason: entry.status === 'skipped' ? 'no_keyword_match' : null,
      publicReplyStatus: entry.publicStatus,
      publicReplyId: entry.publicStatus === 'sent' ? `reply-${index + 1}` : null,
      publicReplyError: entry.publicError ?? null,
      privateReplyStatus: entry.privateStatus,
      privateReplyMessageId: entry.privateStatus === 'sent' ? `message-${index + 1}` : null,
      privateReplyError: entry.privateError ?? null,
      attempts: entry.status === 'failed' ? 3 : entry.status === 'processing' ? 1 : 0,
      lastAttemptAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const counters = {
    comments_received: 48,
    events_processed: 44,
    keyword_matches: 31,
    public_replies_attempted: 18,
    public_replies_sent: 16,
    private_replies_attempted: 24,
    private_replies_sent: 22,
    failures: 2,
    duplicates_ignored: 4,
    resource_clicks: 70,
    comments_processed: 31,
    private_replies_month: 22,
  };

  return {
    version: 1,
    workspace,
    profile: {
      id: USER_ID,
      email: 'demo@example.test',
      fullName: 'Demo Creator',
    },
    members: [
      {
        userId: USER_ID,
        role: 'owner',
        email: 'demo@example.test',
        fullName: 'Demo Creator',
        createdAt: iso(64 * DAY_MS),
      },
      {
        userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        role: 'admin',
        email: 'aarav@example.test',
        fullName: 'Aarav (sample)',
        createdAt: iso(22 * DAY_MS),
      },
    ],
    accounts: [account],
    media,
    rules,
    resources,
    runs,
    counters,
  };
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.version === 1 && parsed.workspace?.id === WORKSPACE_ID) return parsed;
    }
  } catch {
    // Corrupt storage falls back to the seed.
  }
  const seeded = seed();
  save(seeded);
  return seeded;
}

function save(state: DemoState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode/quota: demo remains in memory for this page load.
  }
}

let state: DemoState | null = null;

function db(): DemoState {
  state ??= load();
  return state;
}

function persist(): void {
  if (state) save(state);
}

function replaceTemplate(template: string, context: Record<string, string>): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
      key in context ? context[key]! : match,
    )
    .trim();
}

function matchKeyword(text: string, keywords: string[]): string | null {
  const normalized = text.normalize('NFKC').toLowerCase();
  for (const keyword of keywords) {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
    if (pattern.test(normalized)) return keyword;
  }
  return null;
}

function requireWorkspace(workspaceId: string): void {
  if (workspaceId !== WORKSPACE_ID)
    throw new ApiError('Workspace not found.', { status: 404, code: 'NOT_FOUND' });
}

function recalcUsage(stateValue: DemoState): Record<string, number> {
  const counters = { ...stateValue.counters };
  counters.comments_processed = stateValue.runs.filter((run) => run.ruleId).length;
  counters.keyword_matches = stateValue.runs.filter((run) => run.matchedKeyword).length;
  counters.public_replies_sent = stateValue.runs.filter(
    (run) => run.publicReplyStatus === 'sent',
  ).length;
  counters.private_replies_sent = stateValue.runs.filter(
    (run) => run.privateReplyStatus === 'sent',
  ).length;
  counters.private_replies_month = counters.private_replies_sent;
  counters.failures = stateValue.runs.filter(
    (run) =>
      run.status === 'failed' ||
      run.publicReplyStatus === 'failed' ||
      run.privateReplyStatus === 'failed',
  ).length;
  return counters;
}

function demoConfig(): ConfigResponse {
  return {
    environment: 'demo',
    demoMode: true,
    supabaseUrl: null,
    supabaseAnonKey: null,
    apiPublicUrl: 'https://example.com',
    metaConfigured: false,
    graphVersion: 'v25.0',
    webhookFields: ['comments'],
    capabilities: {
      'instagram.login.oauth': {
        status: 'VERIFIED',
        summary: 'Instagram API with Instagram Login for Business and Creator accounts.',
        docs: 'docs/META_API_FEASIBILITY.md',
      },
      'comments.webhook': {
        status: 'CONDITIONAL',
        summary: 'Requires a Live app, Advanced Access and a public professional account.',
        docs: 'docs/META_API_FEASIBILITY.md',
      },
      'comments.public_reply': {
        status: 'VERIFIED',
        summary: 'Public replies to top-level comments are supported.',
        docs: 'docs/META_API_FEASIBILITY.md',
      },
      'comments.private_reply': {
        status: 'VERIFIED',
        summary: 'One private reply per comment, within 7 days.',
        docs: 'docs/META_API_FEASIBILITY.md',
      },
      'follow.verify_at_comment': {
        status: 'UNSUPPORTED',
        summary: 'Meta does not expose follower status for arbitrary commenters.',
        docs: 'docs/META_API_FEASIBILITY.md',
      },
      'resource.click_tracking': {
        status: 'VERIFIED',
        summary: 'First-party tracked links measure clicks, not follows.',
        docs: 'docs/META_API_FEASIBILITY.md',
      },
    },
    followVerification: {
      available: false,
      status: 'UNSUPPORTED',
      summary: 'Instagram does not expose follow status for arbitrary commenters.',
      docs: 'docs/META_API_FEASIBILITY.md',
      alternative:
        'Use instruction-only mode and measure resource clicks. Clicks are never treated as proof of following.',
    },
  };
}

function analyticsFor(days: number): Analytics {
  const since = now() - days * DAY_MS;
  const runs = db().runs.filter((run) => new Date(run.createdAt).getTime() >= since);
  const dailyMap = new Map<string, { comments: number; publicSent: number; privateSent: number }>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now() - index * DAY_MS).toISOString().slice(0, 10);
    dailyMap.set(date, { comments: 0, publicSent: 0, privateSent: 0 });
  }
  for (const run of runs) {
    const date = run.createdAt.slice(0, 10);
    const point = dailyMap.get(date);
    if (!point) continue;
    point.comments += 1;
    if (run.publicReplyStatus === 'sent') point.publicSent += 1;
    if (run.privateReplyStatus === 'sent') point.privateSent += 1;
  }
  // Add some non-matching comments so the chart is not identical to run volume.
  dailyMap.forEach((point, date) => {
    if (point.comments > 0) point.comments += (date.charCodeAt(9) % 3) + 1;
  });
  const daily = [...dailyMap.entries()].map(([date, point]) => ({
    date,
    commentsReceived: point.comments,
    publicRepliesSent: point.publicSent,
    privateRepliesSent: point.privateSent,
  }));
  return {
    rangeDays: days,
    commentsReceived: daily.reduce((sum, point) => sum + point.commentsReceived, 0),
    eventsProcessed: runs.filter((run) => run.ruleId).length,
    keywordMatches: runs.filter((run) => run.matchedKeyword).length,
    publicRepliesAttempted: runs.filter((run) =>
      ['sent', 'failed', 'unknown', 'sending', 'pending'].includes(run.publicReplyStatus),
    ).length,
    publicRepliesSent: runs.filter((run) => run.publicReplyStatus === 'sent').length,
    privateRepliesAttempted: runs.filter((run) =>
      ['sent', 'failed', 'unknown', 'sending', 'pending'].includes(run.privateReplyStatus),
    ).length,
    privateRepliesSent: runs.filter((run) => run.privateReplyStatus === 'sent').length,
    failures: runs.filter(
      (run) =>
        run.status === 'failed' ||
        run.publicReplyStatus === 'failed' ||
        run.privateReplyStatus === 'failed',
    ).length,
    duplicatesIgnored: db().counters.duplicates_ignored ?? 0,
    skipped: runs.filter((run) => run.status === 'skipped').length,
    resourceClicks: db().resources.reduce((sum, resource) => sum + resource.clickCount, 0),
    daily,
  };
}

function runEvents(run: Run) {
  const events: RunDetail['events'] = [
    {
      id: `${run.id}-event-1`,
      level: 'info',
      code: 'MATCHED',
      message: run.matchedKeyword
        ? `Matched keyword “${run.matchedKeyword}”.`
        : 'No keyword matched; no replies were attempted.',
      createdAt: run.createdAt,
    },
  ];
  if (run.publicReplyStatus === 'sent') {
    events.push({
      id: `${run.id}-event-2`,
      level: 'info',
      code: 'PUBLIC_REPLY_SENT',
      message: 'Sample: public reply recorded as confirmed.',
      createdAt: run.createdAt,
    });
  }
  if (run.privateReplyStatus === 'sent') {
    events.push({
      id: `${run.id}-event-3`,
      level: 'info',
      code: 'PRIVATE_REPLY_SENT',
      message: 'Sample: private reply recorded as confirmed.',
      createdAt: run.createdAt,
    });
  }
  if (run.publicReplyError) {
    events.push({
      id: `${run.id}-event-4`,
      level: 'error',
      code: 'PUBLIC_REPLY_ERROR',
      message: run.publicReplyError,
      createdAt: run.updatedAt,
    });
  }
  if (run.privateReplyError) {
    events.push({
      id: `${run.id}-event-5`,
      level: 'error',
      code: 'PRIVATE_REPLY_ERROR',
      message: run.privateReplyError,
      createdAt: run.updatedAt,
    });
  }
  return events;
}

export function resetDemoData(): void {
  state = seed();
  persist();
}

export function createDemoApi(): Api {
  return {
    getConfig: async () => demoConfig(),
    getMe: async (): Promise<MeResponse> => ({
      user: { id: db().profile.id, email: db().profile.email },
      profile: { ...db().profile, avatarUrl: null },
      workspaces: [db().workspace],
    }),
    updateProfile: async (fullName) => {
      db().profile.fullName = fullName ?? '';
      persist();
      return { profile: { ...db().profile, avatarUrl: null } };
    },
    listWorkspaces: async () => ({ workspaces: [db().workspace] }),
    createWorkspace: async () => {
      throw new ApiError(
        'Demo mode includes a single sample workspace. Run the app with Supabase to create real workspaces.',
        { status: 422, code: 'DEMO_LIMITATION' },
      );
    },
    getWorkspace: async (workspaceId) => {
      requireWorkspace(workspaceId);
      const value = db();
      return {
        workspace: value.workspace,
        counts: {
          accounts: value.accounts.filter((item) => item.status !== 'disconnected').length,
          rules: value.rules.length,
          resources: value.resources.length,
          members: value.members.length,
        },
      };
    },
    updateWorkspace: async (workspaceId, patch) => {
      requireWorkspace(workspaceId);
      Object.assign(db().workspace, patch);
      persist();
      return { workspace: db().workspace };
    },
    deleteWorkspace: async () => {
      throw new ApiError('The demo workspace cannot be deleted.', {
        status: 422,
        code: 'DEMO_LIMITATION',
      });
    },
    listMembers: async (workspaceId) => {
      requireWorkspace(workspaceId);
      return { members: db().members };
    },
    addMember: async (workspaceId, email, role) => {
      requireWorkspace(workspaceId);
      if (db().members.some((member) => member.email?.toLowerCase() === email.toLowerCase())) {
        throw new ApiError('That user is already a workspace member.', {
          status: 409,
          code: 'CONFLICT',
        });
      }
      if (db().members.length >= PLAN_LIMITS.members) {
        throw new ApiError('The Creator plan member limit has been reached.', {
          status: 429,
          code: 'QUOTA_EXCEEDED',
        });
      }
      const member: Member = {
        userId: crypto.randomUUID(),
        role,
        email,
        fullName: `${email.split('@')[0]} (sample)`,
        createdAt: new Date().toISOString(),
      };
      db().members.push(member);
      persist();
      return { member };
    },
    updateMemberRole: async (workspaceId, userId, role) => {
      requireWorkspace(workspaceId);
      const member = db().members.find((item) => item.userId === userId);
      if (!member) throw new ApiError('Member not found.', { status: 404, code: 'NOT_FOUND' });
      if (member.role === 'owner')
        throw new ApiError('The owner role cannot be changed.', { status: 403, code: 'FORBIDDEN' });
      member.role = role;
      persist();
    },
    removeMember: async (workspaceId, userId) => {
      requireWorkspace(workspaceId);
      const member = db().members.find((item) => item.userId === userId);
      if (!member) throw new ApiError('Member not found.', { status: 404, code: 'NOT_FOUND' });
      if (member.role === 'owner')
        throw new ApiError('The owner cannot be removed.', { status: 403, code: 'FORBIDDEN' });
      db().members = db().members.filter((item) => item.userId !== userId);
      persist();
    },

    listAccounts: async (workspaceId) => {
      requireWorkspace(workspaceId);
      return { accounts: db().accounts };
    },
    startInstagramOAuth: async () => {
      throw new ApiError(
        'Connecting Instagram needs a real Meta app, Supabase Auth and the API server. Demo mode does not simulate OAuth or fake a connection.',
        { status: 503, code: 'DEMO_MODE' },
      );
    },
    listMedia: async (workspaceId) => {
      requireWorkspace(workspaceId);
      return { media: db().media };
    },
    syncMedia: async (workspaceId) => {
      requireWorkspace(workspaceId);
      return { media: db().media };
    },
    subscribeWebhook: async (workspaceId, accountId) => {
      requireWorkspace(workspaceId);
      const account = db().accounts.find((item) => item.id === accountId);
      if (!account) throw new ApiError('Account not found.', { status: 404, code: 'NOT_FOUND' });
      account.webhookSubscribed = true;
      account.webhookSubscribedAt = new Date().toISOString();
      persist();
      return { account };
    },
    refreshToken: async (workspaceId, accountId) => {
      requireWorkspace(workspaceId);
      const account = db().accounts.find((item) => item.id === accountId);
      if (!account) throw new ApiError('Account not found.', { status: 404, code: 'NOT_FOUND' });
      account.tokenExpiresInDays = 60;
      account.tokenExpiresAt = new Date(now() + 60 * DAY_MS).toISOString();
      persist();
      return { account };
    },
    disconnectAccount: async (workspaceId, accountId) => {
      requireWorkspace(workspaceId);
      const account = db().accounts.find((item) => item.id === accountId);
      if (!account) throw new ApiError('Account not found.', { status: 404, code: 'NOT_FOUND' });
      account.status = 'disconnected';
      account.webhookSubscribed = false;
      for (const rule of db().rules) if (rule.accountId === accountId) rule.enabled = false;
      persist();
    },
    deleteAccount: async (workspaceId, accountId, confirmUsername) => {
      requireWorkspace(workspaceId);
      const account = db().accounts.find((item) => item.id === accountId);
      if (!account) throw new ApiError('Account not found.', { status: 404, code: 'NOT_FOUND' });
      if (account.username !== confirmUsername) {
        throw new ApiError('Type the exact username to confirm deletion.', {
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }
      db().accounts = db().accounts.filter((item) => item.id !== accountId);
      db().rules = db().rules.filter((rule) => rule.accountId !== accountId);
      persist();
    },

    listRules: async (workspaceId) => {
      requireWorkspace(workspaceId);
      return { rules: db().rules };
    },
    getRule: async (workspaceId, ruleId) => {
      requireWorkspace(workspaceId);
      const rule = db().rules.find((item) => item.id === ruleId);
      if (!rule) throw new ApiError('Automation not found.', { status: 404, code: 'NOT_FOUND' });
      return { rule };
    },
    createRule: async (workspaceId, input) => {
      requireWorkspace(workspaceId);
      if (db().rules.some((rule) => rule.name.toLowerCase() === input.name.toLowerCase())) {
        throw new ApiError('An automation with that name already exists.', {
          status: 409,
          code: 'CONFLICT',
        });
      }
      const rule: Rule = {
        id: crypto.randomUUID(),
        workspaceId,
        accountId: input.accountId,
        name: input.name,
        enabled: input.enabled ?? false,
        mediaId: input.mediaId,
        keywords: input.keywords,
        publicReplyTemplate: input.publicReplyTemplate,
        privateReplyTemplate: input.privateReplyTemplate,
        resourceId: input.resourceId,
        followGate: input.followGate ?? 'off',
        priority: input.priority ?? 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db().rules.push(rule);
      persist();
      return { rule, warnings: [] };
    },
    updateRule: async (workspaceId, ruleId, input) => {
      requireWorkspace(workspaceId);
      const rule = db().rules.find((item) => item.id === ruleId);
      if (!rule) throw new ApiError('Automation not found.', { status: 404, code: 'NOT_FOUND' });
      Object.assign(rule, input, { updatedAt: new Date().toISOString() });
      persist();
      return { rule, warnings: [] };
    },
    deleteRule: async (workspaceId, ruleId) => {
      requireWorkspace(workspaceId);
      db().rules = db().rules.filter((rule) => rule.id !== ruleId);
      persist();
    },
    testRule: async (workspaceId, ruleId, input): Promise<RuleTestResult> => {
      requireWorkspace(workspaceId);
      const rule = db().rules.find((item) => item.id === ruleId);
      if (!rule) throw new ApiError('Automation not found.', { status: 404, code: 'NOT_FOUND' });
      const account = db().accounts.find((item) => item.id === rule.accountId);
      const resource = db().resources.find((item) => item.id === rule.resourceId) ?? null;
      const keyword = matchKeyword(input.commentText, rule.keywords);
      const context = {
        username: 'sample_commenter',
        keyword: keyword ?? rule.keywords[0] ?? 'KEYWORD',
        resource_url: resource?.url ?? '',
        resource_title: resource?.title ?? '',
        account_username: account?.username ?? 'demo.creator',
        follow_instructions: `Follow @${account?.username ?? 'demo.creator'} so you do not miss the next drop.`,
      };
      const follow = rule.followGate === 'instruction' ? `\n\n${context.follow_instructions}` : '';
      const publicText = rule.publicReplyTemplate
        ? replaceTemplate(rule.publicReplyTemplate, context)
        : null;
      const privateText = rule.privateReplyTemplate
        ? `${replaceTemplate(rule.privateReplyTemplate, context)}${follow}`
        : null;
      return {
        matched: keyword !== null,
        matchedKeyword: keyword,
        publicReply: publicText
          ? { text: publicText, length: publicText.length, limit: 2000, errors: [] }
          : null,
        privateReply: privateText
          ? { text: privateText, length: privateText.length, limit: 900, errors: [] }
          : null,
        notes: [
          'Test mode performs no Instagram API calls and sends nothing.',
          'Private replies are allowed once per comment, within 7 days.',
          'A resource click never proves that a commenter followed the account.',
        ],
      };
    },

    listResources: async (workspaceId) => {
      requireWorkspace(workspaceId);
      return { resources: db().resources };
    },
    createResource: async (workspaceId, input: ResourceInput) => {
      requireWorkspace(workspaceId);
      const slug = `demo-${crypto.randomUUID().slice(0, 6)}`;
      const resource: Resource = {
        id: crypto.randomUUID(),
        workspaceId,
        title: input.title,
        description: input.description,
        url: input.url,
        slug,
        trackedUrl: `https://example.com/r/${slug}`,
        clickCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db().resources.push(resource);
      persist();
      return { resource };
    },
    updateResource: async (workspaceId, resourceId, input) => {
      requireWorkspace(workspaceId);
      const resource = db().resources.find((item) => item.id === resourceId);
      if (!resource) throw new ApiError('Resource not found.', { status: 404, code: 'NOT_FOUND' });
      Object.assign(resource, input, { updatedAt: new Date().toISOString() });
      persist();
      return { resource };
    },
    deleteResource: async (workspaceId, resourceId) => {
      requireWorkspace(workspaceId);
      db().resources = db().resources.filter((resource) => resource.id !== resourceId);
      for (const rule of db().rules) if (rule.resourceId === resourceId) rule.resourceId = null;
      persist();
    },

    listRuns: async (workspaceId, filters) => {
      requireWorkspace(workspaceId);
      let runs = [...db().runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (filters.status) runs = runs.filter((run) => run.status === filters.status);
      if (filters.accountId) runs = runs.filter((run) => run.accountId === filters.accountId);
      if (filters.ruleId) runs = runs.filter((run) => run.ruleId === filters.ruleId);
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      return {
        runs: runs.slice(offset, offset + limit),
        pagination: { total: runs.length, limit, offset, hasMore: offset + limit < runs.length },
      };
    },
    getRun: async (workspaceId, runId) => {
      requireWorkspace(workspaceId);
      const run = db().runs.find((item) => item.id === runId);
      if (!run) throw new ApiError('Activity entry not found.', { status: 404, code: 'NOT_FOUND' });
      return { run, events: runEvents(run) };
    },
    getAnalytics: async (workspaceId, days) => {
      requireWorkspace(workspaceId);
      return { analytics: analyticsFor(days) };
    },
    getUsage: async (workspaceId): Promise<UsageResponse> => {
      requireWorkspace(workspaceId);
      const value = db();
      const metrics = recalcUsage(value);
      return {
        plan: {
          id: value.workspace.planId,
          name: value.workspace.planName,
          description: 'For solo creators running a content funnel.',
          limits: PLAN_LIMITS,
        },
        periodStart: new Date(now()).toISOString().slice(0, 8) + '01',
        metrics,
        counts: {
          accounts: value.accounts.filter((account) => account.status !== 'disconnected').length,
          rules: value.rules.length,
          resources: value.resources.length,
          members: value.members.length,
        },
        metaLimits: {
          privateRepliesPerHour: 750,
          privateReplyWindowDays: 7,
          publicReplyMaxLength: 2200,
          privateReplyMaxLength: 1000,
        },
        notes: [
          'Demo usage counters are sample values, not billed API usage.',
          'Monthly private-reply quotas are enforced atomically before each send.',
          'Resource clicks do not prove that a person followed the account.',
        ],
      };
    },
  };
}
