import type { AppConfig } from '../config/env.js';
import type { Store } from '../db/store.js';
import type { LoggerLike } from '../lib/logger.js';
import type { InstagramProvider } from '../integrations/instagram/provider.js';
import type { TokenCipher } from '../lib/crypto/tokenCipher.js';
import type { OAuthService } from './accounts/oauth.js';
import type { TokenRefreshService } from './accounts/tokenRefresh.js';
import type { WebhookService } from './webhooks/service.js';
import type { RateLimiters } from '../middleware/rateLimit.js';

export interface ModuleDeps {
  config: AppConfig;
  store: Store;
  provider: InstagramProvider;
  cipher: TokenCipher;
  oauth: OAuthService;
  tokenRefresh: TokenRefreshService;
  webhooks: WebhookService;
  logger: LoggerLike;
  rateLimiters: RateLimiters;
}
