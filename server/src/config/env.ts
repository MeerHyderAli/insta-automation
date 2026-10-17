import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Loads `.env` from the current working directory and the repository root.
 * Existing process environment variables always win.
 */
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')],
  quiet: true,
});

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : /^(1|true|yes|on)$/i.test(value.trim()),
  );

const csv = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: csv('').optional(),
    API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
    DEMO_MODE: booleanish.default(false),

    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_SSL: booleanish.default(false),

    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_JWT_SECRET: z.string().min(1).optional(),

    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),
    META_REDIRECT_URI: z.string().url().optional(),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(8).optional(),
    META_GRAPH_VERSION: z
      .string()
      .regex(/^v\d{1,3}\.\d{1,3}$/, 'Use a version like v25.0')
      .default('v25.0'),
    META_SCOPES: csv('instagram_business_basic,instagram_business_manage_comments'),
    META_WEBHOOK_FIELDS: csv('comments'),

    TOKEN_ENCRYPTION_KEY: z.string().optional(),
    TOKEN_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),

    WORKER_ENABLED: booleanish.default(true),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    PRIVATE_REPLIES_PER_HOUR: z.coerce.number().int().min(1).max(750).default(700),

    FOLLOW_VERIFICATION_ENABLED: booleanish.default(false),
    AI_SUGGESTIONS_ENABLED: booleanish.default(false),

    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(30),
    WEBHOOK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(600),
    MUTATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
  })
  .passthrough();

export type AppEnvironment = 'development' | 'test' | 'production';

export interface RateLimitConfig {
  authPerMinute: number;
  webhookPerMinute: number;
  mutationPerMinute: number;
}

export interface AppConfig {
  env: AppEnvironment;
  isProduction: boolean;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  clientOrigin: string;
  clientOrigins: string[];
  apiPublicUrl: string;
  demoMode: boolean;
  database: { url: string | null; ssl: boolean };
  supabase: {
    url: string | null;
    anonKey: string | null;
    serviceRoleKey: string | null;
    jwtSecret: string | null;
    configured: boolean;
  };
  meta: {
    appId: string | null;
    appSecret: string | null;
    redirectUri: string | null;
    webhookVerifyToken: string | null;
    graphVersion: string;
    scopes: string[];
    webhookFields: string[];
    configured: boolean;
  };
  security: {
    tokenEncryptionKey: string | null;
    tokenKeyVersion: number;
    oauthStateTtlSeconds: number;
  };
  worker: {
    enabled: boolean;
    concurrency: number;
    pollIntervalMs: number;
    maxAttempts: number;
    privateRepliesPerHour: number;
  };
  features: {
    followVerificationEnabled: boolean;
    aiSuggestionsEnabled: boolean;
  };
  rateLimits: RateLimitConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validates configuration and fails closed in production. Meta/Supabase
 * credentials are optional so the app can boot and report "not configured"
 * instead of serving a broken OAuth flow; production requires the pieces
 * needed for authentication and encryption.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration: ${details}`);
  }
  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === 'production';

  const supabaseUrl = raw.SUPABASE_URL ?? null;
  const jwtSecret = raw.SUPABASE_JWT_SECRET ?? null;
  if (!supabaseUrl && !jwtSecret) {
    if (isProduction && !raw.DEMO_MODE) {
      throw new ConfigError(
        'SUPABASE_URL (with JWKS) or SUPABASE_JWT_SECRET is required in production when DEMO_MODE is off.',
      );
    }
  }

  if (raw.DEMO_MODE && isProduction) {
    throw new ConfigError(
      'DEMO_MODE cannot be enabled with NODE_ENV=production. Demo authentication bypasses real users.',
    );
  }

  if (!raw.DATABASE_URL && !raw.DEMO_MODE) {
    throw new ConfigError(
      'DATABASE_URL is required. Set it to the Supabase Postgres connection string (DEMO_MODE still uses the database).',
    );
  }

  if (isProduction && !raw.TOKEN_ENCRYPTION_KEY) {
    throw new ConfigError(
      'TOKEN_ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32',
    );
  }

  if (raw.FOLLOW_VERIFICATION_ENABLED) {
    // The capability is not supported by Meta for arbitrary commenters. The
    // flag may only be enabled once the docs prove otherwise; refuse silently
    // pretending it works.
    throw new ConfigError(
      'FOLLOW_VERIFICATION_ENABLED cannot be enabled: Meta does not expose follow status for arbitrary commenters. See docs/META_API_FEASIBILITY.md.',
    );
  }

  const clientOrigins = [raw.CLIENT_ORIGIN, ...(raw.CORS_ORIGINS ?? [])].filter(
    (origin, index, all) => Boolean(origin) && all.indexOf(origin) === index,
  );

  const metaConfigured = Boolean(
    raw.META_APP_ID &&
    raw.META_APP_SECRET &&
    raw.META_REDIRECT_URI &&
    raw.META_WEBHOOK_VERIFY_TOKEN,
  );

  if (isProduction && !metaConfigured) {
    // Allowed to boot for review/demo deployments, but every Instagram call
    // will fail closed with NOT_CONFIGURED and the UI reports it.
    // eslint-disable-next-line no-console
    console.warn(
      '[config] Meta credentials are incomplete. Instagram OAuth, webhooks and replies are disabled.',
    );
  }

  return {
    env: raw.NODE_ENV,
    isProduction,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    clientOrigin: raw.CLIENT_ORIGIN,
    clientOrigins,
    apiPublicUrl: raw.API_PUBLIC_URL.replace(/\/$/, ''),
    demoMode: raw.DEMO_MODE,
    database: { url: raw.DATABASE_URL ?? null, ssl: raw.DATABASE_SSL },
    supabase: {
      url: supabaseUrl,
      anonKey: raw.SUPABASE_ANON_KEY ?? null,
      serviceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY ?? null,
      jwtSecret,
      configured: Boolean(supabaseUrl),
    },
    meta: {
      appId: raw.META_APP_ID ?? null,
      appSecret: raw.META_APP_SECRET ?? null,
      redirectUri: raw.META_REDIRECT_URI ?? null,
      webhookVerifyToken: raw.META_WEBHOOK_VERIFY_TOKEN ?? null,
      graphVersion: raw.META_GRAPH_VERSION,
      scopes: raw.META_SCOPES.length > 0 ? raw.META_SCOPES : ['instagram_business_basic'],
      webhookFields: raw.META_WEBHOOK_FIELDS.length > 0 ? raw.META_WEBHOOK_FIELDS : ['comments'],
      configured: metaConfigured,
    },
    security: {
      tokenEncryptionKey: raw.TOKEN_ENCRYPTION_KEY ?? null,
      tokenKeyVersion: raw.TOKEN_KEY_VERSION,
      oauthStateTtlSeconds: raw.OAUTH_STATE_TTL_SECONDS,
    },
    worker: {
      enabled: raw.WORKER_ENABLED,
      concurrency: raw.WORKER_CONCURRENCY,
      pollIntervalMs: raw.WORKER_POLL_INTERVAL_MS,
      maxAttempts: raw.WORKER_MAX_ATTEMPTS,
      privateRepliesPerHour: Math.min(raw.PRIVATE_REPLIES_PER_HOUR, 750),
    },
    features: {
      followVerificationEnabled: false,
      aiSuggestionsEnabled: raw.AI_SUGGESTIONS_ENABLED,
    },
    rateLimits: {
      authPerMinute: raw.AUTH_RATE_LIMIT_PER_MINUTE,
      webhookPerMinute: raw.WEBHOOK_RATE_LIMIT_PER_MINUTE,
      mutationPerMinute: raw.MUTATION_RATE_LIMIT_PER_MINUTE,
    },
  };
}

/** Used by tests that only care about a subset. */
export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    env: 'test',
    isProduction: false,
    port: 3001,
    logLevel: 'silent',
    clientOrigin: 'http://localhost:5173',
    clientOrigins: ['http://localhost:5173'],
    apiPublicUrl: 'http://localhost:3001',
    demoMode: false,
    database: { url: null, ssl: false },
    supabase: {
      url: null,
      anonKey: null,
      serviceRoleKey: null,
      jwtSecret: 'test-jwt-secret-at-least-32-characters-long',
      configured: false,
    },
    meta: {
      appId: '1234567890',
      appSecret: 'test-app-secret',
      redirectUri: 'http://localhost:3001/api/integrations/instagram/callback',
      webhookVerifyToken: 'test-verify-token',
      graphVersion: 'v25.0',
      scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
      webhookFields: ['comments', 'live_comments'],
      configured: true,
    },
    security: {
      tokenEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
      tokenKeyVersion: 1,
      oauthStateTtlSeconds: 600,
    },
    worker: {
      enabled: false,
      concurrency: 2,
      pollIntervalMs: 250,
      maxAttempts: 5,
      privateRepliesPerHour: 700,
    },
    features: { followVerificationEnabled: false, aiSuggestionsEnabled: false },
    rateLimits: { authPerMinute: 1000, webhookPerMinute: 1000, mutationPerMinute: 1000 },
  };
  return { ...base, ...overrides };
}
