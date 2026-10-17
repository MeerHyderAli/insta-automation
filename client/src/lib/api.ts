import type {
  Account,
  Analytics,
  ConfigResponse,
  MediaItem,
  MeResponse,
  Member,
  Profile,
  Resource,
  ResourceInput,
  Rule,
  RuleInput,
  RuleTestResult,
  Run,
  RunDetail,
  UsageResponse,
  Workspace,
  WorkspaceRole,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; details?: unknown; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 'NETWORK_ERROR';
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export interface RunFilters {
  limit?: number;
  offset?: number;
  status?: string;
  accountId?: string;
  ruleId?: string;
}

export interface Counts {
  accounts: number;
  rules: number;
  resources: number;
  members: number;
}

export interface Api {
  getConfig(): Promise<ConfigResponse>;
  getMe(): Promise<MeResponse>;
  updateProfile(fullName: string | null): Promise<{ profile: Profile }>;
  listWorkspaces(): Promise<{ workspaces: Workspace[] }>;
  createWorkspace(name: string, timezone?: string): Promise<{ workspace: Workspace }>;
  getWorkspace(workspaceId: string): Promise<{ workspace: Workspace; counts: Counts }>;
  updateWorkspace(
    workspaceId: string,
    patch: { name?: string; timezone?: string },
  ): Promise<{ workspace: Workspace }>;
  deleteWorkspace(workspaceId: string, confirmName: string): Promise<void>;
  listMembers(workspaceId: string): Promise<{ members: Member[] }>;
  addMember(
    workspaceId: string,
    email: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<{ member: Member }>;
  updateMemberRole(
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
  listAccounts(workspaceId: string): Promise<{ accounts: Account[] }>;
  startInstagramOAuth(workspaceId: string): Promise<{ authorizeUrl: string }>;
  listMedia(workspaceId: string, accountId: string): Promise<{ media: MediaItem[] }>;
  syncMedia(workspaceId: string, accountId: string): Promise<{ media: MediaItem[] }>;
  subscribeWebhook(workspaceId: string, accountId: string): Promise<{ account: Account }>;
  refreshToken(workspaceId: string, accountId: string): Promise<{ account: Account }>;
  disconnectAccount(workspaceId: string, accountId: string): Promise<void>;
  deleteAccount(workspaceId: string, accountId: string, confirmUsername: string): Promise<void>;
  listRules(workspaceId: string): Promise<{ rules: Rule[] }>;
  getRule(workspaceId: string, ruleId: string): Promise<{ rule: Rule }>;
  createRule(workspaceId: string, input: RuleInput): Promise<{ rule: Rule; warnings: string[] }>;
  updateRule(
    workspaceId: string,
    ruleId: string,
    input: Partial<RuleInput>,
  ): Promise<{ rule: Rule; warnings: string[] }>;
  deleteRule(workspaceId: string, ruleId: string): Promise<void>;
  testRule(
    workspaceId: string,
    ruleId: string,
    input: { commentText: string; mediaId?: string | null },
  ): Promise<RuleTestResult>;
  listResources(workspaceId: string): Promise<{ resources: Resource[] }>;
  createResource(workspaceId: string, input: ResourceInput): Promise<{ resource: Resource }>;
  updateResource(
    workspaceId: string,
    resourceId: string,
    input: Partial<ResourceInput>,
  ): Promise<{ resource: Resource }>;
  deleteResource(workspaceId: string, resourceId: string): Promise<void>;
  listRuns(
    workspaceId: string,
    filters: RunFilters,
  ): Promise<{
    runs: Run[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }>;
  getRun(workspaceId: string, runId: string): Promise<RunDetail>;
  getAnalytics(workspaceId: string, days: number): Promise<{ analytics: Analytics }>;
  getUsage(workspaceId: string): Promise<UsageResponse>;
}

type TokenProvider = () => Promise<string | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
}

export function createHttpApi(getToken: TokenProvider): Api {
  const baseUrl =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.authenticated !== false) {
      const token = await getToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError('Could not reach the API. Check your connection and try again.', {
        code: 'NETWORK_ERROR',
      });
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const envelope = json as {
        error?: { code?: string; message?: string; details?: unknown };
        requestId?: string;
      } | null;
      throw new ApiError(envelope?.error?.message ?? `Request failed (${response.status}).`, {
        status: response.status,
        code: envelope?.error?.code ?? 'REQUEST_FAILED',
        details: envelope?.error?.details,
        requestId: envelope?.requestId,
      });
    }
    if (response.status === 204) return undefined as T;
    return json as T;
  }

  const ws = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;

  return {
    getConfig: () => request<ConfigResponse>('/api/config', { authenticated: false }),
    getMe: () => request<MeResponse>('/api/me'),
    updateProfile: (fullName) =>
      request<{ profile: Profile }>('/api/me', { method: 'PATCH', body: { fullName } }),

    listWorkspaces: () => request<{ workspaces: Workspace[] }>('/api/workspaces'),
    createWorkspace: (name, timezone) =>
      request<{ workspace: Workspace }>('/api/workspaces', {
        method: 'POST',
        body: { name, ...(timezone ? { timezone } : {}) },
      }),
    getWorkspace: (workspaceId) =>
      request<{ workspace: Workspace; counts: Counts }>(ws(workspaceId)),
    updateWorkspace: (workspaceId, patch) =>
      request<{ workspace: Workspace }>(ws(workspaceId), { method: 'PATCH', body: patch }),
    deleteWorkspace: (workspaceId, confirmName) =>
      request<void>(ws(workspaceId), { method: 'DELETE', body: { confirmName } }),

    listMembers: (workspaceId) => request<{ members: Member[] }>(`${ws(workspaceId)}/members`),
    addMember: (workspaceId, email, role) =>
      request<{ member: Member }>(`${ws(workspaceId)}/members`, {
        method: 'POST',
        body: { email, role },
      }),
    updateMemberRole: (workspaceId, userId, role) =>
      request<void>(`${ws(workspaceId)}/members/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { role },
      }),
    removeMember: (workspaceId, userId) =>
      request<void>(`${ws(workspaceId)}/members/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      }),

    listAccounts: (workspaceId) => request<{ accounts: Account[] }>(`${ws(workspaceId)}/accounts`),
    startInstagramOAuth: (workspaceId) =>
      request<{ authorizeUrl: string }>(`${ws(workspaceId)}/oauth/start`, { method: 'POST' }),
    listMedia: (workspaceId, accountId) =>
      request<{ media: MediaItem[] }>(
        `${ws(workspaceId)}/accounts/${encodeURIComponent(accountId)}/media`,
      ),
    syncMedia: (workspaceId, accountId) =>
      request<{ media: MediaItem[] }>(
        `${ws(workspaceId)}/accounts/${encodeURIComponent(accountId)}/media/sync`,
        { method: 'POST', body: {} },
      ),
    subscribeWebhook: (workspaceId, accountId) =>
      request<{ account: Account }>(
        `${ws(workspaceId)}/accounts/${encodeURIComponent(accountId)}/webhook-subscribe`,
        { method: 'POST', body: {} },
      ),
    refreshToken: (workspaceId, accountId) =>
      request<{ account: Account }>(
        `${ws(workspaceId)}/accounts/${encodeURIComponent(accountId)}/refresh-token`,
        { method: 'POST', body: {} },
      ),
    disconnectAccount: (workspaceId, accountId) =>
      request<void>(`${ws(workspaceId)}/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: 'POST',
        body: {},
      }),
    deleteAccount: (workspaceId, accountId, confirmUsername) =>
      request<void>(`${ws(workspaceId)}/accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
        body: { confirmUsername },
      }),

    listRules: (workspaceId) => request<{ rules: Rule[] }>(`${ws(workspaceId)}/rules`),
    getRule: (workspaceId, ruleId) =>
      request<{ rule: Rule }>(`${ws(workspaceId)}/rules/${encodeURIComponent(ruleId)}`),
    createRule: (workspaceId, input) =>
      request<{ rule: Rule; warnings: string[] }>(`${ws(workspaceId)}/rules`, {
        method: 'POST',
        body: input,
      }),
    updateRule: (workspaceId, ruleId, input) =>
      request<{ rule: Rule; warnings: string[] }>(
        `${ws(workspaceId)}/rules/${encodeURIComponent(ruleId)}`,
        { method: 'PATCH', body: input },
      ),
    deleteRule: (workspaceId, ruleId) =>
      request<void>(`${ws(workspaceId)}/rules/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
      }),
    testRule: (workspaceId, ruleId, input) =>
      request<RuleTestResult>(`${ws(workspaceId)}/rules/${encodeURIComponent(ruleId)}/test`, {
        method: 'POST',
        body: input,
      }),

    listResources: (workspaceId) =>
      request<{ resources: Resource[] }>(`${ws(workspaceId)}/resources`),
    createResource: (workspaceId, input) =>
      request<{ resource: Resource }>(`${ws(workspaceId)}/resources`, {
        method: 'POST',
        body: input,
      }),
    updateResource: (workspaceId, resourceId, input) =>
      request<{ resource: Resource }>(
        `${ws(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
        { method: 'PATCH', body: input },
      ),
    deleteResource: (workspaceId, resourceId) =>
      request<void>(`${ws(workspaceId)}/resources/${encodeURIComponent(resourceId)}`, {
        method: 'DELETE',
      }),

    listRuns: (workspaceId, filters) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const query = params.toString();
      return request<{
        runs: Run[];
        pagination: { total: number; limit: number; offset: number; hasMore: boolean };
      }>(`${ws(workspaceId)}/runs${query ? `?${query}` : ''}`);
    },
    getRun: (workspaceId, runId) =>
      request<RunDetail>(`${ws(workspaceId)}/runs/${encodeURIComponent(runId)}`),

    getAnalytics: (workspaceId, days) =>
      request<{ analytics: Analytics }>(`${ws(workspaceId)}/analytics?days=${days}`),
    getUsage: (workspaceId) => request<UsageResponse>(`${ws(workspaceId)}/usage`),
  };
}
