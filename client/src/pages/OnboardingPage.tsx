import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../lib/useAsync';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Field, Input, Select } from '../components/ui/Input';
import { Alert } from '../components/ui/Alert';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { PageHeader } from '../components/PageHeader';

const timezones = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

export function OnboardingPage() {
  const { api, demoMode } = useAuth();
  const navigate = useNavigate();
  const state = useAsync(() => api.getMe(), [api]);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.loading) return <LoadingState label="Loading workspaces…" />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  const me = state.data;

  if (me && me.workspaces.length > 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Your workspaces"
          description="Pick up where you left off, or create another workspace."
        />
        <Card>
          <CardBody className="space-y-2">
            {me.workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                to={`/w/${workspace.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50"
              >
                <span>
                  <span className="block font-medium text-zinc-900">{workspace.name}</span>
                  <span className="text-xs capitalize text-zinc-500">
                    {workspace.role} · {workspace.planName}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-zinc-400" />
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-4 text-sm font-semibold text-zinc-900">Create a workspace</h2>
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  const result = await api.createWorkspace(name.trim(), timezone);
                  navigate(`/w/${result.workspace.id}`);
                } catch (caught) {
                  setError(
                    caught instanceof Error ? caught.message : 'Could not create the workspace.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Workspace name" htmlFor="workspace-name">
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acme Studio"
                  required
                  maxLength={80}
                />
              </Field>
              <Field label="Timezone" htmlFor="workspace-timezone" hint="Used for reporting dates.">
                <Select
                  id="workspace-timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
              {error ? <Alert tone="error">{error}</Alert> : null}
              <Button type="submit" loading={busy}>
                <Plus className="h-4 w-4" /> Create workspace
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <PageHeader
        title="Create your first workspace"
        description="A workspace groups your Instagram accounts, automations, resources and usage."
      />
      <Card className="mt-6">
        <CardBody>
          {demoMode ? (
            <Alert tone="warning" title="Demo limitation">
              Demo mode ships with one sample workspace and cannot create another. Configure
              Supabase to create real workspaces.
            </Alert>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  const result = await api.createWorkspace(name.trim(), timezone);
                  navigate(`/w/${result.workspace.id}`);
                } catch (caught) {
                  setError(
                    caught instanceof Error ? caught.message : 'Could not create the workspace.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Workspace name" htmlFor="ws-name">
                <Input
                  id="ws-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acme Studio"
                  required
                  maxLength={80}
                />
              </Field>
              <Field label="Timezone" htmlFor="ws-timezone">
                <Select
                  id="ws-timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
              {error ? <Alert tone="error">{error}</Alert> : null}
              <Button type="submit" loading={busy}>
                Create workspace
              </Button>
            </form>
          )}
          {demoMode ? (
            <div className="mt-4">
              <Button asChild>
                <Link to="/">Open the demo workspace</Link>
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>
      {!demoMode && !me?.workspaces.length ? (
        <div className="mt-6">
          <EmptyState
            title="What happens next?"
            description="Connect a professional Instagram account, sync posts or Reels, then create your first keyword automation."
          />
        </div>
      ) : null}
    </div>
  );
}
