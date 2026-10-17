-- Tenant isolation test suite for a real Supabase database.
--
-- Run against a disposable Supabase project or a local Supabase stack:
--   supabase db reset && psql "$DATABASE_URL" -f supabase/tests/rls.test.sql
--
-- The same isolation guarantees are covered automatically without Docker by
-- server/test/db/tenant-isolation.test.ts (PGlite). This SQL suite is the
-- end-to-end check that the RLS policies behave the same on Supabase.
--
-- Every check raises an exception on failure, so psql exits non-zero.

begin;

create temp table _test_ids (key text primary key, value uuid) on commit drop;

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000a001', 'rls-a@example.test'),
  ('00000000-0000-4000-8000-00000000b001', 'rls-b@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, email)
values
  ('00000000-0000-4000-8000-00000000a001', 'rls-a@example.test'),
  ('00000000-0000-4000-8000-00000000b001', 'rls-b@example.test')
on conflict (id) do update set email = excluded.email;

-- Workspaces owned by each user (created with the service role).
insert into public.workspaces (id, name, slug, plan_id, created_by)
values ('00000000-0000-4000-8000-00000000a0f1', 'RLS Workspace A', 'rls-ws-a', 'free',
        '00000000-0000-4000-8000-00000000a001')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug, plan_id, created_by)
values ('00000000-0000-4000-8000-00000000b0f1', 'RLS Workspace B', 'rls-ws-b', 'free',
        '00000000-0000-4000-8000-00000000b001')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('00000000-0000-4000-8000-00000000a0f1', '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-00000000b001', 'owner')
on conflict do nothing;

insert into public.resources (id, workspace_id, title, url, slug)
values ('00000000-0000-4000-8000-00000000a0c1', '00000000-0000-4000-8000-00000000a0f1',
        'Secret A', 'https://example.com/a', 'rls-resource-a')
on conflict (id) do nothing;

-- Pretend to be user A.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000a001', 'role', 'authenticated')::text,
  true);
set local role authenticated;

do $$
declare
  visible integer;
begin
  select count(*) into visible from public.workspaces;
  if visible <> 1 then
    raise exception 'RLS: user A sees % workspaces, expected 1', visible;
  end if;

  select count(*) into visible
  from public.workspaces where id = '00000000-0000-4000-8000-00000000b0f1';
  if visible <> 0 then
    raise exception 'RLS: user A can read workspace B';
  end if;

  select count(*) into visible from public.resources;
  if visible <> 1 then
    raise exception 'RLS: user A sees % resources, expected 1', visible;
  end if;

  update public.resources set title = 'hacked'
  where id = '00000000-0000-4000-8000-00000000a0c1';
  if found then
    raise exception 'RLS: browser role was able to update a resource directly (expected: no write grants beyond rule/resource CRUD policies)';
  end if;
end;
$$;

-- User A tries to read token columns: column privileges must deny it.
do $$
begin
  begin
    perform token_ciphertext from public.instagram_accounts limit 1;
    raise exception 'GRANTS: token_ciphertext is readable by authenticated';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
