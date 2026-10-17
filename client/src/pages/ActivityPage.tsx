import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDateTime, relativeTime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { Select } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/States';
import { ReplyStatusBadge, RunStatusBadge } from '../components/StatusBadge';
import type { Run, RunDetail } from '../lib/types';

const PAGE_SIZE = 20;
const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
] as const;

function DeliveryLine({
  label,
  status,
  id,
  error,
}: {
  label: string;
  status: Run['publicReplyStatus'];
  id: string | null;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
        <ReplyStatusBadge status={status} />
      </div>
      {id ? (
        <p className="mt-2 break-all font-mono text-xs text-zinc-600">Instagram id: {id}</p>
      ) : null}
      {error ? (
        <p className="mt-2 break-words rounded bg-red-50 p-2 text-xs text-red-800">{error}</p>
      ) : null}
      {status === 'unknown' ? (
        <p className="mt-2 text-xs text-amber-700">
          The request may have reached Instagram, but no confirmation was recorded. The app does not
          retry automatically to avoid a duplicate message.
        </p>
      ) : null}
      {status === 'skipped' ? (
        <p className="mt-2 text-xs text-zinc-500">No request was made for this action.</p>
      ) : null}
    </div>
  );
}

function RunDetailPanel({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { api } = useAuth();
  const { workspace } = useWorkspace();
  const state = useAsync(
    () => api.getRun(workspace.id, runId as string),
    [api, workspace.id, runId],
    { enabled: Boolean(runId) },
  );

  return (
    <Modal
      open={Boolean(runId)}
      onOpenChange={(open) => !open && onClose()}
      title="Activity detail"
      description="What happened to one comment, with the exact API outcome."
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {state.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : state.error ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : state.data ? (
        <RunDetailContent detail={state.data} />
      ) : null}
    </Modal>
  );
}

function RunDetailContent({ detail }: { detail: RunDetail }) {
  const { run, events } = detail;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        {run.skipReason ? <Badge tone="muted">{run.skipReason.replace(/_/g, ' ')}</Badge> : null}
        <span className="text-xs text-zinc-400">{formatDateTime(run.createdAt)}</span>
      </div>

      <div className="rounded-lg bg-zinc-50 p-3">
        <p className="text-xs text-zinc-500">
          Comment by @{run.commenterUsername ?? 'unknown'} · {run.ruleName}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900">
          {run.commentText ?? 'No comment text stored.'}
        </p>
        {run.matchedKeyword ? (
          <p className="mt-2 text-xs text-zinc-500">
            Matched keyword: <Badge tone="brand">{run.matchedKeyword}</Badge>
          </p>
        ) : null}
        <p className="mt-2 break-all font-mono text-[11px] text-zinc-400">
          comment {run.commentId}
          {run.mediaId ? ` · media ${run.mediaId}` : ''}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DeliveryLine
          label="Public reply"
          status={run.publicReplyStatus}
          id={run.publicReplyId}
          error={run.publicReplyError}
        />
        <DeliveryLine
          label="Private reply"
          status={run.privateReplyStatus}
          id={run.privateReplyMessageId}
          error={run.privateReplyError}
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Processing log · {run.attempts} attempt{run.attempts === 1 ? '' : 's'}
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-zinc-500">No events recorded.</p>
        ) : (
          <ol className="space-y-2 border-l border-zinc-200 pl-4">
            {events.map((event) => (
              <li key={event.id} className="relative text-sm">
                <span
                  className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                    event.level === 'error'
                      ? 'bg-red-500'
                      : event.level === 'warn'
                        ? 'bg-amber-500'
                        : 'bg-zinc-300'
                  }`}
                />
                <p className="text-zinc-800">{event.message}</p>
                <p className="text-[11px] text-zinc-400">
                  {formatDateTime(event.createdAt)}
                  {event.code ? ` · ${event.code}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Alert tone="info" title="How to read this">
        “Sent” comes from an Instagram API response containing an id. “Unconfirmed” means the
        request may have reached Meta but no response confirmed it. Failed requests include the
        sanitized Meta error message. Tokens and secrets are never stored here.
      </Alert>
    </div>
  );
}

export function ActivityPage() {
  const { api, demoMode } = useAuth();
  const { workspace } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [accountId, setAccountId] = useState('');
  const [offset, setOffset] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const selectedRunId = params.get('run');

  const accountsState = useAsync(() => api.listAccounts(workspace.id), [api, workspace.id]);
  const state = useAsync(
    () =>
      api.listRuns(workspace.id, {
        limit: PAGE_SIZE,
        offset,
        ...(status ? { status } : {}),
        ...(accountId ? { accountId } : {}),
      }),
    [api, workspace.id, status, accountId, offset],
  );

  const reloadRuns = state.reload;
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => reloadRuns(), 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, reloadRuns]);

  function openRun(runId: string) {
    const next = new URLSearchParams(params);
    next.set('run', runId);
    setParams(next);
  }

  function closeRun() {
    const next = new URLSearchParams(params);
    next.delete('run');
    setParams(next, { replace: true });
  }

  const runs = state.data?.runs ?? [];
  const pagination = state.data?.pagination;
  const accounts = accountsState.data?.accounts ?? [];
  const filtersActive = Boolean(status) || Boolean(accountId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity & delivery logs"
        description="Every processed comment, including failures and unconfirmed sends."
        actions={
          <>
            <Button
              variant={autoRefresh ? 'secondary' : 'ghost'}
              onClick={() => setAutoRefresh((value) => !value)}
              aria-pressed={autoRefresh}
            >
              <Clock className="h-4 w-4" /> {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
            </Button>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </>
        }
      />

      {demoMode ? (
        <Alert tone="warning" title="Sample activity">
          These rows are generated in your browser and labelled “Sample”. No Instagram API calls
          were made. Statuses mirror the real delivery semantics so you can review the UI.
        </Alert>
      ) : null}

      {!demoMode ? (
        <Alert tone="info" title="Delivery is not guaranteed by the queue">
          A comment is acknowledged to Meta after it is stored. Replies are attempted asynchronously
          with bounded retries. Transient Meta errors are retried; permission, policy and
          invalid-request errors are not.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Processed comments"
          description={pagination ? `${pagination.total} total` : 'Loading…'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={accountId}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setOffset(0);
                }}
                aria-label="Filter by account"
                className="w-40"
              >
                <option value="">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    @{account.username}
                  </option>
                ))}
              </Select>
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setOffset(0);
                }}
                aria-label="Filter by status"
                className="w-36"
              >
                {STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        {state.loading && !state.data ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-14 w-full" />
            ))}
          </div>
        ) : state.error ? (
          <div className="p-5">
            <ErrorState message={state.error.message} onRetry={state.reload} />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filtersActive ? 'No activity matches these filters' : 'No activity yet'}
            description={
              filtersActive
                ? 'Clear the filters to see all processed comments.'
                : 'Comments appear here after a webhook is verified and processed. If nothing arrives, check that webhook delivery is confirmed on the Accounts page.'
            }
            action={
              filtersActive ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setStatus('');
                    setAccountId('');
                    setOffset(0);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" variant="secondary" asChild>
                  <Link to={`/w/${workspace.id}/accounts`}>Check connections</Link>
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => openRun(run.id)}
                  className="flex w-full flex-col gap-2 px-5 py-3.5 text-left hover:bg-zinc-50 sm:flex-row sm:items-center"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
                    {run.status === 'failed' ? (
                      <ShieldAlert className="h-4 w-4 text-red-500" />
                    ) : (
                      <MessageCircle className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900">
                        @{run.commenterUsername ?? 'unknown'}
                      </span>
                      {demoMode ? <Badge tone="muted">Sample</Badge> : null}
                      <RunStatusBadge status={run.status} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {run.commentText ?? 'No text'} · {run.ruleName}
                      {run.matchedKeyword ? ` · “${run.matchedKeyword}”` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1" title="Public reply">
                      <Send className="h-3.5 w-3.5" />
                      <ReplyStatusBadge status={run.publicReplyStatus} />
                    </span>
                    <span className="inline-flex items-center gap-1" title="Private reply">
                      <MessageCircle className="h-3.5 w-3.5" />
                      <ReplyStatusBadge status={run.privateReplyStatus} />
                    </span>
                    <span className="w-16 text-right text-zinc-400">
                      {relativeTime(run.createdAt)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-zinc-300" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pagination && pagination.total > 0 ? (
          <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
            <span>
              {pagination.offset + 1}–{Math.min(pagination.offset + runs.length, pagination.total)}{' '}
              of {pagination.total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pagination.offset === 0}
                onClick={() => setOffset(Math.max(0, pagination.offset - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!pagination.hasMore}
                onClick={() => setOffset(pagination.offset + PAGE_SIZE)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-500">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <p>
          Failed actions keep the sanitized Meta error. Tokens, app secrets and authorization codes
          are redacted before they reach logs or this page. “Unconfirmed” rows are not retried
          automatically; disconnect and reconnect if you believe the token is invalid.
        </p>
      </div>

      <RunDetailPanel runId={selectedRunId} onClose={closeRun} />
    </div>
  );
}
