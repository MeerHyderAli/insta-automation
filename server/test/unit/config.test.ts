import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  SUPABASE_URL: 'https://example.supabase.co',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  META_APP_ID: '123',
  META_APP_SECRET: 'secret',
  META_REDIRECT_URI: 'https://api.example.com/api/integrations/instagram/callback',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-token-123',
};

describe('config validation', () => {
  it('accepts a valid configuration and derives Meta readiness', () => {
    const config = loadConfig({ ...base });
    expect(config.meta.configured).toBe(true);
    expect(config.database.ssl).toBe(false);
    expect(config.meta.scopes).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_comments',
    ]);
    expect(config.features.followVerificationEnabled).toBe(false);
  });

  it('refuses to enable unsupported follow verification', () => {
    expect(() => loadConfig({ ...base, FOLLOW_VERIFICATION_ENABLED: 'true' })).toThrow(ConfigError);
  });

  it('refuses demo mode in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(
      /DEMO_MODE/,
    );
  });

  it('requires a token encryption key in production', () => {
    const { TOKEN_ENCRYPTION_KEY: _unused, ...withoutKey } = base;
    expect(() => loadConfig({ ...withoutKey, NODE_ENV: 'production' })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it('requires a database connection', () => {
    const { DATABASE_URL: _unused, ...withoutDb } = base;
    expect(() => loadConfig(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('requires Supabase auth configuration in production (unless demo)', () => {
    const { SUPABASE_URL: _unused, ...withoutSupabase } = base;
    expect(() =>
      loadConfig({ ...withoutSupabase, NODE_ENV: 'production', DEMO_MODE: 'false' }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('rejects malformed graph versions and timezones', () => {
    expect(() => loadConfig({ ...base, META_GRAPH_VERSION: '25' })).toThrow(/Invalid environment/);
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow(/Invalid environment/);
  });
});
