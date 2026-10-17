import { errors } from '../../lib/errors.js';
import { tokenAad } from '../../lib/crypto/tokenCipher.js';
import type { AccountRecord } from '../../types/domain.js';
import type { AppConfig } from '../../config/env.js';
import type { Store } from '../../db/store.js';
import type { TokenCipher } from '../../lib/crypto/tokenCipher.js';
import type { LoggerLike } from '../../lib/logger.js';
import type { InstagramProvider } from '../../integrations/instagram/provider.js';

export interface TokenRefreshDeps {
  config: AppConfig;
  store: Store;
  provider: InstagramProvider;
  cipher: TokenCipher;
  logger: LoggerLike;
}

/** Refreshes a long-lived Instagram token well before its 60-day expiry. */
export class TokenRefreshService {
  constructor(private readonly deps: TokenRefreshDeps) {}

  async refreshAccount(account: AccountRecord, options: { force?: boolean } = {}) {
    if (account.status === 'disconnected') {
      throw errors.conflict('This Instagram account is disconnected.');
    }
    const now = Date.now();
    const expiresInMs = account.tokenExpiresAt.getTime() - now;
    if (!options.force && expiresInMs > 5 * 86_400_000) {
      return account;
    }
    let plaintext: string;
    try {
      plaintext = this.deps.cipher.decrypt(account.token, tokenAad(account.id));
    } catch {
      await this.deps.store.updateAccountStatus(account.id, 'needs_reconnect', 'TOKEN_UNREADABLE');
      throw errors.reconnectRequired(
        'The stored Instagram token cannot be decrypted. Disconnect and reconnect the account.',
      );
    }
    try {
      const refreshed = await this.deps.provider.refreshToken(plaintext);
      const next = await this.deps.store.updateAccountToken(
        account.id,
        this.deps.cipher.encrypt(refreshed.accessToken, tokenAad(account.id)),
        new Date(Date.now() + refreshed.expiresIn * 1000),
      );
      await this.deps.store.updateAccountStatus(account.id, 'connected');
      return next;
    } catch (error) {
      this.deps.logger.warn(
        { err: error, accountId: account.id },
        'Instagram token refresh failed',
      );
      throw errors.reconnectRequired(
        'Instagram rejected the token refresh. Reconnect the account to continue.',
      );
    }
  }

  async refreshExpiring(withinDays = 10): Promise<{ refreshed: number; failed: number }> {
    const cutoff = new Date(Date.now() + withinDays * 86_400_000);
    const accounts = await this.deps.store.listAccountsNeedingRefresh(cutoff);
    let refreshed = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await this.refreshAccount(account);
        refreshed += 1;
      } catch {
        failed += 1;
      }
    }
    return { refreshed, failed };
  }
}
