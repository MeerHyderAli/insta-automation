import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { accountDto } from './serializers.js';
import { errors } from '../lib/errors.js';
import { tokenAad } from '../lib/crypto/tokenCipher.js';
import { MetaApiError } from '../integrations/instagram/errors.js';
import { metaErrorToAppError } from './metaErrors.js';
import { parseInput } from '../middleware/validate.js';
import { requireRole, requireWorkspace } from '../middleware/workspace.js';
import type { AccountRecord } from '../types/domain.js';

const AccountIdSchema = z.string().uuid();

const DeleteAccountSchema = z.object({ confirmUsername: z.string().trim().min(1) }).strict();

function decryptToken(deps: ModuleDeps, account: AccountRecord): string {
  try {
    return deps.cipher.decrypt(account.token, tokenAad(account.id));
  } catch {
    throw errors.reconnectRequired(
      'The stored Instagram token cannot be decrypted. Disconnect and reconnect this account.',
    );
  }
}

async function markFailure(
  deps: ModuleDeps,
  account: AccountRecord,
  error: unknown,
): Promise<void> {
  if (error instanceof MetaApiError) {
    const status =
      error.category === 'token'
        ? 'needs_reconnect'
        : error.category === 'permission'
          ? 'missing_permissions'
          : null;
    if (status) {
      await deps.store
        .updateAccountStatus(account.id, status, `META_${error.code ?? 'UNKNOWN'}`)
        .catch(() => undefined);
    }
  }
}

export function createAccountsRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/accounts',
    requireWorkspace(deps.store),
    async (req, res) => {
      const accounts = await deps.store.listAccounts(req.workspace!.id);
      res.json({ accounts: accounts.map((account) => accountDto(account)) });
    },
  );

  router.post(
    '/workspaces/:workspaceId/oauth/start',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.oauth,
    async (req, res) => {
      const { authorizeUrl } = await deps.oauth.start(req.workspace!.id, req.user!.id);
      res.json({ authorizeUrl });
    },
  );

  router.get(
    '/workspaces/:workspaceId/accounts/:accountId/media',
    requireWorkspace(deps.store),
    async (req, res) => {
      const accountId = parseInput(AccountIdSchema, req.params.accountId, 'Invalid account id.');
      const account = await deps.store.getAccount(req.workspace!.id, accountId);
      if (!account) throw errors.notFound('Instagram account not found.');
      const media = await deps.store.listMedia(req.workspace!.id, account.id);
      res.json({
        media: media.map((item) => ({
          id: item.id,
          mediaId: item.igMediaId,
          mediaType: item.mediaType,
          mediaProductType: item.mediaProductType,
          caption: item.caption,
          permalink: item.permalink,
          thumbnailUrl: item.thumbnailUrl,
          publishedAt: item.publishedAt?.toISOString() ?? null,
        })),
      });
    },
  );

  router.post(
    '/workspaces/:workspaceId/accounts/:accountId/media/sync',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const accountId = parseInput(AccountIdSchema, req.params.accountId, 'Invalid account id.');
      const account = await deps.store.getAccount(req.workspace!.id, accountId);
      if (!account) throw errors.notFound('Instagram account not found.');
      if (account.status === 'disconnected') {
        throw errors.conflict('Reconnect this account before syncing media.');
      }
      const token = decryptToken(deps, account);
      try {
        const items = await deps.provider.getMedia(token, account.igUserId);
        const media = await deps.store.replaceMedia(
          req.workspace!.id,
          account.id,
          items.slice(0, 200).map((item) => ({
            igMediaId: item.id,
            mediaType: item.mediaType,
            mediaProductType: item.mediaProductType,
            caption: item.caption?.slice(0, 2200) ?? null,
            permalink: item.permalink,
            thumbnailUrl: item.thumbnailUrl,
            publishedAt: item.timestamp,
          })),
        );
        res.json({
          media: media.map((item) => ({
            id: item.id,
            mediaId: item.igMediaId,
            mediaType: item.mediaType,
            mediaProductType: item.mediaProductType,
            caption: item.caption,
            permalink: item.permalink,
            thumbnailUrl: item.thumbnailUrl,
            publishedAt: item.publishedAt?.toISOString() ?? null,
          })),
        });
      } catch (error) {
        await markFailure(deps, account, error);
        throw metaErrorToAppError(error);
      }
    },
  );

  router.post(
    '/workspaces/:workspaceId/accounts/:accountId/webhook-subscribe',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const accountId = parseInput(AccountIdSchema, req.params.accountId, 'Invalid account id.');
      const account = await deps.store.getAccount(req.workspace!.id, accountId);
      if (!account) throw errors.notFound('Instagram account not found.');
      const token = decryptToken(deps, account);
      try {
        await deps.provider.subscribeWebhooks(token, deps.config.meta.webhookFields);
        const updated = await deps.store.markWebhookSubscribed(account.id);
        res.json({ account: accountDto(updated) });
      } catch (error) {
        await markFailure(deps, account, error);
        throw metaErrorToAppError(error);
      }
    },
  );

  router.post(
    '/workspaces/:workspaceId/accounts/:accountId/refresh-token',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const accountId = parseInput(AccountIdSchema, req.params.accountId, 'Invalid account id.');
      const account = await deps.store.getAccount(req.workspace!.id, accountId);
      if (!account) throw errors.notFound('Instagram account not found.');
      try {
        const updated = await deps.tokenRefresh.refreshAccount(account, { force: true });
        res.json({ account: accountDto(updated) });
      } catch (error) {
        throw metaErrorToAppError(error);
      }
    },
  );

  router.post(
    '/workspaces/:workspaceId/accounts/:accountId/disconnect',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const accountId = parseInput(AccountIdSchema, req.params.accountId, 'Invalid account id.');
      const account = await deps.store.getAccount(req.workspace!.id, accountId);
      if (!account) throw errors.notFound('Instagram account not found.');
      await deps.store.disconnectAccount(account.id);
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'instagram.account_disconnected',
        targetType: 'instagram_account',
        targetId: account.id,
      });
      res.status(204).end();
    },
  );

  router.delete(
    '/workspaces/:workspaceId/accounts/:accountId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const accountId = parseInput(AccountIdSchema, req.params.accountId, 'Invalid account id.');
      const body = parseInput(DeleteAccountSchema, req.body);
      const account = await deps.store.getAccount(req.workspace!.id, accountId);
      if (!account) throw errors.notFound('Instagram account not found.');
      if (body.confirmUsername !== account.username) {
        throw errors.validation('Type the exact Instagram username to confirm deletion.');
      }
      await deps.store.deleteAccount(account.id);
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'instagram.account_deleted',
        targetType: 'instagram_account',
        targetId: account.id,
      });
      res.status(204).end();
    },
  );

  return router;
}
