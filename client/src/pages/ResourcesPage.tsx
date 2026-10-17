import { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  MousePointerClick,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDateTime, formatNumber } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { Field, Input, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/States';
import type { Resource } from '../lib/types';

interface ResourceForm {
  title: string;
  url: string;
  description: string;
}

const EMPTY_FORM: ResourceForm = { title: '', url: '', description: '' };

export function ResourcesPage() {
  const { api, demoMode } = useAuth();
  const { workspace, reload } = useWorkspace();
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [form, setForm] = useState<ResourceForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Resource | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const state = useAsync(() => api.listResources(workspace.id), [api, workspace.id]);
  const resources = state.data?.resources ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return resources;
    return resources.filter(
      (resource) =>
        resource.title.toLowerCase().includes(needle) ||
        resource.url.toLowerCase().includes(needle),
    );
  }, [resources, query]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditorOpen(true);
  }

  function openEdit(resource: Resource) {
    setEditing(resource);
    setForm({
      title: resource.title,
      url: resource.url,
      description: resource.description ?? '',
    });
    setFormError(null);
    setEditorOpen(true);
  }

  async function submit() {
    setFormError(null);
    if (!form.title.trim()) {
      setFormError('Give the resource a title.');
      return;
    }
    if (!/^https:\/\/.+/i.test(form.url.trim())) {
      setFormError('Resource URLs must be valid HTTPS URLs.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateResource(workspace.id, editing.id, {
          title: form.title.trim(),
          url: form.url.trim(),
          description: form.description.trim() || null,
        });
        toast.success('Resource updated.');
      } else {
        await api.createResource(workspace.id, {
          title: form.title.trim(),
          url: form.url.trim(),
          description: form.description.trim() || null,
        });
        toast.success('Resource created.');
      }
      setEditorOpen(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      state.reload();
      reload();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the resource.');
    } finally {
      setSaving(false);
    }
  }

  async function copy(resource: Resource) {
    try {
      await navigator.clipboard.writeText(resource.trackedUrl);
      setCopiedId(resource.id);
      toast.success('Tracked link copied.');
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Clipboard access was blocked. Copy the link manually.');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resource library"
        description="Links you deliver in replies, with first-party click tracking."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New resource
          </Button>
        }
      />

      <Alert tone="info" title="What clicks can and cannot tell you">
        A click on a tracked link proves that someone opened the link. It does not prove that the
        commenter followed the account, and this app never treats it as follow evidence.
      </Alert>

      {demoMode ? (
        <Alert tone="warning" title="Demo mode">
          Resources are stored in this browser only. The tracked links point at example.com and do
          not resolve to real redirects.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Your resources"
          description={`${resources.length} saved`}
          actions={
            <Button size="sm" variant="secondary" onClick={state.reload}>
              Refresh
            </Button>
          }
        />
        <div className="border-b border-zinc-100 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search resources"
              aria-label="Search resources"
            />
          </div>
        </div>

        {state.loading ? (
          <PageSkeleton />
        ) : state.error ? (
          <div className="p-5">
            <ErrorState message={state.error.message} onRetry={state.reload} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={resources.length === 0 ? 'No resources yet' : 'Nothing matches that search'}
            description={
              resources.length === 0
                ? 'Add an HTTPS link such as a guide, prompt pack or waitlist. Automations can insert it as {{resource_url}}.'
                : 'Try a different title or URL.'
            }
            action={
              resources.length === 0 ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Add your first resource
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filtered.map((resource) => (
              <li key={resource.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-900">{resource.title}</p>
                      {demoMode ? <Badge tone="muted">Sample</Badge> : null}
                    </div>
                    {resource.description ? (
                      <p className="mt-0.5 text-xs text-zinc-500">{resource.description}</p>
                    ) : null}
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-zinc-500 hover:text-zinc-800"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{resource.url}</span>
                    </a>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <code className="max-w-full truncate rounded bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">
                        {resource.trackedUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(resource)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                      >
                        {copiedId === resource.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedId === resource.id ? 'Copied' : 'Copy tracked link'}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      Created {formatDateTime(resource.createdAt)} · Updated{' '}
                      {formatDateTime(resource.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="flex items-center justify-end gap-1 text-sm font-semibold text-zinc-900">
                        <MousePointerClick className="h-3.5 w-3.5 text-zinc-400" />
                        {formatNumber(resource.clickCount)}
                      </p>
                      <p className="text-[11px] text-zinc-400">clicks</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(resource)}>
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Edit {resource.title}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => setDeleteTarget(resource)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete {resource.title}</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardBody className="text-xs leading-relaxed text-zinc-500">
          Tracked links use a first-party redirect at{' '}
          <code className="font-mono">/r/&lt;slug&gt;</code>. The redirect records a click count and
          then sends the visitor to the HTTPS destination. No commenter identity is stored with the
          click. Deleting a resource removes its tracked link; automations that referenced it will
          ask you to choose another.
        </CardBody>
      </Card>

      <Modal
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditing(null);
            setFormError(null);
          }
        }}
        title={editing ? 'Edit resource' : 'New resource'}
        description="Only HTTPS destinations are accepted."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'Create resource'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" htmlFor="res-title">
            <Input
              id="res-title"
              value={form.title}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Free API starter guide"
            />
          </Field>
          <Field label="Destination URL" htmlFor="res-url" hint="Must start with https://">
            <Input
              id="res-url"
              type="url"
              value={form.url}
              onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
              placeholder="https://example.com/guide"
            />
          </Field>
          <Field label="Description (optional)" htmlFor="res-description">
            <Textarea
              id="res-description"
              rows={3}
              maxLength={500}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="What the link contains and why it is useful."
            />
          </Field>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.title ?? ''}”?`}
        description="The tracked link stops working. Automations that used it will need another resource before they can use {{resource_url}}."
        confirmLabel="Delete resource"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.deleteResource(workspace.id, deleteTarget.id);
          toast.success('Resource deleted.');
          setDeleteTarget(null);
          state.reload();
          reload();
        }}
      />
    </div>
  );
}
