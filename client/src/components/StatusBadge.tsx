import { Badge } from './ui/Badge';
import type { AccountStatus, ReplyStatus, RunStatus } from '../lib/types';

const runTones: Record<
  RunStatus,
  { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted'; label: string }
> = {
  queued: { tone: 'neutral', label: 'Queued' },
  processing: { tone: 'info', label: 'Processing' },
  completed: { tone: 'success', label: 'Completed' },
  partial: { tone: 'warning', label: 'Partial' },
  failed: { tone: 'danger', label: 'Failed' },
  skipped: { tone: 'muted', label: 'Skipped' },
};

const replyTones: Record<
  ReplyStatus,
  { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted'; label: string }
> = {
  skipped: { tone: 'muted', label: 'Not sent' },
  pending: { tone: 'warning', label: 'Retrying' },
  sending: { tone: 'info', label: 'Sending' },
  sent: { tone: 'success', label: 'Sent' },
  failed: { tone: 'danger', label: 'Failed' },
  unknown: { tone: 'warning', label: 'Unconfirmed' },
};

const accountTones: Record<
  AccountStatus,
  { tone: 'success' | 'warning' | 'danger' | 'muted'; label: string }
> = {
  connected: { tone: 'success', label: 'Connected' },
  needs_reconnect: { tone: 'danger', label: 'Reconnect needed' },
  missing_permissions: { tone: 'warning', label: 'Missing permissions' },
  disconnected: { tone: 'muted', label: 'Disconnected' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const entry = runTones[status];
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function ReplyStatusBadge({ status }: { status: ReplyStatus }) {
  const entry = replyTones[status];
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const entry = accountTones[status];
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
