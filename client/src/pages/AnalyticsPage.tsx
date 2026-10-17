import { useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CopyX,
  Info,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDate, formatNumber, percent } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { Select } from '../components/ui/Input';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/States';
import type { AnalyticsDailyPoint } from '../lib/types';

const RANGES = [7, 30, 90] as const;

function DailyChart({ daily }: { daily: AnalyticsDailyPoint[] }) {
  const max = Math.max(
    1,
    ...daily.map((point) =>
      Math.max(point.commentsReceived, point.publicRepliesSent, point.privateRepliesSent),
    ),
  );
  const labelEvery = daily.length > 45 ? 14 : daily.length > 14 ? 7 : 1;
  return (
    <div>
      <div className="flex h-48 items-end gap-px border-b border-zinc-200 pb-1">
        {daily.map((point) => (
          <div
            key={point.date}
            className="group relative flex h-full flex-1 items-end justify-center gap-px"
          >
            <span
              className="w-1/4 rounded-t-sm bg-zinc-300 group-hover:bg-zinc-500"
              style={{
                height: `${Math.max(point.commentsReceived === 0 ? 0 : 3, (point.commentsReceived / max) * 100)}%`,
              }}
              title={`${point.date}: ${point.commentsReceived} comments`}
            />
            <span
              className="w-1/4 rounded-t-sm bg-emerald-500 group-hover:bg-emerald-600"
              style={{
                height: `${Math.max(point.publicRepliesSent === 0 ? 0 : 3, (point.publicRepliesSent / max) * 100)}%`,
              }}
              title={`${point.date}: ${point.publicRepliesSent} public replies sent`}
            />
            <span
              className="w-1/4 rounded-t-sm bg-violet-500 group-hover:bg-violet-600"
              style={{
                height: `${Math.max(point.privateRepliesSent === 0 ? 0 : 3, (point.privateRepliesSent / max) * 100)}%`,
              }}
              title={`${point.date}: ${point.privateRepliesSent} private replies sent`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
        {daily.map((point, index) =>
          index % labelEvery === 0 || index === daily.length - 1 ? (
            <span
              key={point.date}
              className={index === daily.length - 1 ? 'text-right' : 'text-left'}
            >
              {formatDate(point.date)}
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-zinc-300" /> Comments received
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Public replies sent
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-violet-500" /> Private replies sent
        </span>
      </div>
    </div>
  );
}

function DeliveryRow({
  label,
  attempted,
  sent,
  icon: Icon,
}: {
  label: string;
  attempted: number;
  sent: number;
  icon: typeof Send;
}) {
  const rate = attempted === 0 ? 0 : percent(sent, attempted);
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
          <Icon className="h-4 w-4 text-zinc-400" /> {label}
        </p>
        <Badge
          tone={
            attempted === 0 ? 'muted' : rate >= 90 ? 'success' : rate >= 70 ? 'warning' : 'danger'
          }
        >
          {attempted === 0 ? 'No attempts' : `${rate}% confirmed`}
        </Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-zinc-500">Attempted</dt>
          <dd className="text-lg font-semibold text-zinc-900">{formatNumber(attempted)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Confirmed by Meta</dt>
          <dd className="text-lg font-semibold text-zinc-900">{formatNumber(sent)}</dd>
        </div>
      </dl>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const { api, demoMode } = useAuth();
  const { workspace } = useWorkspace();
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const state = useAsync(() => api.getAnalytics(workspace.id, range), [api, workspace.id, range]);

  const analytics = state.data?.analytics;
  const empty = analytics
    ? analytics.commentsReceived === 0 &&
      analytics.eventsProcessed === 0 &&
      analytics.publicRepliesAttempted === 0 &&
      analytics.privateRepliesAttempted === 0
    : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Aggregated from stored webhook events, runs and confirmed API responses."
        actions={
          <>
            <Select
              value={String(range)}
              onChange={(event) => setRange(Number(event.target.value) as (typeof RANGES)[number])}
              aria-label="Date range"
              className="w-32"
            >
              {RANGES.map((days) => (
                <option key={days} value={days}>
                  Last {days} days
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </>
        }
      />

      {demoMode ? (
        <Alert tone="warning" title="Sample analytics">
          These numbers come from sample data stored in this browser. They do not describe real
          Instagram deliveries.
        </Alert>
      ) : null}

      {state.loading && !analytics ? (
        <PageSkeleton />
      ) : state.error ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : analytics ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Comments received"
              value={formatNumber(analytics.commentsReceived)}
              hint={`Last ${range} days`}
              icon={Activity}
            />
            <StatCard
              label="Keyword matches"
              value={formatNumber(analytics.keywordMatches)}
              hint="Comments that triggered a rule"
              icon={BarChart3}
            />
            <StatCard
              label="Replies confirmed"
              value={formatNumber(analytics.publicRepliesSent + analytics.privateRepliesSent)}
              hint="Public + private, with an API id"
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard
              label="Failures"
              value={formatNumber(analytics.failures)}
              hint="Check Activity for details"
              icon={ShieldAlert}
              tone={analytics.failures > 0 ? 'danger' : 'default'}
            />
          </div>

          {empty ? (
            <Card>
              <EmptyState
                icon={BarChart3}
                title="No activity in this range"
                description="Analytics fill in after verified webhooks are processed. Widen the range or check that webhook delivery is confirmed."
              />
            </Card>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Daily volume"
                description="Comments received and confirmed replies per day."
              />
              <CardBody>
                {analytics.daily.length === 0 ? (
                  <p className="text-sm text-zinc-500">No daily data for this range.</p>
                ) : (
                  <DailyChart daily={analytics.daily} />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Funnel" description="How comments move through the pipeline." />
              <CardBody className="space-y-3">
                {[
                  {
                    label: 'Events processed',
                    value: analytics.eventsProcessed,
                    tone: 'bg-zinc-500',
                  },
                  { label: 'Keyword matches', value: analytics.keywordMatches, tone: 'bg-sky-500' },
                  {
                    label: 'Replies confirmed',
                    value: analytics.publicRepliesSent + analytics.privateRepliesSent,
                    tone: 'bg-emerald-500',
                  },
                ].map((step, index, list) => {
                  const top = list[0]!.value || 1;
                  return (
                    <div key={step.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-zinc-600">{step.label}</span>
                        <span className="font-medium text-zinc-900">
                          {formatNumber(step.value)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className={`h-full rounded-full ${step.tone}`}
                          style={{
                            width: `${Math.min(100, Math.max(index === 0 ? 100 : 0, (step.value / top) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="pt-1 text-[11px] leading-relaxed text-zinc-500">
                  Duplicates ignored: {formatNumber(analytics.duplicatesIgnored)} · Skipped:{' '}
                  {formatNumber(analytics.skipped)}. Duplicates are comments Meta retried or
                  delivered twice; only one run is created.
                </p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Reply delivery"
              description="Attempted requests compared with Instagram confirmations."
            />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <DeliveryRow
                label="Public replies"
                attempted={analytics.publicRepliesAttempted}
                sent={analytics.publicRepliesSent}
                icon={Send}
              />
              <DeliveryRow
                label="Private replies"
                attempted={analytics.privateRepliesAttempted}
                sent={analytics.privateRepliesSent}
                icon={MessageCircle}
              />
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardBody>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <MousePointerClick className="h-3.5 w-3.5" /> Resource clicks
                </p>
                <p className="mt-2 text-2xl font-semibold text-zinc-900">
                  {formatNumber(analytics.resourceClicks)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  First-party redirect hits. Not proof that anyone followed the account.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <CopyX className="h-3.5 w-3.5" /> Duplicates ignored
                </p>
                <p className="mt-2 text-2xl font-semibold text-zinc-900">
                  {formatNumber(analytics.duplicatesIgnored)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Repeated webhook deliveries deduplicated by account, field and comment id.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <XCircle className="h-3.5 w-3.5" /> Skipped & failed
                </p>
                <p className="mt-2 text-2xl font-semibold text-zinc-900">
                  {formatNumber(analytics.skipped)} / {formatNumber(analytics.failures)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Skipped means the rule did not act; failures are Meta errors after retries.
                </p>
              </CardBody>
            </Card>
          </div>
        </>
      ) : null}

      <Alert tone="info" title="Measurement limitations">
        Instagram does not expose follower status for arbitrary commenters, so this app cannot
        report follow conversions. Impressions, reach and profile visits are not available for
        comment actions and are not estimated. Counts come from webhook events and API confirmations
        only.
      </Alert>

      <p className="flex items-start gap-1 text-[11px] text-zinc-400">
        <Info className="mt-0.5 h-3 w-3 shrink-0" /> Aggregates use UTC days. The workspace timezone
        is display-only and does not change how Meta timestamps are stored.
      </p>
    </div>
  );
}
