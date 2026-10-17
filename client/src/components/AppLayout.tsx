import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity,
  BarChart3,
  Camera,
  ChevronsUpDown,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { WorkspaceContext, type WorkspaceContextValue } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { cn, initials } from '../lib/utils';
import type { MeResponse } from '../lib/types';
import { ErrorState, LoadingState, PageSkeleton } from './ui/States';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import {
  Dropdown,
  DropdownCheckItem,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from './ui/Dropdown';

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }> = [
  { to: '', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: 'accounts', label: 'Accounts', icon: Camera },
  { to: 'automations', label: 'Automations', icon: Zap },
  { to: 'resources', label: 'Resources', icon: FolderOpen },
  { to: 'activity', label: 'Activity', icon: Activity },
  { to: 'analytics', label: 'Analytics', icon: BarChart3 },
] as const;

const SECONDARY_NAV = [
  { to: 'usage', label: 'Usage & plan', icon: Gauge },
  { to: 'settings', label: 'Settings', icon: Settings },
] as const;

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="CommentPilot home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
        <MessageCircle className="h-5 w-5 text-orange-300" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight text-white">CommentPilot</span>
        <span className="block text-[11px] text-zinc-400">Instagram automation</span>
      </span>
    </Link>
  );
}

function SidebarNav({ workspaceId, onNavigate }: { workspaceId: string; onNavigate?: () => void }) {
  const base = `/w/${workspaceId}`;
  return (
    <nav className="flex h-full flex-col gap-6 p-4" aria-label="Main navigation">
      <Brand />
      <div className="space-y-1">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Workspace
        </p>
        {NAV.map((item) => (
          <NavLink
            key={item.label}
            to={`${base}/${item.to}`.replace(/\/$/, '')}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
              )
            }
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </div>
      <div className="space-y-1">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Manage
        </p>
        {SECONDARY_NAV.map((item) => (
          <NavLink
            key={item.label}
            to={`${base}/${item.to}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
              )
            }
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </div>
      <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-zinc-400">
        <p className="flex items-center gap-1.5 font-medium text-zinc-300">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          Human-approved API only
        </p>
        <p className="mt-1">No scraping, no password sharing. Follow checks are not claimed.</p>
      </div>
    </nav>
  );
}

function WorkspaceSwitcher({ me, workspaceId }: { me: MeResponse; workspaceId: string }) {
  const navigate = useNavigate();
  const current = me.workspaces.find((workspace) => workspace.id === workspaceId);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left shadow-sm hover:bg-zinc-50"
          aria-label="Switch workspace"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md brand-gradient text-xs font-bold text-white">
            {initials(current?.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-zinc-900">
              {current?.name ?? 'Workspace'}
            </span>
            <span className="block text-[11px] capitalize text-zinc-500">
              {current?.role} · {current?.planName}
            </span>
          </span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64">
        <DropdownLabel>Workspaces</DropdownLabel>
        {me.workspaces.map((workspace) => (
          <DropdownCheckItem
            key={workspace.id}
            active={workspace.id === workspaceId}
            onSelect={() => navigate(`/w/${workspace.id}`)}
          >
            {workspace.name}
          </DropdownCheckItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => navigate('/onboarding')}>
          <Plus className="h-4 w-4" /> New workspace
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function UserMenu({ email, demoMode }: { email: string | null; demoMode: boolean }) {
  const { signOut } = useAuth();
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white p-1 pr-2 shadow-sm hover:bg-zinc-50"
          aria-label="Account menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">
            {initials(email?.split('@')[0], email)}
          </span>
          <span className="hidden max-w-36 truncate text-xs text-zinc-600 sm:block">{email}</span>
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium text-zinc-900">{email ?? 'Signed in'}</p>
          {demoMode ? (
            <Badge tone="brand" className="mt-1">
              Demo account
            </Badge>
          ) : null}
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={() => void signOut()}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      Demo mode — sample data only. No Instagram API calls are made and nothing is delivered.
    </div>
  );
}

export function AppLayout() {
  const { workspaceId = '' } = useParams();
  const { api, user, loading: authLoading, demoMode, config } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const state = useAsync(
    async () => {
      const me = await api.getMe();
      const detail = await api.getWorkspace(workspaceId);
      return { me, workspace: detail.workspace, counts: detail.counts };
    },
    [api, workspaceId],
    { enabled: Boolean(user) && Boolean(workspaceId) },
  );

  if (authLoading || state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <LoadingState label="Loading your workspace…" />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white">
          <ErrorState message={state.error.message} onRetry={state.reload} />
          <div className="border-t border-zinc-100 p-4 text-center">
            <Link to="/" className="text-sm font-medium text-zinc-700 underline underline-offset-4">
              Back to your workspaces
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!state.data) return <PageSkeleton />;

  const contextValue: WorkspaceContextValue = {
    me: state.data.me,
    workspace: state.data.workspace,
    counts: state.data.counts,
    api,
    reload: state.reload,
  };

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <div className="flex min-h-screen flex-col bg-zinc-50">
        {demoMode ? <DemoBanner /> : null}
        <div className="flex flex-1">
          <aside className="hidden w-64 shrink-0 bg-zinc-950 lg:block">
            <div className="sticky top-0 h-screen">
              <SidebarNav workspaceId={workspaceId} />
            </div>
          </aside>

          <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto bg-zinc-950 lg:hidden">
                <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                <div className="absolute right-3 top-3 z-10">
                  <DialogPrimitive.Close
                    className="rounded-md p-2 text-zinc-400 hover:bg-white/10"
                    aria-label="Close navigation"
                  >
                    <X className="h-4 w-4" />
                  </DialogPrimitive.Close>
                </div>
                <SidebarNav workspaceId={workspaceId} onNavigate={() => setMobileOpen(false)} />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
              <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    aria-label="Open navigation"
                    onClick={() => setMobileOpen(true)}
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                  <WorkspaceSwitcher me={state.data.me} workspaceId={workspaceId} />
                  {demoMode ? (
                    <Badge tone="warning" className="hidden sm:inline-flex">
                      Demo
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1.5 text-xs text-zinc-500 md:flex">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        config?.metaConfigured ? 'bg-emerald-500' : 'bg-zinc-300',
                      )}
                    />
                    {config?.metaConfigured ? 'Instagram configured' : 'Instagram not configured'}
                  </span>
                  <UserMenu email={state.data.me.profile.email} demoMode={demoMode} />
                </div>
              </div>
            </header>
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
