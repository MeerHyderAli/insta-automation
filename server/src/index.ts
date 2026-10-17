import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createAuthVerifier } from './auth/verifier.js';
import { createStore } from './db/index.js';
import { createInstagramProvider } from './integrations/instagram/graphProvider.js';
import { TokenCipher } from './lib/crypto/tokenCipher.js';
import { createLogger } from './lib/logger.js';
import { AutomationEngine } from './automation/engine.js';
import { AutomationWorker } from './automation/worker.js';
import { TokenRefreshService } from './modules/accounts/tokenRefresh.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (!config.security.tokenEncryptionKey) {
    if (config.isProduction) throw new Error('TOKEN_ENCRYPTION_KEY is required.');
    logger.warn(
      'TOKEN_ENCRYPTION_KEY is not set; using an ephemeral key. Instagram tokens will be unreadable after a restart.',
    );
  }
  const key = config.security.tokenEncryptionKey ?? randomBytes(32).toString('base64');
  const cipher = new TokenCipher(key, config.security.tokenKeyVersion);
  const { store, close } = createStore(config);
  const provider = createInstagramProvider(config);
  const authVerifier = createAuthVerifier(config);
  const app = createApp({
    config,
    store,
    provider,
    authVerifier,
    cipher,
    logger,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        environment: config.env,
        metaConfigured: config.meta.configured,
        supabaseConfigured: config.supabase.configured,
      },
      'API listening',
    );
    if (!config.meta.configured) {
      logger.warn(
        'Instagram integration is not configured; OAuth, webhooks and replies are disabled.',
      );
    }
  });

  let worker: AutomationWorker | null = null;
  if (config.worker.enabled) {
    const engine = new AutomationEngine({ store, provider, cipher, config, logger });
    worker = new AutomationWorker(store, engine, logger, {
      pollIntervalMs: config.worker.pollIntervalMs,
      concurrency: config.worker.concurrency,
      maxAttempts: config.worker.maxAttempts,
    });
    worker.start();
  }

  const tokenRefreshService = new TokenRefreshService({ config, store, provider, cipher, logger });

  const refresh = async (): Promise<void> => {
    try {
      await tokenRefreshService.refreshExpiring(10);
      await store.purgeOldData(30);
    } catch (error) {
      logger.error(
        { err: { message: error instanceof Error ? error.message : 'unknown' } },
        'Scheduled maintenance failed',
      );
    }
  };

  // Refresh long-lived tokens every 6 hours and purge expired payloads daily.
  const refreshTimer = setInterval(() => void refresh(), 6 * 60 * 60 * 1000);
  const firstRefresh = setTimeout(() => void refresh(), 60_000);
  refreshTimer.unref();
  firstRefresh.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    clearInterval(refreshTimer);
    clearTimeout(firstRefresh);
    if (worker) await worker.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 10_000).unref();
    });
    await close();
    process.exitCode = 0;
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error(
      { err: { message: reason instanceof Error ? reason.message : 'unhandled rejection' } },
      'Unhandled promise rejection',
    );
  });
}

main().catch((error: unknown) => {
  // Config errors must be readable before a logger exists.
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
