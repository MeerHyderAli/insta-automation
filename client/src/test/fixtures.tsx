import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';
import { WorkspaceContext, type WorkspaceContextValue } from '../context/WorkspaceContext';
import type { Api, Counts } from '../lib/api';
import type {
  Account,
  Analytics,
  ConfigResponse,
  MeResponse,
  Resource,
  Rule,
  RuleInput,
  Run,
  Workspace,
} from '../lib/types';

export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
const ISO = '2026-10-01T10:00:00.000Z';

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WORKSPACE_ID,
    name: 'Acme Studio',
    slug: 'acme-studio',
    planId: 'creator',
    planName: 'Creator',
    planLimits: {
      accounts: 2,
      rules: 20,
      resources: 50,
      members: 3,
      private_replies_month: 2000,
      comments_month: 5000,
    },
    timezone: 'UTC',
    role: 'owner',
    createdAt: ISO,
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: WORKSPACE_ID,
    igUserId: '17841400000000001',
    username: 'acme.studio',
    accountType: 'BUSINESS',
    scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
    tokenExpiresAt: '2026-12-01T10:00:00.000Z',
    tokenExpiresInDays: 45,
    status: 'connected',
    lastErrorCode: null,
    lastErrorAt: null,
    webhookSubscribed: true,
    webhookSubscribedAt: ISO,
    permissionsOk: true,
    missingPermissions: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    workspaceId: WORKSPACE_ID,
    accountId: makeAccount().id,
    name: 'Guide requests',
    enabled: true,
    mediaId: null,
    keywords: ['API', 'GUIDE'],
    publicReplyTemplate: 'Sent you a DM, {{username}}!',
    privateReplyTemplate: 'Here is the guide: {{resource_url}}',
    resourceId: null,
    followGate: 'off',
    priority: 100,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: WORKSPACE_ID,
    title: 'Prompt guide',
    description: null,
    url: 'https://example.com/guide',
    slug: 'guide',
    trackedUrl: 'http://localhost:3001/r/guide',
    clickCount: 3,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    workspaceId: WORKSPACE_ID,
    accountId: makeAccount().id,
    ruleId: makeRule().id,
    ruleName: 'Guide requests',
    commentId: 'comment-1',
    mediaId: 'media-1',
    commenterUsername: 'reader',
    commentText: 'API please',
    matchedKeyword: 'API',
    status: 'completed',
    skipReason: null,
    publicReplyStatus: 'sent',
    publicReplyId: 'reply-1',
    publicReplyError: null,
    privateReplyStatus: 'sent',
    privateReplyMessageId: 'message-1',
    privateReplyError: null,
    attempts: 1,
    lastAttemptAt: ISO,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeAnalytics(overrides: Partial<Analytics> = {}): Analytics {
  return {
    rangeDays: 30,
    commentsReceived: 0,
    eventsProcessed: 0,
    keywordMatches: 0,
    publicRepliesAttempted: 0,
    publicRepliesSent: 0,
    privateRepliesAttempted: 0,
    privateRepliesSent: 0,
    failures: 0,
    duplicatesIgnored: 0,
    skipped: 0,
    resourceClicks: 0,
    daily: [],
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    environment: 'test',
    demoMode: false,
    supabaseUrl: null,
    supabaseAnonKey: null,
    apiPublicUrl: 'http://localhost:3001',
    metaConfigured: true,
    graphVersion: 'v26.0',
    webhookFields: ['comments'],
    capabilities: {},
    followVerification: {
      available: false,
      status: 'UNSUPPORTED',
      summary:
        'Instagram does not expose follower status for arbitrary commenters, so this app cannot verify follows.',
      docs: 'https://developers.facebook.com/docs/instagram-platform/webhooks',
      alternative: 'Send the resource and include follow instructions in the private reply.',
    },
    ...overrides,
  };
}

export function makeMe(workspace: Workspace = makeWorkspace()): MeResponse {
  return {
    user: { id: USER_ID, email: 'owner@example.test' },
    profile: {
      id: USER_ID,
      email: 'owner@example.test',
      fullName: 'Owner',
      avatarUrl: null,
    },
    workspaces: [workspace],
  };
}

export type ApiMocks = {
  [K in keyof Api]?: ReturnType<typeof vi.fn>;
};

/**
 * A predictable fake of the HTTP API. Tests override only the calls they care
 * about; everything else resolves with realistic, clearly-synthetic data.
 */
export function createApiMock(overrides: Partial<Api> = {}): { api: Api; mocks: ApiMocks } {
  const workspace = makeWorkspace();
  const account = makeAccount();
  const rule = makeRule();
  const resource = makeResource();
  const mocks: ApiMocks = {
    getConfig: vi.fn(async () => makeConfig()),
    getMe: vi.fn(async () => makeMe(workspace)),
    listWorkspaces: vi.fn(async () => ({ workspaces: [workspace] })),
    getWorkspace: vi.fn(async () => ({
      workspace,
      counts: { accounts: 1, rules: 1, resources: 1, members: 1 },
    })),
    listAccounts: vi.fn(async () => ({ accounts: [account] })),
    listRules: vi.fn(async () => ({ rules: [rule] })),
    getRule: vi.fn(async () => ({ rule })),
    createRule: vi.fn(async (_workspaceId: string, input: RuleInput) => ({
      rule: { ...rule, ...input, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      warnings: [],
    })),
    updateRule: vi.fn(async () => ({ rule, warnings: [] })),
    deleteRule: vi.fn(async () => undefined),
    testRule: vi.fn(async () => ({
      matched: true,
      matchedKeyword: 'API',
      publicReply: { text: 'Sent!', length: 5, limit: 2000, errors: [] },
      privateReply: null,
      notes: [],
    })),
    listResources: vi.fn(async () => ({ resources: [resource] })),
    createResource: vi.fn(async () => ({ resource })),
    updateResource: vi.fn(async () => ({ resource })),
    deleteResource: vi.fn(async () => undefined),
    listMedia: vi.fn(async () => ({ media: [] })),
    syncMedia: vi.fn(async () => ({ media: [] })),
    listRuns: vi.fn(async () => ({
      runs: [] as Run[],
      pagination: { total: 0, limit: 6, offset: 0, hasMore: false },
    })),
    getRun: vi.fn(async () => ({
      run: makeRun(),
      events: [],
      webhookEvent: null,
    })),
    getAnalytics: vi.fn(async () => ({ analytics: makeAnalytics() })),
    getUsage: vi.fn(async () => ({
      plan: { id: 'creator', name: 'Creator', description: null, limits: {} },
      periodStart: ISO,
      metrics: {},
      counts: { accounts: 1, rules: 1, resources: 1, members: 1 },
      metaLimits: {
        privateRepliesPerHour: 700,
        privateReplyWindowDays: 7,
        publicReplyMaxLength: 2000,
        privateReplyMaxLength: 900,
      },
      notes: [],
    })),
    startInstagramOAuth: vi.fn(async () => ({
      authorizeUrl: 'https://www.instagram.com/oauth/authorize?client_id=test',
    })),
    subscribeWebhook: vi.fn(async () => ({ account })),
    refreshToken: vi.fn(async () => ({ account })),
    disconnectAccount: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    listMembers: vi.fn(async () => ({ members: [] })),
    addMember: vi.fn(async () => ({
      member: {
        userId: USER_ID,
        email: 'owner@example.test',
        fullName: 'Owner',
        role: 'member',
        joinedAt: ISO,
      },
    })),
    updateMemberRole: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => ({
      profile: {
        id: USER_ID,
        email: 'owner@example.test',
        fullName: 'Owner',
        avatarUrl: null,
      },
    })),
    createWorkspace: vi.fn(async () => ({ workspace })),
    updateWorkspace: vi.fn(async () => ({ workspace })),
    deleteWorkspace: vi.fn(async () => undefined),
  };

  return {
    api: { ...mocks, ...overrides } as unknown as Api,
    mocks,
  };
}

export interface RenderOptions {
  api?: Api;
  demoMode?: boolean;
  config?: ConfigResponse | null;
  workspace?: Workspace;
  counts?: Counts;
  route?: string;
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const api = options.api ?? createApiMock().api;
  const workspace = options.workspace ?? makeWorkspace();
  const reload = vi.fn();

  const auth: AuthContextValue = {
    user: { id: USER_ID, email: 'owner@example.test' },
    loading: false,
    demoMode: options.demoMode ?? false,
    config: options.config === undefined ? makeConfig() : options.config,
    api,
    signIn: vi.fn(async () => undefined),
    signUp: vi.fn(async () => ({ needsConfirmation: false })),
    signOut: vi.fn(async () => undefined),
  };

  const workspaceValue: WorkspaceContextValue = {
    workspace,
    counts: options.counts ?? { accounts: 1, rules: 1, resources: 1, members: 1 },
    me: makeMe(workspace),
    api,
    reload,
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[options.route ?? `/w/${workspace.id}`]}>
      <AuthContext.Provider value={auth}>
        <WorkspaceContext.Provider value={workspaceValue}>{children}</WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );

  return { ...render(ui, { wrapper }), api, reload };
}
