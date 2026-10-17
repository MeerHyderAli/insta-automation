-- 0002_rls.sql
-- Row Level Security + least-privilege grants.
--
-- The Express API connects with the service role and performs its own
-- authorization checks. These policies are defence in depth for any direct
-- PostgREST/Supabase client access, and are covered by the tenant-isolation
-- tests in supabase/tests/rls.test.sql.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies can read workspace_members without
-- recursing through its own RLS policy).
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then null
    else nullif((current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
  end;
$$;

create or replace function app.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = app.current_user_id()
  );
$$;

create or replace function app.workspace_role(target_workspace uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.workspace_members
  where workspace_id = target_workspace
    and user_id = app.current_user_id()
  limit 1;
$$;

create or replace function app.is_workspace_admin(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(app.workspace_role(target_workspace) in ('owner', 'admin'), false);
$$;

create or replace function app.is_workspace_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.workspace_role(target_workspace) = 'owner';
$$;

revoke all on function app.current_user_id() from public;
revoke all on function app.is_workspace_member(uuid) from public;
revoke all on function app.workspace_role(uuid) from public;
revoke all on function app.is_workspace_admin(uuid) from public;
revoke all on function app.is_workspace_owner(uuid) from public;
grant execute on function app.current_user_id() to authenticated, service_role;
grant execute on function app.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function app.workspace_role(uuid) to authenticated, service_role;
grant execute on function app.is_workspace_admin(uuid) to authenticated, service_role;
grant execute on function app.is_workspace_owner(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.instagram_accounts enable row level security;
alter table public.instagram_media enable row level security;
alter table public.resources enable row level security;
alter table public.resource_clicks enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_run_events enable row level security;
alter table public.usage_records enable row level security;
alter table public.audit_events enable row level security;
alter table public.oauth_states enable row level security;
alter table public.webhook_events enable row level security;
alter table public.automation_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- Base grants: nothing by default; add back only what the browser may read.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema app to authenticated, service_role;

grant usage on schema public to anon, authenticated;
grant select on public.plans to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select on public.instagram_accounts to authenticated;
grant select on public.instagram_media to authenticated;
grant select, insert, update, delete on public.resources to authenticated;
grant select on public.resource_clicks to authenticated;
grant select, insert, update, delete on public.automation_rules to authenticated;
grant select on public.automation_runs to authenticated;
grant select on public.automation_run_events to authenticated;
grant select on public.usage_records to authenticated;
grant select on public.audit_events to authenticated;

-- Token columns must never be readable by browser roles. PostgREST enforces
-- column privileges, so selecting * on instagram_accounts fails closed.
revoke all on public.instagram_accounts from authenticated;
grant select (
  id, workspace_id, ig_user_id, username, account_type, scopes,
  token_expires_at, status, last_error_code, last_error_at,
  webhook_subscribed_at, disconnected_at, created_at, updated_at
) on public.instagram_accounts to authenticated;

-- Service role (server) is allowed to do everything; RLS does not apply to
-- BYPASSRLS roles, but explicit grants keep PostgREST access consistent.
grant usage on schema public to service_role;
grant usage on schema app to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = app.current_user_id()
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = app.current_user_id()
        and theirs.user_id = public.profiles.id
    )
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = app.current_user_id());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

-- No delete policy: profile rows are removed by the auth.users cascade.

-- ---------------------------------------------------------------------------
-- plans (read-only catalogue)
-- ---------------------------------------------------------------------------
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated using (app.is_workspace_member(id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert to authenticated with check (created_by = app.current_user_id());

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (app.is_workspace_admin(id))
  with check (app.is_workspace_admin(id));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
  for delete to authenticated using (app.is_workspace_owner(id));

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (app.is_workspace_admin(workspace_id) and role <> 'owner');

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (app.is_workspace_admin(workspace_id) and role <> 'owner')
  with check (app.is_workspace_admin(workspace_id) and role <> 'owner');

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (app.is_workspace_admin(workspace_id) and role <> 'owner');

-- ---------------------------------------------------------------------------
-- instagram_accounts (tokens excluded by column grants above)
-- ---------------------------------------------------------------------------
drop policy if exists instagram_accounts_select on public.instagram_accounts;
create policy instagram_accounts_select on public.instagram_accounts
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists instagram_accounts_insert on public.instagram_accounts;
create policy instagram_accounts_insert on public.instagram_accounts
  for insert to authenticated with check (app.is_workspace_admin(workspace_id));

drop policy if exists instagram_accounts_update on public.instagram_accounts;
create policy instagram_accounts_update on public.instagram_accounts
  for update to authenticated
  using (app.is_workspace_admin(workspace_id))
  with check (app.is_workspace_admin(workspace_id));

drop policy if exists instagram_accounts_delete on public.instagram_accounts;
create policy instagram_accounts_delete on public.instagram_accounts
  for delete to authenticated using (app.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- instagram_media (read for members; writes come from the server)
-- ---------------------------------------------------------------------------
drop policy if exists instagram_media_select on public.instagram_media;
create policy instagram_media_select on public.instagram_media
  for select to authenticated using (app.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- resources
-- ---------------------------------------------------------------------------
drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists resources_insert on public.resources;
create policy resources_insert on public.resources
  for insert to authenticated with check (app.is_workspace_member(workspace_id));

drop policy if exists resources_update on public.resources;
create policy resources_update on public.resources
  for update to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (app.is_workspace_member(workspace_id));

drop policy if exists resources_delete on public.resources;
create policy resources_delete on public.resources
  for delete to authenticated using (app.is_workspace_admin(workspace_id));

drop policy if exists resource_clicks_select on public.resource_clicks;
create policy resource_clicks_select on public.resource_clicks
  for select to authenticated using (app.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- automation_rules
-- ---------------------------------------------------------------------------
drop policy if exists automation_rules_select on public.automation_rules;
create policy automation_rules_select on public.automation_rules
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists automation_rules_insert on public.automation_rules;
create policy automation_rules_insert on public.automation_rules
  for insert to authenticated with check (app.is_workspace_member(workspace_id));

drop policy if exists automation_rules_update on public.automation_rules;
create policy automation_rules_update on public.automation_rules
  for update to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (app.is_workspace_member(workspace_id));

drop policy if exists automation_rules_delete on public.automation_rules;
create policy automation_rules_delete on public.automation_rules
  for delete to authenticated using (app.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Read-only observability for members. Writes are server-only.
-- ---------------------------------------------------------------------------
drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists automation_run_events_select on public.automation_run_events;
create policy automation_run_events_select on public.automation_run_events
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists usage_records_select on public.usage_records;
create policy usage_records_select on public.usage_records
  for select to authenticated using (app.is_workspace_member(workspace_id));

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated using (app.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Server-only tables (oauth_states, webhook_events, automation_jobs) have RLS
-- enabled and no grants/policies for anon or authenticated.
-- ---------------------------------------------------------------------------
