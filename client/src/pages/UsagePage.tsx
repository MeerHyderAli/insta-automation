import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Gauge,
  Info,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDate, formatNumber } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { ErrorState, PageSkeleton } from '../components/ui/States';

const METRIC_LABELS: Record<string, { label: string; hint: string; limitKey?: string }> = {
  comments_processed: {
    label: 'Comments processed',
    hint: 'One per comment that matched an automation, counted on first processing.',
    limitKey: 'comments_month',
  },
  private_replies_month: {
    label: 'Private replies',
    hint: 'Reserved atomically before each send and released when the send is retried.',
    limitKey: 'private_replies_month',
  },
  events_processed: {
    label: 'Webhook events processed',
    hint: 'Includes comments that matched no rule.',
  },
  keyword_matches: {
    label: 'Keyword matches',
    hint: 'Comments where at least one keyword matched.',
  },
  public_replies_attempted: {
    label: 'Public replies attempted',
    hint: 'Requests sent to Instagram.',
  },
  public_replies_sent: { label: 'Public replies confirmed', hint: 'Instagram returned an id.' },
  private_replies_attempted: {
    label: 'Private replies attempted',
    hint: 'Requests sent to Instagram.',
  },
  private_replies_sent: {
    label: 'Private replies confirmed',
    hint: 'Instagram returned a message id.',
  },
};

const COUNT_ROWS = [
  { key: 'accounts', label: 'Connected accounts', limitKey: 'accounts', icon: Gauge },
  { key: 'rules', label: 'Automations', limitKey: 'rules', icon: Send },
  { key: 'resources', label: 'Resources', limitKey: 'resources', icon: Lock },
  { key: 'members', label: 'Members', limitKey: 'members', icon: Users },
] as const;

function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function UsagePage() {
  const { api, demoMode } = useAuth();
  const { workspace } = useWorkspace();
  const state = useAsync(() => api.getUsage(workspace.id), [api, workspace.id]);

  const usage = state.data;
  const plan = usage?.plan;
  const metrics = usage?.metrics ?? {};
  const counts = usage?.counts;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage & plan limits"
        description="Monthly allowances enforced by the API before any Instagram request."
        actions={
          <Button variant="secondary" onClick={state.reload} loading={state.loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {demoMode ? (
        <Alert tone="warning" title="Demo plan">
          These limits come from sample data. Real workspaces start on the Free plan and are moved
          manually — no payment provider is connected.
        </Alert>
      ) : null}

      {state.loading && !usage ? (
        <PageSkeleton />
      ) : state.error ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : usage && plan ? (
        <>
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-zinc-900">{plan.name} plan</h2>
                  <Badge tone="brand">Current plan</Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {plan.description ?? 'Workspace plan.'}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Usage period started {formatDate(usage.periodStart)} · resets monthly (UTC)
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <a href="mailto:support@example.com?subject=Plan%20upgrade">
                    <ArrowUpRight className="h-4 w-4" /> Request upgrade
                  </a>
                </Button>
                <Button variant="ghost" asChild>
                  <Link to={`/w/${workspace.id}/settings`}>
                    <Users className="h-4 w-4" /> Manage workspace
                  </Link>
                </Button>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(METRIC_LABELS)
              .filter(([key]) => METRIC_LABELS[key]?.limitKey)
              .map(([key, meta]) => {
                const used = metrics[key] ?? 0;
                const limit = meta.limitKey ? (plan.limits[meta.limitKey] ?? 0) : 0;
                return (
                  <Card key={key}>
                    <CardBody>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-zinc-900">{meta.label}</p>
                          <p className="mt-0.5 text-xs text-zinc-500">{meta.hint}</p>
                        </div>
                        <Badge
                          tone={
                            used >= limit
                              ? 'danger'
                              : used / Math.max(1, limit) >= 0.8
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {formatNumber(used)} / {formatNumber(limit)}
                        </Badge>
                      </div>
                      <Meter used={used} limit={limit} />
                      <p className="mt-2 text-[11px] text-zinc-400">
                        {used >= limit
                          ? 'Limit reached. New actions are blocked until the next period.'
                          : `${formatNumber(Math.max(0, limit - used))} remaining this month`}
                      </p>
                    </CardBody>
                  </Card>
                );
              })}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Workspace counts"
                description="Checked before creating a record."
              />
              <CardBody className="space-y-4">
                {COUNT_ROWS.map((row) => {
                  const used = counts ? counts[row.key] : 0;
                  const limit = plan.limits[row.limitKey] ?? 0;
                  return (
                    <div key={row.key}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-zinc-700">
                          <row.icon className="h-3.5 w-3.5 text-zinc-400" />
                          {row.label}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {formatNumber(used)} / {formatNumber(limit)}
                        </span>
                      </div>
                      <Meter used={used} limit={limit} />
                    </div>
                  );
                })}
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Limits are enforced server-side on create. Deleting records frees the slot
                  immediately. Plan changes are manual in this version.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Instagram's own limits"
                description="Enforced in addition to workspace quotas."
              />
              <CardBody className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <Send className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                  <div>
                    <p className="font-medium text-zinc-900">
                      {formatNumber(usage.metaLimits.privateRepliesPerHour)} private replies per
                      hour
                    </p>
                    <p className="text-xs text-zinc-500">
                      Per account. The app enforces a lower local budget of 700/hour plus a database
                      count, because Meta's exact accounting is opaque.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                  <div>
                    <p className="font-medium text-zinc-900">
                      {usage.metaLimits.privateReplyWindowDays}-day private-reply window
                    </p>
                    <p className="text-xs text-zinc-500">
                      One private reply per comment, only after the comment, inside the window. Live
                      comments are not automated.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                  <div>
                    <p className="font-medium text-zinc-900">Message length</p>
                    <p className="text-xs text-zinc-500">
                      App limits: public replies {formatNumber(2000)} characters, private replies{' '}
                      {formatNumber(900)}. Instagram accepts up to{' '}
                      {formatNumber(usage.metaLimits.publicReplyMaxLength)} /{' '}
                      {formatNumber(usage.metaLimits.privateReplyMaxLength)}.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                  <div>
                    <p className="font-medium text-zinc-900">Non-messaging API calls</p>
                    <p className="text-xs text-zinc-500">
                      Meta's formula is 4,800 × impressions per rolling 24 hours per app+user. This
                      app keeps media sync to a bounded number of pages and never polls comments.
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="All recorded metrics this period"
              description="Raw counters behind analytics."
            />
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <th className="py-2 pr-4 font-medium">Metric</th>
                      <th className="py-2 pr-4 font-medium">Description</th>
                      <th className="py-2 text-right font-medium">This month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {Object.entries(METRIC_LABELS).map(([key, meta]) => (
                      <tr key={key}>
                        <td className="py-2 pr-4 font-mono text-xs text-zinc-700">{key}</td>
                        <td className="py-2 pr-4 text-xs text-zinc-500">{meta.hint}</td>
                        <td className="py-2 text-right font-medium tabular-nums">
                          {formatNumber(metrics[key] ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notes & caveats" />
            <CardBody>
              <ul className="space-y-2 text-sm text-zinc-600">
                {usage.notes.map((note) => (
                  <li key={note} className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    {note}
                  </li>
                ))}
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  Quotas are enforced with a single SQL statement, so concurrent webhook workers
                  cannot exceed a monthly limit.
                </li>
                <li className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                  This version has no billing integration. No payment details are collected.
                </li>
              </ul>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
