import { randomUUID } from 'node:crypto';
import { errors } from '../../lib/errors.js';
import { hashToken, randomToken } from '../../lib/crypto/signatures.js';
import { tokenAad } from '../../lib/crypto/tokenCipher.js';
import type { InstagramProvider } from '../../integrations/instagram/provider.js';
import type { AppConfig } from '../../config/env.js';
import type { Store } from '../../db/store.js';
import type { TokenCipher } from '../../lib/crypto/tokenCipher.js';
import type { LoggerLike } from '../../lib/logger.js';

export interface OAuthDeps {
  config: AppConfig;
  store: Store;
  provider: InstagramProvider;
  cipher: TokenCipher;
  logger: LoggerLike;
}

export type OAuthFailureReason =
  | 'access_denied'
  | 'state_invalid'
  | 'missing_code'
  | 'not_configured'
  | 'token_exchange_failed'
  | 'permission_missing'
  | 'account_conflict'
  | 'quota_exceeded'
  | 'callback_failed';

export interface OAuthCallbackResult {
  ok: boolean;
  accountId?: string;
  username?: string;
  webhook?: 'confirmed' | 'failed';
  reason?: OAuthFailureReason;
  message?: string;
}

/**
 * Instagram API with Instagram Login OAuth. The authorization code is
 * exchanged server-side only; the short-lived token is immediately upgraded to
 * a long-lived token and encrypted before it is stored.
 */
export class OAuthService {
  constructor(private readonly deps: OAuthDeps) {}

  private get provider(): InstagramProvider {
    return this.deps.provider;
  }

  async start(workspaceId: string, userId: string): Promise<{ authorizeUrl: string }> {
    if (!this.provider.configured) {
      throw errors.notConfigured(
        'Instagram login is not configured on this server. Set META_APP_ID, META_APP_SECRET, META_REDIRECT_URI and META_WEBHOOK_VERIFY_TOKEN.',
      );
    }
    const state = randomToken(32);
    await this.deps.store.createOAuthState({
      stateHash: hashToken(state),
      workspaceId,
      userId,
      expiresAt: new Date(Date.now() + this.deps.config.security.oauthStateTtlSeconds * 1000),
    });
    return { authorizeUrl: this.provider.buildAuthorizeUrl({ state }) };
  }

  /**
   * Consumes the single-use state before any network call. A replayed state
   * cannot be used again, even when the exchange afterwards fails.
   */
  async handleCallback(input: {
    code?: string;
    state?: string;
    error?: string;
    errorReason?: string;
  }): Promise<OAuthCallbackResult> {
    if (!input.state) {
      return { ok: false, reason: 'state_invalid', message: 'Missing OAuth state.' };
    }
    const record = await this.deps.store.consumeOAuthState(hashToken(input.state));
    if (!record) {
      return {
        ok: false,
        reason: 'state_invalid',
        message: 'The OAuth state is invalid, expired or already used.',
      };
    }
    if (input.error || !input.code) {
      return {
        ok: false,
        reason: input.error === 'access_denied' ? 'access_denied' : 'missing_code',
        message: input.error
          ? `Instagram returned ${input.error}${input.errorReason ? `: ${input.errorReason}` : ''}.`
          : 'Instagram did not return an authorization code.',
      };
    }
    if (!this.provider.configured) {
      return { ok: false, reason: 'not_configured' };
    }

    const workspace = await this.deps.store.getWorkspace(record.workspaceId);
    if (!workspace)
      return { ok: false, reason: 'callback_failed', message: 'Workspace not found.' };
    const membership = await this.deps.store.getMembership(workspace.id, record.userId);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return {
        ok: false,
        reason: 'callback_failed',
        message: 'Only workspace owners and admins can connect an Instagram account.',
      };
    }

    let shortToken;
    try {
      shortToken = await this.provider.exchangeCode(
        input.code,
        this.deps.config.meta.redirectUri ?? '',
      );
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Instagram code exchange failed');
      return {
        ok: false,
        reason: 'token_exchange_failed',
        message: 'Instagram rejected the authorization code exchange.',
      };
    }
    if (shortToken.permissions.length > 0) {
      const missing = this.deps.config.meta.scopes.filter(
        (scope) => !shortToken.permissions.includes(scope),
      );
      if (missing.length > 0) {
        return {
          ok: false,
          reason: 'permission_missing',
          message: `Instagram did not grant: ${missing.join(', ')}.`,
        };
      }
    }

    let longToken;
    try {
      longToken = await this.provider.exchangeLongLivedToken(shortToken.accessToken);
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Instagram long-lived token exchange failed');
      return {
        ok: false,
        reason: 'token_exchange_failed',
        message: 'Instagram rejected the long-lived token exchange.',
      };
    }

    let profile;
    try {
      profile = await this.provider.getProfile(longToken.accessToken);
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Instagram profile fetch failed');
      return {
        ok: false,
        reason: 'callback_failed',
        message: 'Could not read the Instagram profile for this token.',
      };
    }

    const igUserId = profile.igUserId || shortToken.userId;
    if (!igUserId) {
      return {
        ok: false,
        reason: 'callback_failed',
        message: 'Instagram did not return an account id.',
      };
    }

    const existing = await this.deps.store.getAccountByIgUserId(igUserId);
    if (existing && existing.workspaceId !== workspace.id) {
      return {
        ok: false,
        reason: 'account_conflict',
        message: 'That Instagram account is already connected to another workspace.',
      };
    }

    if (!existing) {
      const plan = await this.deps.store.getPlan(workspace.planId);
      const count = await this.deps.store.countAccounts(workspace.id);
      if (plan && count >= plan.limits.accounts) {
        return {
          ok: false,
          reason: 'quota_exceeded',
          message: `The ${plan.name} plan allows ${plan.limits.accounts} connected account(s).`,
        };
      }
    }

    const accountId = existing?.id ?? randomUUID();
    const token = this.deps.cipher.encrypt(longToken.accessToken, tokenAad(accountId));
    const expiresAt = new Date(Date.now() + longToken.expiresIn * 1000);

    const { account } = await this.deps.store.upsertAccount({
      id: accountId,
      workspaceId: workspace.id,
      igUserId,
      metaUserId: profile.metaUserId,
      username: profile.username,
      accountType: profile.accountType,
      scopes:
        shortToken.permissions.length > 0 ? shortToken.permissions : this.deps.config.meta.scopes,
      token,
      tokenExpiresAt: expiresAt,
    });
    await this.deps.store.recordAudit({
      workspaceId: workspace.id,
      actorUserId: record.userId,
      action: existing ? 'instagram.account_reconnected' : 'instagram.account_connected',
      targetType: 'instagram_account',
      targetId: account.id,
    });

    let webhook: 'confirmed' | 'failed' = 'failed';
    try {
      await this.provider.subscribeWebhooks(
        longToken.accessToken,
        this.deps.config.meta.webhookFields,
      );
      await this.deps.store.markWebhookSubscribed(account.id);
      webhook = 'confirmed';
    } catch (error) {
      this.deps.logger.warn({ err: error, accountId: account.id }, 'Webhook subscription failed');
    }

    return {
      ok: true,
      accountId: account.id,
      username: account.username,
      webhook,
    };
  }
}
