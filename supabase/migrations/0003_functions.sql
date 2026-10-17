-- 0003_functions.sql
-- Atomic quota accounting + maintenance helpers. All functions are
-- service-role only; the API never lets a browser call them directly.

create or replace function app.increment_usage(
  p_workspace_id uuid,
  p_metric text,
  p_amount integer,
  p_limit integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quantity integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'usage amount must be positive';
  end if;

  insert into public.usage_records (workspace_id, period_start, metric, quantity)
  select
    p_workspace_id,
    date_trunc('month', now())::date,
    p_metric,
    p_amount
  where p_limit is null or p_amount <= p_limit
  on conflict (workspace_id, period_start, metric)
  do update set
    quantity = public.usage_records.quantity + excluded.quantity,
    updated_at = now()
  where p_limit is null
     or public.usage_records.quantity + excluded.quantity <= p_limit
  returning quantity into v_quantity;

  -- NULL means the limit would have been exceeded; callers must not perform
  -- the metered action in that case.
  return v_quantity;
end;
$$;

create or replace function app.release_usage(
  p_workspace_id uuid,
  p_metric text,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quantity integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'release amount must be positive';
  end if;

  update public.usage_records
  set quantity = greatest(0, quantity - p_amount), updated_at = now()
  where workspace_id = p_workspace_id
    and period_start = date_trunc('month', now())::date
    and metric = p_metric
  returning quantity into v_quantity;

  return coalesce(v_quantity, 0);
end;
$$;

-- Deletes webhook payloads older than the retention window but keeps the
-- denormalized counters already written to usage_records.
create or replace function app.cleanup_webhook_events(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.webhook_events
  where received_at < now() - make_interval(days => greatest(1, p_retention_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function app.cleanup_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.oauth_states
  where expires_at < now() - interval '1 hour'
     or consumed_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function app.increment_usage(uuid, text, integer, integer) from public;
revoke all on function app.release_usage(uuid, text, integer) from public;
revoke all on function app.cleanup_webhook_events(integer) from public;
revoke all on function app.cleanup_oauth_states() from public;
grant execute on function app.increment_usage(uuid, text, integer, integer) to service_role;
grant execute on function app.release_usage(uuid, text, integer) to service_role;
grant execute on function app.cleanup_webhook_events(integer) to service_role;
grant execute on function app.cleanup_oauth_states() to service_role;
