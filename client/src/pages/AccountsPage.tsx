import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Camera,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDate, relativeTime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Field, Input } from '../components/ui/Input';
import { EmptyState, ErrorState, PageSkeleton, Skeleton } from '../components/ui/States';
import { AccountStatusBadge } from '../components/StatusBadge';
import type { Account, MediaItem } from '../lib/types';

const REASON_MESSAGES: Record<string, string> = {
  access_denied: 'Instagram access was cancelled. No account was connected.',
  state_invalid:
    'The OAuth state was invalid, expired or already used. Start the connection again.',
  state_expired: 'The OAuth state expired. Start the connection again.',
  not_configured: 'Instagram is not configured on the server.',
  missing_code: 'Instagram did not return an authorization code.',
  permission_missing: 'The account did not grant comment-management permission.',
  token_exchange_failed: 'Instagram rejected the token exchange. Check the Meta app configuration.',
  callback_failed:
    'The connection could not be completed. Check the server logs for the error code.',
};

function MediaGrid({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const { api } = useAuth();
  const { workspace } = useWorkspace();
  const state = useAsync(
    () => api.listMedia(workspace.id, accountId),
    [api, workspace.id, accountId, refreshKey],
  );

  if (state.loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="rounded-lg border border-zinc-200 p-2">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>
    );
  }
  if (state.error) {
    return <Alert tone="error">Could not load synced media: {state.error.message}</Alert>;
  }
  const media = state.data?.media ?? [];
  if (media.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="No synced media"
        description="Sync posts and Reels to target a specific piece of content. If you leave an automation on all posts, syncing is optional."
        action={
          <Button size="sm" variant="secondary" onClick={state.reload}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {media.map((item) => (
        <MediaCard key={item.id} media={item} />
      ))}
    </div>
  );
}

function MediaCard({ media }: { media: MediaItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="relative aspect-square w-full bg-gradient-to-br from-zinc-100 to-zinc-200">
        {media.thumbnailUrl && !broken ? (
          <img
            src={media.thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <ImageIcon className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        <span className="absolute left-2 top-2">
          <Badge tone="neutral">{media.mediaProductType ?? media.mediaType ?? 'POST'}</Badge>
        </span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 min-h-8 text-xs text-zinc-600">
          {media.caption ?? 'No caption'}
        </p>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <span>{media.publishedAt ? formatDate(media.publishedAt) : 'Unknown date'}</span>
          {media.permalink ? (
            <a
              href={media.permalink}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 hover:text-zinc-700"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AccountsPage() {
  const { api, demoMode, config } = useAuth();
  const { workspace, reload } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [mediaRefresh, setMediaRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [confirmUsername, setConfirmUsername] = useState('');

  const state = useAsync(() => api.listAccounts(workspace.id), [api, workspace.id]);
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const instagramStatus = params.get('instagram');
  const reason = params.get('reason');
  const webhookStatus = params.get('webhook');

  function clearQuery() {
    const next = new URLSearchParams(params);
    for (const key of ['instagram', 'reason', 'webhook', 'username']) next.delete(key);
    setParams(next, { replace: true });
  }

  async function runAction(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      state.reload();
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    if (demoMode) {
      setConnectOpen(true);
      return;
    }
    setBusy('connect');
    try {
      const result = await api.startInstagramOAuth(workspace.id);
      window.location.assign(result.authorizeUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start Instagram OAuth.');
      setBusy(null);
    }
  }

  if (state.loading) return <PageSkeleton />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  const accounts = state.data?.accounts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connected accounts"
        description="Instagram professional accounts connected with the official Instagram Login flow."
        actions={
          <Button onClick={connect} loading={busy === 'connect'} disabled={!canManage}>
            <Camera className="h-4 w-4" /> Connect Instagram
          </Button>
        }
      />

      {instagramStatus ? (
        <Alert
          tone={
            instagramStatus === 'connected'
              ? webhookStatus === 'failed'
                ? 'warning'
                : 'success'
              : 'error'
          }
          title={
            instagramStatus === 'connected' ? 'Instagram account connected' : 'Connection failed'
          }
          actions={
            <Button variant="ghost" size="sm" onClick={clearQuery}>
              Dismiss
            </Button>
          }
        >
          {instagramStatus === 'connected'
            ? `@${params.get('username') ?? 'account'} is connected. ${
                webhookStatus === 'failed'
                  ? 'Webhook delivery was not confirmed by Meta — use “Subscribe webhooks” below and check the app configuration.'
                  : 'Webhook delivery was confirmed by Meta.'
              }`
            : (REASON_MESSAGES[reason ?? ''] ??
              'The connection could not be completed. Check the server logs for the error code.')}
        </Alert>
      ) : null}

      {!canManage ? (
        <Alert tone="info">
          You have read-only access to connections. Owners and admins can connect, refresh or
          disconnect accounts.
        </Alert>
      ) : null}

      {demoMode ? (
        <Alert tone="warning" title="Demo mode — connecting is disabled">
          A real connection needs a Meta app, Advanced Access and the API server. Demo mode does not
          simulate OAuth or add fake accounts. The existing account and its activity are clearly
          labelled sample data.
        </Alert>
      ) : null}

      <Alert tone="info" title="Requirements for comment automation">
        Use a Business or Creator account (not personal), keep the account public, and complete Meta
        App Review + Business Verification for Advanced Access. The app subscribes to the{' '}
        <code className="font-mono text-xs">comments</code> webhook field; Live comments are
        acknowledged but not automated because the private-reply window is limited to the broadcast.
      </Alert>

      {!config?.metaConfigured && !demoMode ? (
        <Alert tone="warning" title="Meta app credentials are missing">
          Add META_APP_ID, META_APP_SECRET, META_REDIRECT_URI and META_WEBHOOK_VERIFY_TOKEN to the
          server environment. The connect button will keep failing until they are present.
        </Alert>
      ) : null}

      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Camera}
            title="No Instagram accounts connected"
            description="Connect a professional account to receive comment webhooks and reply. The account must be public and owned by the person completing OAuth."
            action={
              <Button onClick={connect} disabled={!canManage}>
                <Camera className="h-4 w-4" /> Connect Instagram
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    @{account.username}
                    <AccountStatusBadge status={account.status} />
                    {demoMode ? <Badge tone="muted">Sample account</Badge> : null}
                  </span>
                }
                description={`${account.accountType ?? 'Professional account'} · connected ${formatDate(account.createdAt)}`}
                actions={
                  canManage ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === `sync-${account.id}`}
                        disabled={account.status !== 'connected'}
                        onClick={() =>
                          runAction(
                            `sync-${account.id}`,
                            async () => {
                              const result = await api.syncMedia(workspace.id, account.id);
                              setMediaRefresh((value) => value + 1);
                              return result;
                            },
                            'Media synced.',
                          )
                        }
                      >
                        <RefreshCw className="h-4 w-4" /> Sync media
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === `webhook-${account.id}`}
                        disabled={account.status === 'disconnected'}
                        onClick={() =>
                          runAction(
                            `webhook-${account.id}`,
                            () => api.subscribeWebhook(workspace.id, account.id),
                            'Webhook subscription confirmed.',
                          )
                        }
                      >
                        <Link2 className="h-4 w-4" /> Subscribe webhooks
                      </Button>
                    </>
                  ) : null
                }
              />
              <CardBody className="space-y-5">
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-xs text-zinc-500">Token expires</p>
                    <p
                      className={`mt-1 font-medium ${account.tokenExpiresInDays < 7 ? 'text-amber-700' : 'text-zinc-900'}`}
                    >
                      {formatDate(account.tokenExpiresAt)}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {account.tokenExpiresInDays} days remaining
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-xs text-zinc-500">Webhook delivery</p>
                    <p
                      className={`mt-1 flex items-center gap-1 font-medium ${account.webhookSubscribed ? 'text-emerald-700' : 'text-amber-700'}`}
                    >
                      {account.webhookSubscribed ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      {account.webhookSubscribed ? 'Confirmed by Meta' : 'Not confirmed'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {account.webhookSubscribedAt
                        ? relativeTime(account.webhookSubscribedAt)
                        : 'Subscribe to receive comments'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-xs text-zinc-500">Permissions</p>
                    <p
                      className={`mt-1 flex items-center gap-1 font-medium ${account.permissionsOk ? 'text-emerald-700' : 'text-red-700'}`}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {account.permissionsOk ? 'Complete' : 'Missing'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {account.permissionsOk
                        ? 'Comment management granted'
                        : account.missingPermissions.join(', ')}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-xs text-zinc-500">Instagram account id</p>
                    <p className="mt-1 truncate font-mono text-xs text-zinc-700">
                      {account.igUserId}
                    </p>
                    <p className="text-xs text-zinc-400">Webhook entry id</p>
                  </div>
                </div>

                {account.lastErrorCode ? (
                  <Alert tone="warning" title="Last Meta error">
                    <code className="font-mono text-xs">{account.lastErrorCode}</code>
                    {account.lastErrorAt ? ` · ${relativeTime(account.lastErrorAt)}` : ''}
                  </Alert>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === `refresh-${account.id}`}
                      disabled={account.status === 'disconnected'}
                      onClick={() =>
                        runAction(
                          `refresh-${account.id}`,
                          () => api.refreshToken(workspace.id, account.id),
                          'Token refreshed.',
                        )
                      }
                    >
                      <RefreshCw className="h-4 w-4" /> Refresh token
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" asChild>
                    <Link to={`/w/${workspace.id}/automations/new?accountId=${account.id}`}>
                      <Zap className="h-4 w-4" /> New automation
                    </Link>
                  </Button>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={account.status === 'disconnected'}
                      onClick={() => setDisconnectTarget(account)}
                    >
                      <Unplug className="h-4 w-4" /> Disconnect
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => setDeleteTarget(account)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete data
                    </Button>
                  ) : null}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-900">Synced posts & Reels</h3>
                    <span className="text-xs text-zinc-400">Used to scope automations</span>
                  </div>
                  <MediaGrid accountId={account.id} refreshKey={mediaRefresh} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={connectOpen}
        onOpenChange={setConnectOpen}
        title="Connecting Instagram is not available in demo mode"
        size="md"
        footer={<Button onClick={() => setConnectOpen(false)}>Close</Button>}
      >
        <div className="space-y-3 text-sm text-zinc-600">
          <p>
            The real flow redirects the account owner to{' '}
            <code className="font-mono text-xs">instagram.com/oauth/authorize</code>, then exchanges
            the authorization code on the server. That requires Meta app credentials, an approved
            app and Supabase authentication.
          </p>
          <Alert tone="warning">
            Demo mode will not simulate a connection or mark an account as real. The seeded account
            exists only to demonstrate the dashboard.
          </Alert>
          <p>
            See <strong>README → Meta setup</strong> and{' '}
            <code className="font-mono text-xs">docs/META_API_FEASIBILITY.md</code> for the exact
            prerequisites.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(disconnectTarget)}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title={`Disconnect @${disconnectTarget?.username ?? ''}?`}
        description="The stored token is cleared, webhook events stop being processed, and every automation for this account is disabled. Activity history is kept."
        confirmLabel="Disconnect account"
        onConfirm={async () => {
          if (!disconnectTarget) return;
          await api.disconnectAccount(workspace.id, disconnectTarget.id);
          toast.success('Account disconnected. Automations were disabled.');
          setDisconnectTarget(null);
          state.reload();
          reload();
        }}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setConfirmUsername('');
          }
        }}
        title="Delete Instagram account data"
        description="This permanently removes the account, its synced media, automations and activity from this workspace. It cannot be undone."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmUsername !== deleteTarget?.username}
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await api.deleteAccount(workspace.id, deleteTarget.id, confirmUsername);
                  toast.success('Account data deleted.');
                  setDeleteTarget(null);
                  setConfirmUsername('');
                  state.reload();
                  reload();
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : 'Could not delete the account.',
                  );
                }
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <Field
          label={`Type @${deleteTarget?.username ?? ''} to confirm`}
          htmlFor="confirm-username"
        >
          <Input
            id="confirm-username"
            value={confirmUsername}
            onChange={(event) => setConfirmUsername(event.target.value)}
            autoComplete="off"
            placeholder={deleteTarget?.username}
          />
        </Field>
      </Modal>
    </div>
  );
}
