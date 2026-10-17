import { Router } from 'express';
import type { ModuleDeps } from './deps.js';
import { AppError, errors } from '../lib/errors.js';
import {
  verifyHubSignature,
  verifySignedRequest,
  verifyWebhookChallenge,
} from '../lib/crypto/signatures.js';

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function signedRequestFrom(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'signed_request' in body) {
    return firstString((body as { signed_request?: unknown }).signed_request);
  }
  return undefined;
}

export function createWebhooksRouter(deps: ModuleDeps): Router {
  const router = Router();

  // Meta verification handshake. The challenge is only echoed when the shared
  // verify token matches exactly.
  router.get('/webhooks/instagram', (req, res) => {
    const mode = firstString(req.query['hub.mode']);
    const token = firstString(req.query['hub.verify_token']);
    const challenge = firstString(req.query['hub.challenge']);
    const expected = deps.config.meta.webhookVerifyToken;
    if (!expected) {
      throw errors.notConfigured('META_WEBHOOK_VERIFY_TOKEN is not configured.');
    }
    if (!token || !challenge || !verifyWebhookChallenge(mode, token, expected)) {
      throw errors.forbidden('Webhook verification failed.');
    }
    res.status(200).type('text/plain').send(challenge);
  });

  // Event delivery. Signature is verified against the raw body before parsing
  // is trusted. The endpoint acknowledges only after events are persisted.
  router.post('/webhooks/instagram', deps.rateLimiters.webhook, async (req, res) => {
    const signature = req.get('x-hub-signature-256');
    const secret = deps.config.meta.appSecret;
    if (!verifyHubSignature(req.rawBody, signature, secret ?? undefined)) {
      deps.logger.warn({ requestId: req.requestId }, 'Rejected webhook with invalid signature');
      throw new AppError(401, 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is invalid.');
    }
    const summary = await deps.webhooks.ingest(req.body);
    res.status(200).json({
      received: true,
      events: summary.received,
      queued: summary.queued,
      duplicates: summary.duplicates,
      ignored: summary.ignored,
      unsupported: summary.unsupported,
    });
  });

  router.post('/webhooks/instagram/deauthorize', deps.rateLimiters.webhook, async (req, res) => {
    const payload = verifySignedRequest(
      signedRequestFrom(req.body),
      deps.config.meta.appSecret ?? undefined,
    );
    if (!payload) {
      deps.logger.warn({ requestId: req.requestId }, 'Rejected deauthorize callback');
      throw errors.forbidden('The signed request is invalid.');
    }
    const result = await deps.webhooks.handleDeauthorize(payload);
    res.status(200).json({ ok: true, accounts: result.accounts });
  });

  router.post('/webhooks/instagram/data-deletion', deps.rateLimiters.webhook, async (req, res) => {
    const payload = verifySignedRequest(
      signedRequestFrom(req.body),
      deps.config.meta.appSecret ?? undefined,
    );
    if (!payload) {
      deps.logger.warn({ requestId: req.requestId }, 'Rejected data deletion callback');
      throw errors.forbidden('The signed request is invalid.');
    }
    const { code } = await deps.webhooks.handleDataDeletion(payload);
    res.status(200).json({
      url: `${deps.config.apiPublicUrl}/api/webhooks/instagram/data-deletion/status?code=${encodeURIComponent(code)}`,
      confirmation_code: code,
    });
  });

  router.get('/webhooks/instagram/data-deletion/status', async (req, res) => {
    const code = firstString(req.query.code);
    if (!code) throw errors.validation('A confirmation code is required.');
    const record = await deps.webhooks.deletionStatus(code);
    if (!record) throw errors.notFound('Deletion request not found.');
    res.json({
      confirmationCode: record.code,
      status: record.status,
      requestedAt: record.requestedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
    });
  });

  return router;
}
