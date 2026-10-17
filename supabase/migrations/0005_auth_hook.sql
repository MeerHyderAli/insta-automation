-- 0005_auth_hook.sql
-- Optional convenience trigger: create a profile row whenever Supabase Auth
-- creates a user. The API also upserts a profile on first request, so this is
-- not required for correctness. It is skipped when auth.users is unavailable
-- (for example in local PGlite test databases).

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    execute $fn$
      create or replace function public.handle_new_auth_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $body$
      begin
        insert into public.profiles (id, email)
        values (new.id, new.email)
        on conflict (id) do update set email = excluded.email;
        return new;
      end;
      $body$;
    $fn$;

    execute 'drop trigger if exists on_auth_user_created on auth.users';
    execute 'create trigger on_auth_user_created after insert on auth.users
             for each row execute function public.handle_new_auth_user()';
  end if;
end;
$$;
