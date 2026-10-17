import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import type { AuthUser, AuthVerifier } from '../../src/auth/verifier.js';
import type { InstagramProvider } from '../../src/integrations/instagram/provider.js';
import type { LoggerLike } from '../../src/lib/logger.js';
import { errors } from '../../src/lib/errors.js';
import { MetaApiError } from '../../src/integrations/instagram/errors.js';
import { createTestDatabase, type TestDatabase } from './pglite.js';
import { cipher, TEST_KEY } from './factories.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    isProduction: false,
    port: 3001,
    logLevel: 'silent',
    clientOrigin: 'http://localhost:5173',
    clientOrigins: ['http://localhost:5173'],
    apiPublicUrl: 'http://api.test',
    demoMode: false,
    database: { url: 'postgres://unused:unused@localhost:5432/test', ssl: false },
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      serviceRoleKey: 'service-role-key',
      jwtSecret: null,
      configured: true,
    },
    meta: {
      appId: '1234567890',
      appSecret: 'test-app-secret',
      redirectUri: 'http://api.test/api/integrations/instagram/callback',
      webhookVerifyToken: 'test-verify-token',
      graphVersion: 'v25.0',
      scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
      webhookFields: ['comments'],
      configured: true,
    },
    security: {
      tokenEncryptionKey: TEST_KEY,
      tokenKeyVersion: 1,
      oauthStateTtlSeconds: 600,
    },
    worker: {
      enabled: false,
      concurrency: 1,
      pollIntervalMs: 1000,
      maxAttempts: 5,
      privateRepliesPerHour: 700,
    },
    features: { followVerificationEnabled: false, aiSuggestionsEnabled: false },
    rateLimits: { authPerMinute: 10_000, webhookPerMinute: 10_000, mutationPerMinute: 10_000 },
    ...overrides,
  };
}

export const silentLogger: LoggerLike = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class FakeAuthVerifier implements AuthVerifier {
  private readonly tokens = new Map<string, AuthUser>();

  register(token: string, user: AuthUser): void {
    this.tokens.set(token, user);
  }

  async verify(token: string): Promise<AuthUser> {
    const user = this.tokens.get(token);
    if (!user) throw errors.unauthenticated();
    return user;
  }
}

export interface FakeReplyCall {
  commentId: string;
  message: string;
}

export class FakeInstagramProvider implements InstagramProvider {
  readonly configured: boolean;
  authorizeUrl = 'https://www.instagram.com/oauth/authorize';
  permissions = ['instagram_business_basic', 'instagram_business_manage_comments'];
  profile = {
    igUserId: '17841400000000001',
    metaUserId: 'meta-user-1',
    username: 'test.creator',
    accountType: 'BUSINESS',
  };
  shortLivedToken = 'short-lived-token';
  longLivedToken = 'long-lived-token';
  replyResult = { id: 'public-reply-1' };
  privateReplyResult = { messageId: 'message-1', recipientId: 'igsid-1' };
  replyError: Error | null = null;
  privateReplyError: Error | null = null;
  exchangeError: Error | null = null;
  subscribeError: Error | null = null;

  readonly publicReplies: FakeReplyCall[] = [];
  readonly privateReplies: Array<FakeReplyCall & { igUserId: string }> = [];
  readonly subscriptions: string[][] = [];
  exchangeCalls = 0;

  constructor(options: { configured?: boolean } = {}) {
    this.configured = options.configured ?? true;
  }

  private failIfUnconfigured(): void {
    if (!this.configured) {
      throw errors.notConfigured('Instagram integration is not configured.');
    }
  }

  buildAuthorizeUrl(input: { state: string }): string {
    this.failIfUnconfigured();
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', '1234567890');
    url.searchParams.set('redirect_uri', 'http://api.test/api/integrations/instagram/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.permissions.join(','));
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(code: string) {
    this.failIfUnconfigured();
    this.exchangeCalls += 1;
    if (this.exchangeError) throw this.exchangeError;
    if (code === 'bad-code') {
      throw new MetaApiError({ message: 'Invalid authorization code', code: 100, httpStatus: 400 });
    }
    return {
      accessToken: this.shortLivedToken,
      userId: this.profile.igUserId,
      permissions: this.permissions,
      expiresIn: 3600,
    };
  }

  async exchangeLongLivedToken() {
    this.failIfUnconfigured();
    return { accessToken: this.longLivedToken, expiresIn: 5_183_944 };
  }

  async refreshToken() {
    this.failIfUnconfigured();
    return { accessToken: 'refreshed-long-lived-token', expiresIn: 5_183_944 };
  }

  async getProfile() {
    this.failIfUnconfigured();
    return this.profile;
  }

  async getMedia() {
    this.failIfUnconfigured();
    return [
      {
        id: 'media-1',
        mediaType: 'IMAGE',
        mediaProductType: 'FEED',
        caption: 'A post',
        permalink: 'https://www.instagram.com/p/abc/',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        timestamp: new Date('2026-01-01T00:00:00Z'),
      },
    ];
  }

  async subscribeWebhooks(_token: string, fields: string[]) {
    this.failIfUnconfigured();
    if (this.subscribeError) throw this.subscribeError;
    this.subscriptions.push(fields);
  }

  async replyToComment(_token: string, commentId: string, message: string) {
    this.failIfUnconfigured();
    if (this.replyError) throw this.replyError;
    this.publicReplies.push({ commentId, message });
    return this.replyResult;
  }

  async sendPrivateReply(_token: string, igUserId: string, commentId: string, message: string) {
    this.failIfUnconfigured();
    if (this.privateReplyError) throw this.privateReplyError;
    this.privateReplies.push({ igUserId, commentId, message });
    return this.privateReplyResult;
  }
}

export interface ApiHarness {
  ctx: TestDatabase;
  app: Express;
  config: AppConfig;
  provider: FakeInstagramProvider;
  authVerifier: FakeAuthVerifier;
  close: () => Promise<void>;
}

export async function createApiHarness(
  options: {
    config?: Partial<AppConfig>;
    provider?: FakeInstagramProvider;
  } = {},
): Promise<ApiHarness> {
  const ctx = await createTestDatabase();
  const config = testConfig(options.config);
  const provider = options.provider ?? new FakeInstagramProvider();
  const authVerifier = new FakeAuthVerifier();
  const app = createApp({
    config,
    store: ctx.store,
    provider,
    authVerifier,
    cipher,
    logger: silentLogger,
    rateLimitEnabled: false,
  });
  return {
    ctx,
    app,
    config,
    provider,
    authVerifier,
    close: () => ctx.close(),
  };
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
