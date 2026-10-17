import type { AppConfig } from '../config/env.js';
import type { Store } from '../db/store.js';
import type { LoggerLike } from '../lib/logger.js';
import type { TokenCipher } from '../lib/crypto/tokenCipher.js';
import type { InstagramProvider } from '../integrations/instagram/provider.js';
import { OAuthService } from './accounts/oauth.js';
import { TokenRefreshService } from './accounts/tokenRefresh.js';
import { WebhookService } from './webhooks/service.js';

export interface ServiceDependencies {
  config: AppConfig;
  store: Store;
  provider: InstagramProvider;
  cipher: TokenCipher;
  logger: LoggerLike;
}

export function createServices(deps: ServiceDependencies) {
  return {
    oauth: new OAuthService(deps),
    tokenRefresh: new TokenRefreshService(deps),
    webhooks: new WebhookService(deps),
  };
}
