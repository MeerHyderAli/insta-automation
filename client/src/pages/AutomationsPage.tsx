import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Copy,
  FileText,
  Layers,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input, Select } from '../components/ui/Input';
import { Alert } from '../components/ui/Alert';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/States';
import type { Account, MediaItem, Rule } from '../lib/types';

type StatusFilter = 'all' | 'enabled' | 'paused';

export function AutomationsPage() {
  const { api, demoMode } = useAuth();
  const { workspace, reload } = useWorkspace();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [accountFilter, setAccountFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);

  const state = useAsync(async () => {
    const [{ rules }, { accounts }] = await Promise.all([
      api.listRules(workspace.id),
      api.listAccounts(workspace.id),
    ]);
    const mediaLists = await Promise.allSettled(
      accounts.map((account) => api.listMedia(workspace.id, account.id)),
    );
    const mediaById = new Map<string, MediaItem>();
    for (const result of mediaLists) {
      if (result.status === 'fulfilled') {
        for (const item of result.value.media) mediaById.set(item.mediaId, item);
      }
    }
    return { rules, accounts, mediaById };
  }, [api, workspace.id]);

  const rules = state.data?.rules ?? [];
  const accounts = state.data?.accounts ?? [];
  const mediaById = state.data?.mediaById ?? new Map<string, MediaItem>();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rules
      .filter((rule) =>
        status === 'all' ? true : status === 'enabled' ? rule.enabled : !rule.enabled,
      )
      .filter((rule) => (accountFilter ? rule.accountId === accountFilter : true))
      .filter((rule) => {
        if (!needle) return true;
        return (
          rule.name.toLowerCase().includes(needle) ||
          rule.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.priority - b.priority);
  }, [rules, status, accountFilter, query]);

  async function toggle(rule: Rule) {
    setBusy(`toggle-${rule.id}`);
    try {
      await api.updateRule(workspace.id, rule.id, { enabled: !rule.enabled });
      toast.success(rule.enabled ? `“${rule.name}” paused.` : `“${rule.name}” enabled.`);
      state.reload();
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the automation.');
    } finally {
      setBusy(null);
    }
  }

  function accountFor(rule: Rule): Account | undefined {
    return accounts.find((account) => account.id === rule.accountId);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Keyword rules that answer comments and deliver resources."
        actions={
          <Button asChild>
            <Link to="new">
              <Plus className="h-4 w-4" /> New automation
            </Link>
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <Alert tone="warning" title="Connect an Instagram account first">
          Automations need a connected Business or Creator account.{' '}
          <Link to="../accounts" className="underline">
            Connect Instagram
          </Link>
          .
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Your rules"
          description={`${rules.filter((rule) => rule.enabled).length} enabled · ${rules.length} total`}
          actions={
            <Button variant="secondary" size="sm" onClick={state.reload}>
              Refresh
            </Button>
          }
        />
        <div className="flex flex-col gap-2 border-b border-zinc-100 px-5 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              className="pl-9"
              placeholder="Search by name or keyword"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search automations"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="sm:w-36"
          >
            <option value="all">All states</option>
            <option value="enabled">Enabled</option>
            <option value="paused">Paused</option>
          </Select>
          <Select
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            aria-label="Filter by account"
            className="sm:w-48"
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.username}
              </option>
            ))}
          </Select>
        </div>

        {state.loading ? (
          <PageSkeleton />
        ) : state.error ? (
          <div className="p-5">
            <ErrorState message={state.error.message} onRetry={state.reload} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={rules.length === 0 ? Sparkles : Search}
            title={rules.length === 0 ? 'No automations yet' : 'No automations match those filters'}
            description={
              rules.length === 0
                ? 'Pick a post or all posts, choose keywords such as API or GUIDE, and write the replies.'
                : 'Try clearing the search or switching the status filter.'
            }
            action={
              rules.length === 0 ? (
                <Button asChild size="sm">
                  <Link to="new">Create your first automation</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                    setAccountFilter('');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filtered.map((rule) => {
              const account = accountFor(rule);
              const media = rule.mediaId ? mediaById.get(rule.mediaId) : null;
              return (
                <li key={rule.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={rule.id}
                          className="truncate text-sm font-semibold text-zinc-900 hover:underline"
                        >
                          {rule.name}
                        </Link>
                        <Badge tone={rule.enabled ? 'success' : 'muted'}>
                          {rule.enabled ? 'Enabled' : 'Paused'}
                        </Badge>
                        {demoMode ? <Badge tone="muted">Sample</Badge> : null}
                        {rule.priority !== 100 ? (
                          <Badge tone="neutral">Priority {rule.priority}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {rule.keywords.map((keyword) => (
                          <span
                            key={keyword}
                            className="rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 font-mono text-[11px] text-orange-800"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <Layers className="h-3.5 w-3.5" />
                          {media
                            ? media.caption?.slice(0, 48) || 'Selected post'
                            : 'All posts & Reels'}
                        </span>
                        <span>@{account?.username ?? 'unknown account'}</span>
                        <span>
                          {rule.publicReplyTemplate ? 'Public reply' : 'No public reply'}
                          {' · '}
                          {rule.privateReplyTemplate ? 'Private reply' : 'No private reply'}
                        </span>
                        <span>
                          {rule.followGate === 'instruction'
                            ? 'Follow instruction'
                            : 'No follow gate'}
                        </span>
                        <span>Updated {formatDateTime(rule.updatedAt)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={rule.enabled ? 'secondary' : 'primary'}
                        loading={busy === `toggle-${rule.id}`}
                        onClick={() => toggle(rule)}
                      >
                        {rule.enabled ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        {rule.enabled ? 'Pause' : 'Enable'}
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={rule.id}>
                          Edit <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => setDeleteTarget(rule)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete {rule.name}</span>
                      </Button>
                    </div>
                  </div>
                  {rule.publicReplyTemplate ? (
                    <p className="mt-2 line-clamp-2 rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600">
                      <FileText className="mr-1 inline h-3.5 w-3.5 text-zinc-400" />
                      {rule.publicReplyTemplate}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-zinc-100 p-2 text-zinc-600">
              <Zap className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-900">Priority decides ties</p>
              <p className="text-xs text-zinc-500">
                If one comment matches several enabled rules, the media-specific rule wins, then the
                lowest priority number, then the oldest rule. The same comment is never answered
                twice.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link to="new">
              <Copy className="h-4 w-4" /> Build a rule
            </Link>
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.name ?? ''}”?`}
        description="The rule is removed. Existing activity history stays, but new comments will not match it."
        confirmLabel="Delete automation"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.deleteRule(workspace.id, deleteTarget.id);
          toast.success('Automation deleted.');
          setDeleteTarget(null);
          state.reload();
          reload();
        }}
      />
    </div>
  );
}
