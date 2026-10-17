-- 0001_schema.sql
-- Core multi-tenant schema. Every business row is scoped to a workspace.

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Plans (catalogue only; billing is out of scope for the MVP)
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id text primary key,
  name text not null,
  description text,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique,
  plan_id text not null default 'free' references public.plans (id),
  timezone text not null default 'UTC',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create unique index if not exists workspace_members_one_owner_idx
  on public.workspace_members (workspace_id)
  where role = 'owner';
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Connected Instagram professional accounts
-- Tokens are stored encrypted; the plaintext never leaves the server.
-- ---------------------------------------------------------------------------
create table if not exists public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ig_user_id text not null unique,
  meta_user_id text,
  username text not null,
  account_type text,
  scopes text[] not null default '{}',
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  token_key_version integer not null default 1,
  token_expires_at timestamptz not null,
  status text not null default 'connected'
    check (status in ('connected', 'needs_reconnect', 'missing_permissions', 'disconnected')),
  last_error_code text,
  last_error_at timestamptz,
  webhook_subscribed_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index if not exists instagram_accounts_workspace_idx on public.instagram_accounts (workspace_id);
create index if not exists instagram_accounts_meta_user_idx on public.instagram_accounts (meta_user_id);
create index if not exists instagram_accounts_workspace_status_idx
  on public.instagram_accounts (workspace_id, status);

create table if not exists public.instagram_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.instagram_accounts (id) on delete cascade,
  ig_media_id text not null,
  media_type text,
  media_product_type text,
  caption text,
  permalink text,
  thumbnail_url text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (account_id, ig_media_id)
);
create index if not exists instagram_media_workspace_idx on public.instagram_media (workspace_id);

-- ---------------------------------------------------------------------------
-- Resource library and click tracking
-- ---------------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text,
  url text not null,
  slug text not null unique,
  click_count integer not null default 0 check (click_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index if not exists resources_workspace_idx on public.resources (workspace_id);

create table if not exists public.resource_clicks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  clicked_at timestamptz not null default now(),
  user_agent text
);
create index if not exists resource_clicks_workspace_time_idx
  on public.resource_clicks (workspace_id, clicked_at desc);

-- ---------------------------------------------------------------------------
-- Automation rules
-- ---------------------------------------------------------------------------
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  enabled boolean not null default false,
  media_id text,
  keywords text[] not null check (cardinality(keywords) between 1 and 20),
  public_reply_template text,
  private_reply_template text,
  resource_id uuid,
  follow_gate text not null default 'off' check (follow_gate in ('off', 'instruction')),
  priority integer not null default 100 check (priority between 1 and 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_has_reply check (
    public_reply_template is not null or private_reply_template is not null
  ),
  constraint automation_rules_account_fk
    foreign key (account_id, workspace_id)
    references public.instagram_accounts (id, workspace_id) on delete cascade,
  constraint automation_rules_resource_fk
    foreign key (resource_id) references public.resources (id) on delete set null,
  unique (workspace_id, name)
);
create index if not exists automation_rules_workspace_enabled_idx
  on public.automation_rules (workspace_id, enabled);
create index if not exists automation_rules_account_enabled_idx
  on public.automation_rules (account_id, enabled);

-- A rule may only reference a resource from its own workspace.
create or replace function app.enforce_rule_resource_workspace()
returns trigger
language plpgsql
as $$
begin
  if new.resource_id is not null then
    if not exists (
      select 1 from public.resources
      where id = new.resource_id and workspace_id = new.workspace_id
    ) then
      raise exception 'automation rule resource must belong to the same workspace'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_rule_resource_workspace on public.automation_rules;
create trigger enforce_rule_resource_workspace
  before insert or update of resource_id, workspace_id on public.automation_rules
  for each row execute function app.enforce_rule_resource_workspace();

-- ---------------------------------------------------------------------------
-- OAuth state (hashed, single use)
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- Durable webhook events with dedupe
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  account_id uuid references public.instagram_accounts (id) on delete cascade,
  ig_account_id text,
  field text not null,
  comment_id text,
  media_id text,
  commenter_igsid text,
  commenter_username text,
  comment_text text,
  payload jsonb,
  duplicate_count integer not null default 0,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'ignored', 'unsupported', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists webhook_events_account_received_idx
  on public.webhook_events (account_id, received_at desc);
create index if not exists webhook_events_status_idx on public.webhook_events (status);

-- ---------------------------------------------------------------------------
-- Automation runs: exactly one run per (account, comment). Meta allows only a
-- single private reply per comment, so competing rules must not both send.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.instagram_accounts (id) on delete cascade,
  webhook_event_id uuid references public.webhook_events (id) on delete set null,
  rule_id uuid references public.automation_rules (id) on delete set null,
  rule_name text not null,
  comment_id text not null,
  media_id text,
  commenter_username text,
  commenter_igsid text,
  comment_text text,
  matched_keyword text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'partial', 'failed', 'skipped')),
  skip_reason text,
  public_reply_status text not null default 'skipped'
    check (public_reply_status in ('skipped', 'pending', 'sending', 'sent', 'failed', 'unknown')),
  public_reply_id text,
  public_reply_error text,
  private_reply_status text not null default 'skipped'
    check (private_reply_status in ('skipped', 'pending', 'sending', 'sent', 'failed', 'unknown')),
  private_reply_message_id text,
  private_reply_error text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, comment_id)
);
create index if not exists automation_runs_workspace_created_idx
  on public.automation_runs (workspace_id, created_at desc);
create index if not exists automation_runs_workspace_status_idx
  on public.automation_runs (workspace_id, status);
create index if not exists automation_runs_rule_idx on public.automation_runs (rule_id);

create table if not exists public.automation_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.automation_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  code text,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists automation_run_events_run_idx
  on public.automation_run_events (run_id, created_at);

-- ---------------------------------------------------------------------------
-- Durable job queue (Postgres, claimed with FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------
create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id uuid not null unique references public.webhook_events (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  account_id uuid references public.instagram_accounts (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_jobs_claim_idx
  on public.automation_jobs (status, run_after);
create index if not exists automation_jobs_workspace_idx on public.automation_jobs (workspace_id);

-- ---------------------------------------------------------------------------
-- Usage counters (monthly; atomic quota enforcement via app.increment_usage)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  period_start date not null,
  metric text not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (workspace_id, period_start, metric)
);
create index if not exists usage_records_workspace_period_idx
  on public.usage_records (workspace_id, period_start);

-- ---------------------------------------------------------------------------
-- Audit log (security-relevant actions)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_workspace_time_idx
  on public.audit_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Meta deauthorize / data-deletion requests (confirmation codes)
-- ---------------------------------------------------------------------------
create table if not exists public.meta_data_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  meta_user_id text,
  kind text not null check (kind in ('deauthorize', 'data_deletion')),
  status text not null default 'completed',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  details jsonb
);
create index if not exists meta_data_requests_meta_user_idx
  on public.meta_data_requests (meta_user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'workspaces', 'instagram_accounts', 'resources',
    'automation_rules', 'automation_runs', 'automation_jobs'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;
