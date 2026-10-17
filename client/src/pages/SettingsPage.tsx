import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Database,
  Download,
  Globe2,
  Lock,
  Mail,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDate, relativeTime } from '../lib/format';
import { resetDemoData } from '../lib/demo';
import { PageHeader } from '../components/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { Field, Input, Select } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorState, PageSkeleton } from '../components/ui/States';
import type { Member, WorkspaceRole } from '../lib/types';

const TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Lagos',
  'Africa/Nairobi',
];

const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Full control, including billing, members and deletion.',
  admin: 'Manage accounts, automations, resources and members (except owners).',
  member: 'Create and edit automations and resources.',
};

function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <Badge tone={role === 'owner' ? 'brand' : role === 'admin' ? 'info' : 'neutral'}>{role}</Badge>
  );
}

export function SettingsPage() {
  const { api, demoMode, config } = useAuth();
  const { workspace, me, reload } = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState(workspace.name);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [fullName, setFullName] = useState(me.profile.fullName ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const membersState = useAsync(() => api.listMembers(workspace.id), [api, workspace.id]);
  const members = membersState.data?.members ?? [];

  const canManageWorkspace = workspace.role === 'owner' || workspace.role === 'admin';
  const canManageMembers = canManageWorkspace;
  const isOwner = workspace.role === 'owner';
  const currentTimezone = TIMEZONES.includes(timezone) ? timezone : '__custom';
  const [customTimezone, setCustomTimezone] = useState(
    currentTimezone === '__custom' ? timezone : '',
  );

  useEffect(() => {
    setName(workspace.name);
    setTimezone(workspace.timezone);
    if (!TIMEZONES.includes(workspace.timezone)) setCustomTimezone(workspace.timezone);
  }, [workspace.id, workspace.name, workspace.timezone]);

  useEffect(() => {
    setFullName(me.profile.fullName ?? '');
  }, [me.profile.fullName]);

  async function saveWorkspace() {
    setSavingWorkspace(true);
    try {
      const next = timezone === '__custom' ? customTimezone.trim() : timezone;
      if (!next) throw new Error('Choose a timezone.');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: next });
      } catch {
        throw new Error('That timezone is not a valid IANA timezone.');
      }
      await api.updateWorkspace(workspace.id, { name: name.trim(), timezone: next });
      toast.success('Workspace updated.');
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the workspace.');
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await api.updateProfile(fullName.trim() || null);
      toast.success('Profile updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update your profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function invite() {
    setInviteError(null);
    if (!inviteEmail.trim()) {
      setInviteError('Enter the email of an existing user.');
      return;
    }
    setInviting(true);
    try {
      await api.addMember(workspace.id, inviteEmail.trim().toLowerCase(), inviteRole);
      toast.success('Member added.');
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('member');
      membersState.reload();
      reload();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Could not add the member.');
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(member: Member, role: Exclude<WorkspaceRole, 'owner'>) {
    try {
      await api.updateMemberRole(workspace.id, member.userId, role);
      toast.success('Role updated.');
      membersState.reload();
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change the role.');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace settings"
        description="Profile, team access, workspace preferences and data controls."
      />

      {demoMode ? (
        <Alert
          tone="warning"
          title="Demo mode"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
              Reset sample data
            </Button>
          }
        >
          Profile, workspace and member changes are stored in this browser only. The demo server
          does not exist, so nothing is shared with other devices. Deleting the demo workspace is
          disabled; reset the sample data instead.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your profile" description="Shown to other workspace members." />
          <CardBody className="space-y-4">
            <Field
              label="Email"
              htmlFor="profile-email"
              hint="Email changes are managed by Supabase Auth."
            >
              <Input id="profile-email" value={me.user.email ?? ''} disabled readOnly />
            </Field>
            <Field label="Display name" htmlFor="profile-name">
              <Input
                id="profile-name"
                value={fullName}
                maxLength={80}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your name"
              />
            </Field>
            <Button
              onClick={saveProfile}
              loading={savingProfile}
              disabled={fullName === (me.profile.fullName ?? '')}
            >
              Save profile
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Workspace"
            description={`Created ${formatDate(workspace.createdAt)} · ${workspace.role} access`}
          />
          <CardBody className="space-y-4">
            <Field
              label="Name"
              htmlFor="workspace-name"
              hint="Shown in the sidebar and on activity exports."
            >
              <Input
                id="workspace-name"
                value={name}
                maxLength={80}
                disabled={!canManageWorkspace}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Timezone"
              htmlFor="workspace-timezone"
              hint="Used for calendar labels. Metrics are aggregated in UTC days."
            >
              <Select
                id="workspace-timezone"
                value={currentTimezone}
                disabled={!canManageWorkspace}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '__custom') {
                    setCustomTimezone(
                      timezone === '__custom' ? customTimezone : workspace.timezone,
                    );
                    setTimezone('__custom');
                  } else {
                    setTimezone(value);
                  }
                }}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
                <option value="__custom">Custom IANA timezone…</option>
              </Select>
            </Field>
            {currentTimezone === '__custom' ? (
              <Field label="Custom timezone" htmlFor="workspace-timezone-custom" error={null}>
                <Input
                  id="workspace-timezone-custom"
                  value={customTimezone}
                  disabled={!canManageWorkspace}
                  onChange={(event) => setCustomTimezone(event.target.value)}
                  placeholder="Asia/Kolkata"
                />
              </Field>
            ) : null}
            {canManageWorkspace ? (
              <div className="flex items-center gap-2">
                <Button onClick={saveWorkspace} loading={savingWorkspace}>
                  Save workspace
                </Button>
                <p className="text-xs text-zinc-400">
                  Only owners and admins can change these values.
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                Only owners and admins can change workspace settings.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Members"
          description="Add people who already have an account. This MVP sends no email invitations."
          actions={
            canManageMembers ? (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" /> Add member
              </Button>
            ) : null
          }
        />
        <CardBody className="p-0">
          {membersState.loading ? (
            <div className="p-5">
              <PageSkeleton />
            </div>
          ) : membersState.error ? (
            <div className="p-5">
              <ErrorState message={membersState.error.message} onRetry={membersState.reload} />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {members.map((member) => {
                const isMe = member.userId === me.user.id;
                return (
                  <li
                    key={member.userId}
                    className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold uppercase text-zinc-600">
                        {(member.fullName ?? member.email ?? '?').slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">
                          {member.fullName ?? member.email ?? 'Unknown user'}
                          {isMe ? (
                            <span className="ml-1.5 text-xs font-normal text-zinc-400">(you)</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          {member.email ?? 'No email'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-zinc-400">
                        Joined {relativeTime(member.createdAt)}
                      </span>
                      {isOwner && member.role !== 'owner' ? (
                        <Select
                          value={member.role}
                          onChange={(event) =>
                            changeRole(
                              member,
                              event.target.value as Exclude<WorkspaceRole, 'owner'>,
                            )
                          }
                          aria-label={`Role for ${member.email ?? member.userId}`}
                          className="h-8 w-28 text-xs"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </Select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                      {canManageMembers && member.role !== 'owner' && !isMe ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => setRemoveTarget(member)}
                        >
                          <UserMinus className="h-4 w-4" />
                          <span className="sr-only">Remove {member.email ?? member.userId}</span>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Data, retention & privacy"
          description="What this app stores and how to remove it."
          actions={<Badge tone="info">No token access from the browser</Badge>}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 text-sm text-zinc-600">
            <p className="flex items-start gap-2">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              Webhook events are stored for 30 days by default; runs and their delivery results are
              kept for 90 days. Usage counters are monthly aggregates without comment text.
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              Instagram tokens are encrypted with AES-256-GCM using a server-side key and are never
              returned to the browser. Disconnecting clears the stored token.
            </p>
            <p className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              Row Level Security restricts every tenant table to workspace members. The API also
              enforces ownership on each request.
            </p>
          </div>
          <div className="space-y-2 text-sm text-zinc-600">
            <p className="flex items-start gap-2">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              Deleting a connected account removes its synced media, rules, runs and encrypted
              token. Deleting the workspace removes all tenant data; Supabase auth users remain.
            </p>
            <p className="flex items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              Meta data-deletion callbacks are verified and tracked. For a manual deletion request,
              contact the operator address in the README.
            </p>
            <p className="flex items-start gap-2">
              <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              The app never scrapes Instagram, never asks for an Instagram password, and never uses
              unofficial endpoints.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" asChild>
                <a href="mailto:support@example.com?subject=Data%20deletion%20request">
                  <Download className="h-4 w-4" /> Request data export
                </a>
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Alert tone="info" title="Environment">
        API environment: <strong>{config?.environment ?? 'unknown'}</strong> · Graph API version{' '}
        <code className="font-mono text-xs">{config?.graphVersion ?? '—'}</code> · Webhook fields:{' '}
        <code className="font-mono text-xs">{config?.webhookFields.join(', ') ?? '—'}</code>. Meta
        app configuration is displayed without exposing secrets.
      </Alert>

      {isOwner ? (
        <Card className="border-red-200">
          <CardHeader
            title={<span className="text-red-700">Danger zone</span>}
            description="Deleting a workspace cannot be undone."
          />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-sm text-zinc-600">
              Removes accounts, automations, resources, activity and usage records. Stored tokens
              are discarded. Any Instagram webhook deliveries for this workspace are rejected.
            </p>
            <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={demoMode}>
              <Trash2 className="h-4 w-4" /> Delete workspace
            </Button>
          </CardBody>
        </Card>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-zinc-400">
          <AlertTriangle className="h-3.5 w-3.5" /> Only the workspace owner can delete this
          workspace.
        </p>
      )}

      <Modal
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setInviteError(null);
        }}
        title="Add workspace member"
        description="The person must have signed in at least once so a profile exists."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button onClick={invite} loading={inviting}>
              <UserPlus className="h-4 w-4" /> Add member
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label="Email"
            htmlFor="invite-email"
            hint="No invitation email is sent in this version."
          >
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
            />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_DESCRIPTIONS[inviteRole]}>
            <Select
              id="invite-role"
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as Exclude<WorkspaceRole, 'owner'>)
              }
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          {inviteError ? <Alert tone="error">{inviteError}</Alert> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove member?"
        description={`${removeTarget?.email ?? 'This user'} loses access to this workspace immediately. Their account is not deleted.`}
        confirmLabel="Remove member"
        onConfirm={async () => {
          if (!removeTarget) return;
          await api.removeMember(workspace.id, removeTarget.userId);
          toast.success('Member removed.');
          setRemoveTarget(null);
          membersState.reload();
          reload();
        }}
      />

      <Modal
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmName('');
        }}
        title="Delete this workspace?"
        description="This permanently removes all workspace data. Type the workspace name to continue."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              disabled={confirmName !== workspace.name}
              onClick={async () => {
                setDeleting(true);
                try {
                  await api.deleteWorkspace(workspace.id, confirmName);
                  toast.success('Workspace deleted.');
                  navigate('/', { replace: true });
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : 'Could not delete the workspace.',
                  );
                } finally {
                  setDeleting(false);
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete forever
            </Button>
          </>
        }
      >
        <Field label={`Type “${workspace.name}” to confirm`} htmlFor="confirm-workspace">
          <Input
            id="confirm-workspace"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            autoComplete="off"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset sample data?"
        description="Restores the seeded demo workspace, account, rules and activity in this browser. Any local changes are lost."
        confirmLabel="Reset demo data"
        tone="primary"
        onConfirm={() => {
          resetDemoData();
          window.location.reload();
        }}
      />

      <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
        <Users className="h-3.5 w-3.5" /> Roles: owner, admin, member. Server-side checks run on
        every request.
      </p>
    </div>
  );
}
