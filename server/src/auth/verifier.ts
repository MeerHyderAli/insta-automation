import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../config/env.js';
import { errors, isAppError } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthVerifier {
  verify(token: string): Promise<AuthUser>;
}

class SupabaseJwtVerifier implements AuthVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly secret: Uint8Array | null;
  private readonly issuer: string | null;

  constructor(config: AppConfig) {
    const url = config.supabase.url;
    this.issuer = url ? `${url.replace(/\/$/, '')}/auth/v1` : null;
    this.jwks = this.issuer
      ? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`))
      : null;
    this.secret = config.supabase.jwtSecret
      ? new TextEncoder().encode(config.supabase.jwtSecret)
      : null;
  }

  async verify(token: string): Promise<AuthUser> {
    let header: { alg?: string } | null = null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw errors.unauthenticated('Malformed session token.');
      const encoded = parts[0] ?? '';
      header = JSON.parse(
        Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as { alg?: string };
    } catch {
      throw errors.unauthenticated('Malformed session token.');
    }

    try {
      let payload: JWTPayload;
      if (this.secret && header?.alg === 'HS256') {
        const result = await jwtVerify(token, this.secret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
          ...(this.issuer ? { issuer: this.issuer } : {}),
        });
        payload = result.payload;
      } else if (this.jwks) {
        const result = await jwtVerify(token, this.jwks, {
          algorithms: ['RS256', 'ES256', 'EdDSA'],
          audience: 'authenticated',
          ...(this.issuer ? { issuer: this.issuer } : {}),
        });
        payload = result.payload;
      } else {
        throw errors.unauthenticated('Authentication is not configured.');
      }
      const userId = payload.sub;
      if (!userId) throw errors.unauthenticated('Session token has no subject.');
      return {
        id: userId,
        email: typeof payload.email === 'string' ? payload.email : null,
      };
    } catch (error) {
      if (isAppError(error)) throw error;
      throw errors.unauthenticated('Your session is invalid or has expired. Sign in again.');
    }
  }
}

/** Local demo mode only; config forbids DEMO_MODE in production. */
class DemoAuthVerifier implements AuthVerifier {
  async verify(token: string): Promise<AuthUser> {
    if (!token) throw errors.unauthenticated();
    return { id: '00000000-0000-4000-8000-000000000001', email: 'demo@example.test' };
  }
}

/** Throws 503 on every attempt; used when Supabase Auth is not configured. */
class UnconfiguredAuthVerifier implements AuthVerifier {
  async verify(): Promise<AuthUser> {
    throw errors.notConfigured(
      'Supabase Auth is not configured. Set SUPABASE_URL (or SUPABASE_JWT_SECRET) on the server.',
    );
  }
}

export function createAuthVerifier(config: AppConfig): AuthVerifier {
  if (config.demoMode) return new DemoAuthVerifier();
  if (config.supabase.url || config.supabase.jwtSecret) return new SupabaseJwtVerifier(config);
  return new UnconfiguredAuthVerifier();
}
