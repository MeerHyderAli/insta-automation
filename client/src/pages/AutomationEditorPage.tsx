import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  ImageIcon,
  Plus,
  RefreshCw,
  Save,
  ShieldQuestion,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAsync } from '../lib/useAsync';
import { formatDate } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Alert } from '../components/ui/Alert';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorState, PageSkeleton, Skeleton } from '../components/ui/States';
import type { ApiError } from '../lib/api';
import type { MediaItem, Rule, RuleInput, RuleTestResult } from '../lib/types';

const PLACEHOLDERS = [
  { token: '{{username}}', hint: 'Commenter username' },
  { token: '{{keyword}}', hint: 'Matched keyword' },
  { token: '{{resource_url}}', hint: 'Resource link' },
  { token: '{{resource_title}}', hint: 'Resource title' },
  { token: '{{account_username}}', hint: 'Your account' },
  { token: '{{follow_instructions}}', hint: 'Follower instruction' },
] as const;

const PUBLIC_MAX = 2000;
const PRIVATE_MAX = 900;
const KNOWN_PLACEHOLDERS = PLACEHOLDERS.map((item) => item.token.slice(2, -2));

interface FormState {
  name: string;
  accountId: string;
  mediaId: string;
  keywordsText: string;
  publicReplyTemplate: string;
  privateReplyTemplate: string;
  resourceId: string;
  followGate: 'off' | 'instruction';
  priority: number;
  enabled: boolean;
}

function fromRule(rule: Rule): FormState {
  return {
    name: rule.name,
    accountId: rule.accountId,
    mediaId: rule.mediaId ?? '',
    keywordsText: rule.keywords.join(', '),
    publicReplyTemplate: rule.publicReplyTemplate ?? '',
    privateReplyTemplate: rule.privateReplyTemplate ?? '',
    resourceId: rule.resourceId ?? '',
    followGate: rule.followGate,
    priority: rule.priority,
    enabled: rule.enabled,
  };
}

function emptyForm(accountId: string): FormState {
  return {
    name: '',
    accountId,
    mediaId: '',
    keywordsText: '',
    publicReplyTemplate: '',
    privateReplyTemplate: '',
    resourceId: '',
    followGate: 'off',
    priority: 100,
    enabled: false,
  };
}

function parseKeywords(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const cleaned = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function templateIssues(
  template: string,
  label: string,
  maxLength: number,
  hasResource: boolean,
): string[] {
  if (!template.trim()) return [];
  const issues: string[] = [];
  if (template.length > maxLength) {
    issues.push(`${label} is ${template.length}/${maxLength} characters.`);
  }
  for (const match of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    const name = match[1] ?? '';
    if (!KNOWN_PLACEHOLDERS.includes(name)) {
      issues.push(`${label} uses unknown placeholder {{${name}}}.`);
    }
    if (!hasResource && (name === 'resource_url' || name === 'resource_title')) {
      issues.push(`${label} uses {{${name}}} but no resource is selected.`);
    }
  }
  if (template.includes('{{') && !/\{\{\s*[a-z_]+\s*\}\}/.test(template)) {
    issues.push(`${label} contains an unclosed placeholder.`);
  }
  return issues;
}

function renderClientTemplate(template: string, context: Record<string, string>): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) =>
      name in context ? context[name]! : match,
    )
    .trim();
}

function TemplateField({
  id,
  label,
  hint,
  value,
  onChange,
  maxLength,
  placeholders,
  issues,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholders?: boolean;
  issues: string[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const over = value.length > maxLength;

  function insert(token: string) {
    const element = ref.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="space-y-1.5">
      <Field
        label={
          <span className="flex w-full items-center justify-between gap-2">
            <span>{label}</span>
            <span className={`text-xs font-normal ${over ? 'text-red-600' : 'text-zinc-400'}`}>
              {value.length}/{maxLength}
            </span>
          </span>
        }
        htmlFor={id}
        hint={hint}
        error={issues[0]}
      >
        <textarea
          id={id}
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
          spellCheck
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
          placeholder="Thanks {{username}}! Here is your link: {{resource_url}}"
        />
      </Field>
      {placeholders ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {PLACEHOLDERS.map((item) => (
            <button
              key={item.token}
              type="button"
              onClick={() => insert(item.token)}
              title={item.hint}
              className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100"
            >
              {item.token}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AutomationEditorPage() {
  const { api, demoMode, config } = useAuth();
  const { workspace, reload } = useWorkspace();
  const { ruleId } = useParams<{ ruleId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !ruleId;
  const base = `/w/${workspace.id}`;

  const [form, setForm] = useState<FormState | null>(null);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [resourceDescription, setResourceDescription] = useState('');
  const [resourceSaving, setResourceSaving] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [testComment, setTestComment] = useState('API please');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const state = useAsync(async () => {
    const [{ accounts }, { resources }] = await Promise.all([
      api.listAccounts(workspace.id),
      api.listResources(workspace.id),
    ]);
    const rule = ruleId ? (await api.getRule(workspace.id, ruleId)).rule : null;
    return { accounts, resources, rule };
  }, [api, workspace.id, ruleId]);

  const accountIdForMedia = form?.accountId ?? '';
  const mediaState = useAsync(
    () => api.listMedia(workspace.id, accountIdForMedia),
    [api, workspace.id, accountIdForMedia],
    { enabled: Boolean(accountIdForMedia) },
  );

  useEffect(() => {
    if (!state.data || state.loading) return;
    const key = ruleId ?? 'new';
    if (hydratedFor === key) return;
    if (key !== 'new' && state.data.rule?.id !== key) return;
    const next = state.data.rule
      ? fromRule(state.data.rule)
      : emptyForm(
          searchParams.get('accountId') ??
            state.data.accounts.find((account) => account.status === 'connected')?.id ??
            state.data.accounts[0]?.id ??
            '',
        );
    setForm(next);
    setSnapshot(JSON.stringify(next));
    setHydratedFor(key);
  }, [state.data, state.loading, ruleId, hydratedFor, searchParams]);

  const resources = state.data?.resources ?? [];
  const accounts = state.data?.accounts ?? [];
  const media = mediaState.data?.media ?? [];
  const account = accounts.find((item) => item.id === form?.accountId) ?? null;
  const resource = resources.find((item) => item.id === form?.resourceId) ?? null;
  const keywords = useMemo(() => (form ? parseKeywords(form.keywordsText) : []), [form]);

  const clientErrors = useMemo(() => {
    if (!form) return [] as string[];
    const list: string[] = [];
    if (!form.name.trim()) list.push('Give the automation a name.');
    if (form.name.trim().length > 80) list.push('The name must be 80 characters or fewer.');
    if (!form.accountId) list.push('Select an Instagram account.');
    if (keywords.length === 0) list.push('Add at least one keyword.');
    if (keywords.length > 20) list.push('Use 20 keywords or fewer.');
    if (keywords.some((keyword) => keyword.length > 50)) {
      list.push('Each keyword must be 50 characters or fewer.');
    }
    if (!form.publicReplyTemplate.trim() && !form.privateReplyTemplate.trim()) {
      list.push('Add at least one public reply or private reply template.');
    }
    const hasResource = Boolean(form.resourceId);
    list.push(
      ...templateIssues(form.publicReplyTemplate, 'Public reply', PUBLIC_MAX, hasResource),
      ...templateIssues(form.privateReplyTemplate, 'Private reply', PRIVATE_MAX, hasResource),
    );
    if (form.enabled && account && account.status !== 'connected') {
      list.push('Reconnect the Instagram account before enabling the automation.');
    }
    return list;
  }, [form, keywords, account]);

  const dirty = form ? JSON.stringify(form) !== snapshot : false;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      if (!current) return current;
      if (key === 'accountId' && current.accountId !== value) {
        return { ...current, accountId: value as string, mediaId: '' };
      }
      return { ...current, [key]: value } as FormState;
    });
  }

  function payloadForSave(): RuleInput | null {
    if (!form) return null;
    return {
      name: form.name.trim(),
      accountId: form.accountId,
      mediaId: form.mediaId || null,
      keywords,
      publicReplyTemplate: form.publicReplyTemplate.trim() || null,
      privateReplyTemplate: form.privateReplyTemplate.trim() || null,
      resourceId: form.resourceId || null,
      followGate: form.followGate,
      priority: form.priority,
      enabled: form.enabled,
    };
  }

  async function save() {
    if (!form) return;
    setShowValidation(true);
    if (clientErrors.length > 0) {
      toast.error('Fix the highlighted fields before saving.');
      return;
    }
    const payload = payloadForSave();
    if (!payload) return;
    setSaving(true);
    setSaveError(null);
    setWarnings([]);
    try {
      if (isNew) {
        const result = await api.createRule(workspace.id, payload);
        toast.success('Automation created.');
        setWarnings(result.warnings);
        navigate(`${base}/automations/${result.rule.id}`, { replace: true });
      } else if (ruleId) {
        const updatePayload: Partial<RuleInput> = {
          name: payload.name,
          mediaId: payload.mediaId,
          keywords: payload.keywords,
          publicReplyTemplate: payload.publicReplyTemplate,
          privateReplyTemplate: payload.privateReplyTemplate,
          resourceId: payload.resourceId,
          followGate: payload.followGate,
          priority: payload.priority,
          enabled: payload.enabled,
        };
        const result = await api.updateRule(workspace.id, ruleId, updatePayload);
        toast.success('Automation saved.');
        setWarnings(result.warnings);
        const next = fromRule(result.rule);
        setForm(next);
        setSnapshot(JSON.stringify(next));
        setShowValidation(false);
        state.reload();
      }
      reload();
    } catch (error) {
      const apiError = error as ApiError;
      setSaveError(apiError);
      toast.error(apiError.message ?? 'Could not save the automation.');
    } finally {
      setSaving(false);
    }
  }

  async function createResource() {
    setResourceError(null);
    if (!resourceTitle.trim()) {
      setResourceError('Give the resource a title.');
      return;
    }
    if (!/^https:\/\/.+/i.test(resourceUrl.trim())) {
      setResourceError('Resource URLs must use HTTPS.');
      return;
    }
    setResourceSaving(true);
    try {
      const { resource: created } = await api.createResource(workspace.id, {
        title: resourceTitle.trim(),
        description: resourceDescription.trim() || null,
        url: resourceUrl.trim(),
      });
      if (state.data) {
        state.setData({ ...state.data, resources: [created, ...state.data.resources] });
      }
      update('resourceId', created.id);
      setResourceModalOpen(false);
      setResourceTitle('');
      setResourceUrl('');
      setResourceDescription('');
      toast.success('Resource added and selected.');
    } catch (error) {
      setResourceError(error instanceof Error ? error.message : 'Could not create the resource.');
    } finally {
      setResourceSaving(false);
    }
  }

  async function runTest() {
    if (!ruleId) return;
    setTesting(true);
    setTestError(null);
    try {
      setTestResult(
        await api.testRule(workspace.id, ruleId, {
          commentText: testComment,
          mediaId: form?.mediaId || null,
        }),
      );
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'Could not run the test.');
    } finally {
      setTesting(false);
    }
  }

  if (state.loading) return <PageSkeleton />;
  if (state.error) {
    return (
      <div className="space-y-4">
        <ErrorState
          title={
            state.error.message.toLowerCase().includes('not found')
              ? 'Automation not found'
              : 'Could not load the automation'
          }
          message={state.error.message}
          onRetry={state.reload}
        />
        <Button variant="secondary" asChild>
          <Link to={`${base}/automations`}>
            <ArrowLeft className="h-4 w-4" /> Back to automations
          </Link>
        </Button>
      </div>
    );
  }
  if (!form) return <PageSkeleton />;

  const displayErrors = showValidation ? clientErrors : [];
  const hasResourcePlaceholder =
    form.publicReplyTemplate.includes('{{resource_url}}') ||
    form.privateReplyTemplate.includes('{{resource_url}}');
  const followCapability = config?.followVerification;
  const previewContext = {
    username: 'sample_commenter',
    keyword: keywords[0] ?? 'KEYWORD',
    resource_url: resource?.url ?? '',
    resource_title: resource?.title ?? '',
    account_username: account?.username ?? 'your_account',
    follow_instructions: `Follow @${account?.username ?? 'your_account'} so you do not miss the next drop.`,
  };
  const publicPreview = form.publicReplyTemplate.trim()
    ? renderClientTemplate(form.publicReplyTemplate, previewContext)
    : '';
  const privatePreview = form.privateReplyTemplate.trim()
    ? renderClientTemplate(form.privateReplyTemplate, previewContext)
    : '';

  return (
    <div className="space-y-6 pb-24">
      <div>
        <Link
          to={`${base}/automations`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" /> Automations
        </Link>
        <PageHeader
          eyebrow={isNew ? 'New automation' : 'Edit automation'}
          title={isNew ? 'Create an automation' : form.name || 'Automation'}
          description="Choose which comments trigger a public reply, a private reply, and a resource link."
          actions={
            <div className="flex items-center gap-2">
              {!isNew && ruleId ? (
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              ) : null}
              <Button onClick={save} loading={saving}>
                <Save className="h-4 w-4" /> {isNew ? 'Create automation' : 'Save changes'}
              </Button>
            </div>
          }
        />
      </div>

      {demoMode ? (
        <Alert tone="warning" title="Demo mode">
          Changes are saved in this browser only. Real automations require a connected account, the
          API server, completed Meta App Review and confirmed webhook delivery.
        </Alert>
      ) : null}

      {saveError ? (
        <Alert
          tone="error"
          title="Could not save"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setSaveError(null)}>
              Dismiss
            </Button>
          }
        >
          {saveError.message}
          {saveError.requestId ? (
            <span className="mt-1 block text-xs opacity-70">Request id: {saveError.requestId}</span>
          ) : null}
          {Array.isArray(saveError.details) ? (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {saveError.details.map((detail, index) => (
                <li key={index}>{typeof detail === 'string' ? detail : JSON.stringify(detail)}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {warnings.length > 0 ? (
        <Alert tone="warning" title="Saved with warnings">
          <ul className="list-disc pl-4">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {showValidation && clientErrors.length > 0 ? (
        <Alert tone="error" title="Check these fields">
          <ul className="list-disc pl-4">
            {clientErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {accounts.length === 0 ? (
        <Alert
          tone="warning"
          title="No Instagram account connected"
          actions={
            <Button size="sm" asChild>
              <Link to={`${base}/accounts`}>Connect</Link>
            </Button>
          }
        >
          Connect a Business or Creator account before creating an automation.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Basics"
              description="Name the rule and pick the account it belongs to."
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field
                  label="Automation name"
                  htmlFor="rule-name"
                  hint="Shown in activity and previews."
                  error={displayErrors.find((error) => error.includes('name')) ?? null}
                >
                  <Input
                    id="rule-name"
                    value={form.name}
                    maxLength={90}
                    onChange={(event) => update('name', event.target.value)}
                    placeholder="Free guide for API comments"
                  />
                </Field>
              </div>
              <Field
                label="Instagram account"
                htmlFor="rule-account"
                hint={
                  isNew
                    ? undefined
                    : 'The account cannot be changed after creation. Create a new rule instead.'
                }
              >
                <Select
                  id="rule-account"
                  value={form.accountId}
                  disabled={!isNew}
                  onChange={(event) => update('accountId', event.target.value)}
                >
                  <option value="">Select an account</option>
                  {accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      @{item.username}
                      {item.status !== 'connected' ? ` (${item.status.replace('_', ' ')})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Priority"
                htmlFor="rule-priority"
                hint="Lower numbers win when several rules match. Media-specific rules always win."
              >
                <Input
                  id="rule-priority"
                  type="number"
                  min={1}
                  max={1000}
                  value={form.priority}
                  onChange={(event) => update('priority', Number(event.target.value) || 100)}
                />
              </Field>
              {account && account.status !== 'connected' ? (
                <div className="sm:col-span-2">
                  <Alert tone="warning" title="This account needs attention">
                    Status: {account.status.replace('_', ' ')}. Reconnect it from{' '}
                    <Link to={`${base}/accounts`} className="underline">
                      Accounts
                    </Link>{' '}
                    before enabling rules.
                  </Alert>
                </div>
              ) : null}
              {account && !account.webhookSubscribed ? (
                <div className="sm:col-span-2">
                  <Alert tone="info" title="Webhook delivery is not confirmed">
                    Comments will not reach the app until Meta confirms the subscription. You can
                    still save the rule; enabling it will show a warning.
                  </Alert>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Trigger"
              description="Case-insensitive, whole-word matching. A comment can contain several keywords."
            />
            <CardBody className="space-y-4">
              <Field
                label="Keywords"
                htmlFor="rule-keywords"
                hint="Comma or newline separated. Example: API, GUIDE, FREE. Matches “api!” but not “capital”."
                error={displayErrors.find((error) => error.includes('keyword')) ?? null}
              >
                <Textarea
                  id="rule-keywords"
                  rows={3}
                  value={form.keywordsText}
                  onChange={(event) => update('keywordsText', event.target.value)}
                  placeholder="API, TOOLS, GUIDE, PROMPT, FREE"
                  className="font-mono"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-1.5">
                {keywords.length === 0 ? (
                  <span className="text-xs text-zinc-400">No keywords yet.</span>
                ) : (
                  keywords.map((keyword) => (
                    <Badge key={keyword} tone="brand">
                      {keyword}
                    </Badge>
                  ))
                )}
                <span className="ml-auto text-xs text-zinc-400">{keywords.length}/20</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Scope"
              description="Run on every post, or only on a specific post or Reel."
            />
            <CardBody className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50">
                <input
                  type="radio"
                  name="scope"
                  className="mt-1 accent-zinc-900"
                  checked={form.mediaId === ''}
                  onChange={() => update('mediaId', '')}
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-900">All posts & Reels</span>
                  <span className="block text-xs text-zinc-500">
                    Applies to any new or existing post on this account.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-3 rounded-lg border p-3 ${media.length === 0 ? 'border-zinc-200 bg-zinc-50 opacity-70' : 'cursor-pointer border-zinc-200 hover:bg-zinc-50'}`}
              >
                <input
                  type="radio"
                  name="scope"
                  className="mt-1 accent-zinc-900"
                  disabled={media.length === 0}
                  checked={form.mediaId !== ''}
                  onChange={() => update('mediaId', media[0]?.mediaId ?? '')}
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-900">
                    One specific post or Reel
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Use this when only one post mentions a keyword.
                  </span>
                </span>
              </label>

              {form.mediaId !== '' ? (
                mediaState.loading ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[0, 1, 2].map((key) => (
                      <Skeleton key={key} className="h-20 w-full" />
                    ))}
                  </div>
                ) : media.length === 0 ? (
                  <Alert tone="info" title="No synced media">
                    Sync posts from{' '}
                    <Link to={`${base}/accounts`} className="underline">
                      Accounts
                    </Link>{' '}
                    first.
                  </Alert>
                ) : (
                  <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {media.map((item) => (
                      <MediaOption
                        key={item.mediaId}
                        item={item}
                        selected={form.mediaId === item.mediaId}
                        onSelect={() => update('mediaId', item.mediaId)}
                      />
                    ))}
                  </div>
                )
              ) : null}

              {mediaState.error ? (
                <Alert
                  tone="warning"
                  actions={
                    <Button size="sm" variant="ghost" onClick={mediaState.reload}>
                      <RefreshCw className="h-4 w-4" /> Retry
                    </Button>
                  }
                >
                  Could not load synced media: {mediaState.error.message}
                </Alert>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Replies"
              description="Templates are rendered with the commenter name, matched keyword and resource link."
            />
            <CardBody className="space-y-5">
              <TemplateField
                id="public-reply"
                label="Public reply"
                hint="Posted as a reply to the comment. Visible to everyone."
                value={form.publicReplyTemplate}
                onChange={(value) => update('publicReplyTemplate', value)}
                maxLength={PUBLIC_MAX}
                placeholders
                issues={templateIssues(
                  form.publicReplyTemplate,
                  'Public reply',
                  PUBLIC_MAX,
                  Boolean(form.resourceId),
                )}
              />
              <TemplateField
                id="private-reply"
                label="Private reply (optional)"
                hint="One private message per comment, within 7 days. Only send it if the commenter expects it."
                value={form.privateReplyTemplate}
                onChange={(value) => update('privateReplyTemplate', value)}
                maxLength={PRIVATE_MAX}
                placeholders
                issues={templateIssues(
                  form.privateReplyTemplate,
                  'Private reply',
                  PRIVATE_MAX,
                  Boolean(form.resourceId),
                )}
              />
              <Alert tone="info">
                Private replies are limited to one per comment, only inside the 7-day window, and
                text-only in this app. Instagram shows them in the Inbox, or in Requests when the
                commenter does not follow the account.
              </Alert>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Resource"
              description="A tracked HTTPS link that can be inserted into replies."
            />
            <CardBody className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={form.resourceId}
                  onChange={(event) => update('resourceId', event.target.value)}
                  aria-label="Resource"
                  className="flex-1"
                >
                  <option value="">No resource</option>
                  {resources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => setResourceModalOpen(true)}>
                  <Plus className="h-4 w-4" /> New resource
                </Button>
              </div>
              {resource ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <p className="font-medium text-zinc-900">{resource.title}</p>
                  <p className="mt-0.5 break-all text-xs text-zinc-500">{resource.url}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-zinc-400">
                    Tracked: {resource.trackedUrl}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {resource.clickCount} clicks · clicks are not proof of following.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  Optional, but required if a template uses {'{{resource_url}}'} or{' '}
                  {'{{resource_title}}'}.
                </p>
              )}
              {hasResourcePlaceholder && !form.resourceId ? (
                <Alert tone="warning">Choose a resource or remove the resource placeholders.</Alert>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Publishing" />
            <CardBody className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900">Enabled</p>
                  <p className="text-xs text-zinc-500">
                    Disabled rules keep their configuration but do not react to comments.
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) => update('enabled', checked)}
                  ariaLabel="Enable automation"
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900">Follow instruction</p>
                  <p className="text-xs text-zinc-500">
                    Append a gentle follow request to the private reply.
                  </p>
                </div>
                <Switch
                  checked={form.followGate === 'instruction'}
                  onCheckedChange={(checked) =>
                    update('followGate', checked ? 'instruction' : 'off')
                  }
                  ariaLabel="Add follow instruction"
                />
              </div>
              <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
                <div className="flex items-start gap-2">
                  <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-800">
                      Verify follow before sending
                      <Badge tone="warning">Unsupported</Badge>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                      {followCapability?.summary ??
                        'Instagram does not expose follower status for arbitrary commenters, so this app cannot verify follows.'}{' '}
                      Nothing is faked. Use the instruction instead; clicks are measured but never
                      treated as follow proof.
                    </p>
                    {followCapability ? (
                      <a
                        href={followCapability.docs}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block text-xs text-zinc-500 underline hover:text-zinc-800"
                      >
                        Official Meta documentation
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
              {dirty ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Unsaved changes
                </p>
              ) : isNew ? null : (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All changes saved
                </p>
              )}
              <Button className="w-full" onClick={save} loading={saving}>
                <Save className="h-4 w-4" /> {isNew ? 'Create automation' : 'Save changes'}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Preview" description="Rendered locally with a sample commenter." />
            <CardBody className="space-y-3">
              {publicPreview || privatePreview ? (
                <>
                  {publicPreview ? (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        Public reply
                      </p>
                      <div className="rounded-2xl rounded-tl-sm border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                        <p className="mb-1 text-xs font-medium text-zinc-900">
                          @{account?.username ?? 'your_account'}
                        </p>
                        <p className="whitespace-pre-wrap">{publicPreview}</p>
                      </div>
                    </div>
                  ) : null}
                  {privatePreview ? (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        Private reply
                      </p>
                      <div className="rounded-2xl rounded-tr-sm bg-zinc-900 p-3 text-sm text-white">
                        <p className="whitespace-pre-wrap">{privatePreview}</p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  Write a reply template to see a preview here.
                </p>
              )}
            </CardBody>
          </Card>

          {!isNew && ruleId ? (
            <Card>
              <CardHeader
                title="Test mode"
                description="Runs the saved rule through keyword matching and template rendering. Save changes first."
                actions={<Badge tone="neutral">No messages sent</Badge>}
              />
              <CardBody className="space-y-3">
                <Field label="Sample comment" htmlFor="test-comment">
                  <Textarea
                    id="test-comment"
                    rows={2}
                    value={testComment}
                    onChange={(event) => setTestComment(event.target.value)}
                    placeholder="API"
                  />
                </Field>
                <Button
                  variant="secondary"
                  onClick={runTest}
                  loading={testing}
                  disabled={!testComment.trim()}
                >
                  <FlaskConical className="h-4 w-4" /> Run test
                </Button>
                {testError ? <Alert tone="error">{testError}</Alert> : null}
                {testResult ? (
                  <div className="space-y-2 rounded-lg border border-zinc-200 p-3 text-xs">
                    <p className="flex items-center gap-2">
                      <Wand2 className="h-3.5 w-3.5 text-zinc-500" />
                      {testResult.matched ? (
                        <>
                          Matched keyword <strong>{testResult.matchedKeyword}</strong>
                        </>
                      ) : (
                        <>No keyword matched — this comment would be ignored.</>
                      )}
                    </p>
                    {testResult.publicReply ? (
                      <div>
                        <p className="text-zinc-500">
                          Public reply ({testResult.publicReply.length}/
                          {testResult.publicReply.limit})
                        </p>
                        <p className="whitespace-pre-wrap text-zinc-800">
                          {testResult.publicReply.text}
                        </p>
                        {testResult.publicReply.errors.map((error) => (
                          <p key={error} className="text-red-600">
                            {error}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {testResult.privateReply ? (
                      <div>
                        <p className="text-zinc-500">
                          Private reply ({testResult.privateReply.length}/
                          {testResult.privateReply.limit})
                        </p>
                        <p className="whitespace-pre-wrap text-zinc-800">
                          {testResult.privateReply.text}
                        </p>
                        {testResult.privateReply.errors.map((error) => (
                          <p key={error} className="text-red-600">
                            {error}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <ul className="list-disc space-y-1 pl-4 text-zinc-500">
                      {testResult.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {!isNew ? (
            <p className="px-1 text-xs text-zinc-400">
              Created {state.data?.rule ? formatDate(state.data.rule.createdAt) : '—'} · Last
              updated {state.data?.rule ? formatDate(state.data.rule.updatedAt) : '—'}
            </p>
          ) : null}
        </div>
      </div>

      <Modal
        open={resourceModalOpen}
        onOpenChange={(open) => {
          setResourceModalOpen(open);
          if (!open) setResourceError(null);
        }}
        title="New tracked resource"
        description="The app wraps this HTTPS link in a first-party redirect so clicks can be counted."
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setResourceModalOpen(false)}
              disabled={resourceSaving}
            >
              Cancel
            </Button>
            <Button onClick={createResource} loading={resourceSaving}>
              <Plus className="h-4 w-4" /> Add resource
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" htmlFor="resource-title">
            <Input
              id="resource-title"
              value={resourceTitle}
              maxLength={120}
              onChange={(event) => setResourceTitle(event.target.value)}
              placeholder="Free API starter guide"
            />
          </Field>
          <Field label="HTTPS URL" htmlFor="resource-url" hint="Only HTTPS links are accepted.">
            <Input
              id="resource-url"
              type="url"
              value={resourceUrl}
              onChange={(event) => setResourceUrl(event.target.value)}
              placeholder="https://example.com/guide"
            />
          </Field>
          <Field label="Description (optional)" htmlFor="resource-description">
            <Textarea
              id="resource-description"
              rows={2}
              maxLength={500}
              value={resourceDescription}
              onChange={(event) => setResourceDescription(event.target.value)}
            />
          </Field>
          {resourceError ? <Alert tone="error">{resourceError}</Alert> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${form.name}”?`}
        description="The automation is removed permanently. Activity history is kept."
        confirmLabel="Delete automation"
        onConfirm={async () => {
          if (!ruleId) return;
          await api.deleteRule(workspace.id, ruleId);
          toast.success('Automation deleted.');
          setDeleteOpen(false);
          reload();
          navigate(`${base}/automations`, { replace: true });
        }}
      />
    </div>
  );
}

function MediaOption({
  item,
  selected,
  onSelect,
}: {
  item: MediaItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center gap-2.5 rounded-lg border p-2 text-left ${
        selected
          ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900'
          : 'border-zinc-200 hover:bg-zinc-50'
      }`}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-400">
        {item.thumbnailUrl && !broken ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <ImageIcon className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-zinc-800">
          {item.caption?.slice(0, 60) || item.mediaProductType || 'Media'}
        </span>
        <span className="block text-[11px] text-zinc-500">
          {item.mediaProductType ?? item.mediaType ?? 'POST'}
          {item.publishedAt ? ` · ${formatDate(item.publishedAt)}` : ''}
        </span>
      </span>
      {selected ? <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-zinc-900" /> : null}
    </button>
  );
}
