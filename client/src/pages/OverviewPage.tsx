import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Camera,
  Circle,
  MousePointerClick,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatNumber, relativeTime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/States';
import { AccountStatusBadge, RunStatusBadge } from '../components/StatusBadge';

export function OverviewPage() {
  const { api, config, demoMode } = useAuth();
  const { workspace, counts, reload } = useWorkspace();

  const state = useAsync(async () => {
    const [analytics, accounts, rules, runs] = await Promise.all([
      api.getAnalytics(workspace.id, 30),
      api.listAccounts(workspace.id),
      api.listRules(workspace.id),
      api.listRuns(workspace.id, { limit: 6 }),
    ]);
    return {
      analytics: analytics.analytics,
      accounts: accounts.accounts,
      rules: rules.rules,
      runs: runs.runs,
    };
  }, [api, workspace.id]);

  if (state.loading) return <PageSkeleton />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return null;

  const { analytics, accounts, rules, runs } = state.data;
  const account = accounts.find((item) => item.status === 'connected') ?? accounts[0] ?? null;
  const enabledRules = rules.filter((rule) => rule.enabled);
  const confirmedReplies = analytics.publicRepliesSent + analytics.privateRepliesSent;
  const steps = [
    {
      label: 'Connect a professional Instagram account',
      done: accounts.length > 0,
      to: 'accounts',
      hint: 'Business or Creator account, public, approved for comment access.',
    },
    {
      label: 'Sync posts and Reels',
      done: accounts.some((item) => item.webhookSubscribed),
      to: 'accounts',
      hint: 'Sync media so automations can target a specific post.',
    },
    {
      label: 'Create a keyword automation',
      done: rules.length > 0,
      to: 'automations/new',
      hint: 'Pick keywords, write replies and attach a resource.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={workspace.name}
        title="Overview"
        description="What your comment automations did over the last 30 days."
        actions={
          <>
            <Button variant="secondary" onClick={state.reload}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button asChild>
              <Link to="automations/new">
                <Zap className="h-4 w-4" /> New automation
              </Link>
            </Button>
          </>
        }
      />

      {!demoMode && config && !config.metaConfigured ? (
        <Alert tone="warning" title="Instagram is not configured on this server">
          OAuth, webhooks and replies will fail closed with a “not configured” error. Add the Meta
          app credentials and restart the API. See README → Meta setup.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Comments received"
          value={formatNumber(analytics.commentsReceived)}
          hint="Deduplicated webhook events"
          icon={Activity}
        />
        <StatCard
          label="Replies confirmed"
          value={formatNumber(confirmedReplies)}
          hint={`${analytics.publicRepliesSent} public · ${analytics.privateRepliesSent} private`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Failures"
          value={formatNumber(analytics.failures)}
          hint="Check Activity for error details"
          icon={ShieldAlert}
          tone={analytics.failures > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Resource clicks"
          value={formatNumber(analytics.resourceClicks)}
          hint="Clicks are not follow proof"
          icon={MousePointerClick}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent activity"
            description="Each row is one comment and the actions taken for it."
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="activity">
                  View all <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            }
          />
          {runs.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="When a comment matches an enabled automation, it will appear here with the exact delivery result."
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link to="automations">Review automations</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    to={`activity?run=${run.id}`}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-zinc-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-900">
                        <span className="font-medium">@{run.commenterUsername ?? 'unknown'}</span>{' '}
                        <span className="text-zinc-500">{run.commentText}</span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {run.ruleName}
                        {run.matchedKeyword ? ` · matched “${run.matchedKeyword}”` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {demoMode ? <Badge tone="muted">Sample</Badge> : null}
                      <RunStatusBadge status={run.status} />
                      <span className="w-16 text-right text-xs text-zinc-400">
                        {relativeTime(run.createdAt)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Connected account"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="accounts">Manage</Link>
                </Button>
              }
            />
            {account ? (
              <CardBody className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">
                    {account.username.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      @{account.username}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {account.accountType ?? 'Professional account'}
                    </p>
                  </div>
                  <AccountStatusBadge status={account.status} />
                </div>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Token</dt>
                    <dd
                      className={
                        account.tokenExpiresInDays < 7
                          ? 'font-medium text-amber-700'
                          : 'text-zinc-700'
                      }
                    >
                      {account.tokenExpiresInDays} days left
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Webhook delivery</dt>
                    <dd
                      className={
                        account.webhookSubscribed
                          ? 'text-emerald-700'
                          : 'font-medium text-amber-700'
                      }
                    >
                      {account.webhookSubscribed ? 'Confirmed by Meta' : 'Not confirmed'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Permissions</dt>
                    <dd className={account.permissionsOk ? 'text-emerald-700' : 'text-red-700'}>
                      {account.permissionsOk ? 'Complete' : 'Missing scopes'}
                    </dd>
                  </div>
                </dl>
                {!account.webhookSubscribed ? (
                  <Alert tone="warning">
                    Webhooks are not confirmed. Comments will not arrive until Meta confirms the
                    subscription.
                  </Alert>
                ) : null}
              </CardBody>
            ) : (
              <EmptyState
                icon={Camera}
                title="No Instagram account"
                description="Connect a Business or Creator account to start receiving comment webhooks."
                action={
                  <Button asChild size="sm">
                    <Link to="accounts">Connect Instagram</Link>
                  </Button>
                }
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Getting started"
              actions={<Badge tone="neutral">{steps.filter((step) => step.done).length}/3</Badge>}
            />
            <CardBody className="space-y-3">
              {steps.map((step) => (
                <Link
                  key={step.label}
                  to={step.to}
                  className="flex items-start gap-3 rounded-lg p-1.5 hover:bg-zinc-50"
                >
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" />
                  )}
                  <span className="min-w-0">
                    <span
                      className={`block text-sm ${step.done ? 'text-zinc-500 line-through' : 'font-medium text-zinc-900'}`}
                    >
                      {step.label}
                    </span>
                    <span className="block text-xs text-zinc-500">{step.hint}</span>
                  </span>
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Active automations"
            description={`${enabledRules.length} enabled of ${rules.length}`}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="automations">
                  Manage <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            }
          />
          {rules.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No automations yet"
              description="Create a keyword automation to reply to comments and deliver a resource."
              action={
                <Button asChild size="sm">
                  <Link to="automations/new">Create automation</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {rules.slice(0, 4).map((rule) => (
                <li key={rule.id}>
                  <Link
                    to={`automations/${rule.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50"
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${rule.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400'}`}
                    >
                      <Zap className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900">
                        {rule.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {rule.keywords.join(' · ')}
                      </span>
                    </span>
                    <Badge tone={rule.enabled ? 'success' : 'muted'}>
                      {rule.enabled ? 'On' : 'Paused'}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Workspace at a glance" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg bg-zinc-50 p-3">
                <dt className="text-xs text-zinc-500">Accounts</dt>
                <dd className="mt-1 text-xl font-semibold">{counts.accounts}</dd>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3">
                <dt className="text-xs text-zinc-500">Automations</dt>
                <dd className="mt-1 text-xl font-semibold">{counts.rules}</dd>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3">
                <dt className="text-xs text-zinc-500">Resources</dt>
                <dd className="mt-1 text-xl font-semibold">{counts.resources}</dd>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3">
                <dt className="text-xs text-zinc-500">Members</dt>
                <dd className="mt-1 text-xl font-semibold">{counts.members}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" asChild>
                <Link to="analytics">
                  <BarChart3 className="h-4 w-4" /> Analytics
                </Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link to="usage">
                  <BookOpen className="h-4 w-4" /> Usage & limits
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={reload}>
                Refresh counts
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Alert tone="info" title="How delivery states work">
        “Sent” means Instagram returned an ID for that action. “Unconfirmed” means the request
        failed before the outcome was known and the app will not resend automatically. “Failed”
        means Instagram rejected it. This dashboard never marks a message as delivered without an
        API confirmation.
      </Alert>

      {demoMode ? (
        <p className="text-center text-xs text-zinc-400">
          Demo data is generated in your browser and stored locally. It is not real Instagram
          activity.{' '}
          <Link to="settings" className="underline">
            Reset or review data handling
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
