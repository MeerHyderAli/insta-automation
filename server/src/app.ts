import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import type { Store } from './db/store.js';
import type { AuthVerifier } from './auth/verifier.js';
import type { InstagramProvider } from './integrations/instagram/provider.js';
import type { LoggerLike } from './lib/logger.js';
import type { TokenCipher } from './lib/crypto/tokenCipher.js';
import { errors } from './lib/errors.js';
import { requestId } from './middleware/requestId.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { createServices } from './modules/services.js';
import type { ModuleDeps } from './modules/deps.js';
import { createWorkspacesRouter } from './modules/workspaces.js';
import { createAccountsRouter } from './modules/accounts.js';
import { createRulesRouter } from './modules/rules.js';
import { createResourcesRouter } from './modules/resources.js';
import { createRunsRouter } from './modules/runs.js';
import { createInsightsRouter } from './modules/insights.js';
import { createWebhooksRouter } from './modules/webhooks.js';
import { createPublicRouter } from './modules/public.js';
import {
  getCapabilities,
  getFollowVerificationCapability,
} from './integrations/instagram/capabilities.js';

export interface AppDependencies {
  config: AppConfig;
  store: Store;
  provider: InstagramProvider;
  authVerifier: AuthVerifier;
  cipher: TokenCipher;
  logger: LoggerLike;
  /** Disabled in most tests; never disabled against the public internet. */
  rateLimitEnabled?: boolean;
}

function requestLogger(logger: LoggerLike) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health' || req.path === '/api/ready') return;
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        'request',
      );
    });
    next();
  };
}

/**
 * Express app factory. All integrations are injected so tests can use a fake
 * provider and a PGlite-backed database, and production can use the real Graph
 * API and Supabase Postgres.
 */
export function createApp(deps: AppDependencies): express.Express {
  const { config, store, provider, cipher, logger } = deps;
  const app = express();
  const rateLimiters = createRateLimiters(config.rateLimits, deps.rateLimitEnabled ?? true);
  const services = createServices({ config, store, provider, cipher, logger });
  const modules: ModuleDeps = {
    config,
    store,
    provider,
    cipher,
    logger,
    rateLimiters,
    ...services,
  };

  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.clientOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
      exposedHeaders: ['x-request-id', 'retry-after'],
      maxAge: 600,
    }),
  );
  app.use(requestId());
  app.use(requestLogger(logger));

  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as Request).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get('/api/ready', async (_req, res) => {
    try {
      await store.ping();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // Public, non-sensitive client bootstrap. Never includes secrets or tokens.
  app.get('/api/config', (_req, res) => {
    res.json({
      environment: config.env,
      demoMode: config.demoMode,
      supabaseUrl: null,
      supabaseAnonKey: null,
      apiPublicUrl: config.apiPublicUrl,
      metaConfigured: provider.configured,
      graphVersion: config.meta.graphVersion,
      webhookFields: config.meta.webhookFields,
      capabilities: getCapabilities(),
      followVerification: getFollowVerificationCapability(),
    });
  });

  // Public Meta OAuth callback. The state is single-use and bound to the
  // workspace + user that initiated the flow; errors never echo the code.
  app.get('/api/integrations/instagram/callback', rateLimiters.oauth, async (req, res) => {
    const one = (value: unknown): string | undefined =>
      typeof value === 'string'
        ? value
        : Array.isArray(value) && typeof value[0] === 'string'
          ? value[0]
          : undefined;
    const result = await services.oauth.handleCallback({
      code: one(req.query.code),
      state: one(req.query.state),
      error: one(req.query.error),
      errorReason: one(req.query.error_reason) ?? one(req.query.error_description),
    });
    const url = new URL('/accounts', config.clientOrigin);
    if (result.ok) {
      url.searchParams.set('instagram', 'connected');
      if (result.username) url.searchParams.set('username', result.username);
      url.searchParams.set('webhook', result.webhook ?? 'failed');
    } else {
      url.searchParams.set('instagram', 'error');
      url.searchParams.set('reason', result.reason ?? 'callback_failed');
      logger.warn(
        { reason: result.reason, requestId: req.requestId },
        'Instagram OAuth callback failed',
      );
    }
    res.redirect(302, url.toString());
  });

  app.use('/api', createWebhooksRouter(modules));
  app.use(createPublicRouter(modules));

  const api = express.Router();
  api.use(rateLimiters.auth);
  api.use(requireAuth(deps.authVerifier));
  api.use(createWorkspacesRouter(modules));
  api.use(createAccountsRouter(modules));
  api.use(createRulesRouter(modules));
  api.use(createResourcesRouter(modules));
  api.use(createRunsRouter(modules));
  api.use(createInsightsRouter(modules));
  app.use('/api', api);

  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/')) {
      next(errors.notFound('API route not found.'));
      return;
    }
    next(errors.notFound('Not found.'));
  });

  app.use(errorHandler(logger));
  return app;
}
