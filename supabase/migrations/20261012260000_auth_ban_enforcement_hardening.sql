-- =====================================================================
-- F-19b (High): the Auth ban could be silently lost, and reinstatement was too broad.
--
-- Review of 20261012220000 against the REAL GoTrue schema (supabase/auth
-- migrations: auth.users.id uuid, auth.sessions.user_id uuid,
-- auth.refresh_tokens.user_id varchar(255), banned_until timestamptz) found:
--  * The column types are compatible with the old statements, so there is no
--    type error. BUT set_auth_ban() ran the ban UPDATE and both DELETEs inside
--    ONE exception block. If any later step failed (e.g. permission denied on
--    auth.refresh_tokens) PostgreSQL rolled back the whole block, INCLUDING the
--    banned_until update, and the function only emitted a server-log WARNING:
--    apply_account_restriction() returned success, public.users said
--    'suspended', yet the auth user could still sign in and refresh.
--    Reproduced with a failing trigger on auth.refresh_tokens.
--  * apply/lift called set_auth_ban() directly, so a suspension made any other
--    way (dashboard SQL, service role) never banned the auth user.
--  * lift_account_restriction() lifted ANY restriction id and, when the user had
--    no other ACTIVE full_suspension row, set account_status = 'active' and
--    cleared the ban -- so lifting an unrelated restriction (e.g. posting_disabled)
--    reinstated an account that had been suspended without a full_suspension row,
--    and an 'appealed' (still restricting) suspension was ignored.
--
-- Fix:
--  1. set_auth_ban() returns text and never raises; the ban UPDATE is its own
--     step so it persists even if session cleanup fails; every step is verified
--     afterwards. Result: 'ok' | 'no_auth_user' | 'failed: <details>'.
--  2. A trigger on public.users (AFTER UPDATE OF account_status) is the single
--     choke point: becoming suspended/deactivated bans; leaving those states
--     unbans ONLY IF no active/appealed, unexpired full_suspension remains.
--     Every suspension pathway therefore enforces the ban.
--  3. The outcome is recorded in public.account_auth_enforcement (admin-readable)
--     and, on failure, in audit_logs ('user.auth_ban_failed') plus a WARNING.
--     The database-level denial (20261012150000) applies regardless, so a failed
--     ban never leaves data access open; it leaves the LOGIN open until fixed.
--  4. list_suspended_accounts_not_banned() (platform admins) reconciles
--     suspended accounts against Auth, and reapply_account_auth_ban(uid) retries.
--  5. apply no longer calls set_auth_ban directly; lift only changes account
--     status when the lifted restriction IS a full_suspension and no other
--     active/appealed, unexpired full_suspension remains.
--
-- ROLLBACK: drop trigger trg_enforce_account_auth_ban on public.users, drop the
-- two admin functions and public.account_auth_enforcement; re-apply the apply/lift
-- bodies from 20261012220000 and set_auth_ban(varchar, boolean) returning void.
-- =====================================================================
-- return type changes void -> text, so the old function must be dropped first
-- (apply/lift, which called it, are re-created further down in this same migration)
drop function if exists public.set_auth_ban(varchar, boolean);
create function public.set_auth_ban(p_uid varchar, p_ban boolean)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_errors text[] := '{}';
  v_rows integer;
  v_left integer;
begin
  -- 1. the ban itself, independent of any session clean-up
  begin
    update auth.users
    set banned_until = case when p_ban then 'infinity'::timestamptz else null end
    where id = p_uid::uuid;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return 'no_auth_user';
    end if;
  exception when others then
    v_errors := v_errors || ('ban: ' || sqlerrm);
  end;

  if p_ban then
    -- 2. revoke existing sessions (refresh tokens cascade) and any session-less tokens
    begin
      delete from auth.sessions where user_id = p_uid::uuid;
    exception when others then
      v_errors := v_errors || ('sessions: ' || sqlerrm);
    end;
    begin
      delete from auth.refresh_tokens where user_id = p_uid;
    exception when others then
      v_errors := v_errors || ('refresh_tokens: ' || sqlerrm);
    end;
  end if;

  -- 3. verify the end state instead of trusting the statements
  begin
    if p_ban then
      if not exists (select 1 from auth.users where id = p_uid::uuid and banned_until is not null and banned_until > now()) then
        v_errors := v_errors || 'verify: banned_until is not in effect';
      end if;
      select (select count(*) from auth.sessions where user_id = p_uid::uuid)
           + (select count(*) from auth.refresh_tokens where user_id = p_uid) into v_left;
      if v_left > 0 then
        v_errors := v_errors || ('verify: ' || v_left || ' session/refresh-token row(s) remain');
      end if;
    elsif exists (select 1 from auth.users where id = p_uid::uuid and banned_until is not null) then
      v_errors := v_errors || 'verify: banned_until was not cleared';
    end if;
  exception when others then
    v_errors := v_errors || ('verify: ' || sqlerrm);
  end;

  if array_length(v_errors, 1) is null then
    return 'ok';
  end if;
  return 'failed: ' || array_to_string(v_errors, '; ');
end;
$$;
revoke all on function public.set_auth_ban(varchar, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- enforcement record (platform admins can read it; nobody can write it from a client)
-- ---------------------------------------------------------------------
create table if not exists public.account_auth_enforcement (
  user_id varchar primary key,
  status text not null check (status in ('applied', 'failed', 'no_auth_user', 'cleared', 'cleared_failed')),
  detail text,
  updated_at timestamptz not null default now()
);
alter table public.account_auth_enforcement enable row level security;
revoke all on table public.account_auth_enforcement from anon, authenticated;
grant select on table public.account_auth_enforcement to authenticated;
drop policy if exists "Platform admins can read auth enforcement records" on public.account_auth_enforcement;
create policy "Platform admins can read auth enforcement records" on public.account_auth_enforcement
  for select to authenticated using (public.is_platform_admin(auth.uid()::varchar));
drop policy if exists "restrict_suspended_accounts" on public.account_auth_enforcement;
create policy "restrict_suspended_accounts" on public.account_auth_enforcement as restrictive for all to authenticated
  using ((select not public.current_account_suspended())) with check ((select not public.current_account_suspended()));

-- ---------------------------------------------------------------------
-- single choke point: ban / unban whenever account_status changes
-- ---------------------------------------------------------------------
create or replace function public.enforce_account_auth_ban()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_was boolean := old.account_status in ('suspended', 'deactivated');
  v_is boolean := new.account_status in ('suspended', 'deactivated');
  v_result text;
  v_status text;
begin
  if v_is and not v_was then
    v_result := public.set_auth_ban(new.id, true);
    v_status := case when v_result = 'ok' then 'applied' when v_result = 'no_auth_user' then 'no_auth_user' else 'failed' end;
  elsif v_was and not v_is then
    -- another active/appealed, unexpired full_suspension keeps the account banned
    if exists (
      select 1 from public.account_restrictions r
      where r.user_id = new.id and r.restriction_type = 'full_suspension'
        and r.status in ('active', 'appealed') and (r.expires_at is null or r.expires_at > now())
    ) then
      return new;
    end if;
    v_result := public.set_auth_ban(new.id, false);
    v_status := case when v_result in ('ok', 'no_auth_user') then 'cleared' else 'cleared_failed' end;
  else
    return new;
  end if;

  insert into public.account_auth_enforcement (user_id, status, detail, updated_at)
  values (new.id, v_status, v_result, now())
  on conflict (user_id) do update set status = excluded.status, detail = excluded.detail, updated_at = now();

  if v_status in ('failed', 'cleared_failed') then
    insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
    values ('auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            null, 'user.auth_ban_failed', 'user', new.id,
            jsonb_build_object('operation', case when v_is then 'ban' else 'unban' end, 'result', v_result));
    raise warning 'account auth enforcement failed for %: %', new.id, v_result;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_account_auth_ban() from public, anon, authenticated;

drop trigger if exists trg_enforce_account_auth_ban on public.users;
create trigger trg_enforce_account_auth_ban
  after update of account_status on public.users
  for each row when (old.account_status is distinct from new.account_status)
  execute function public.enforce_account_auth_ban();

-- ---------------------------------------------------------------------
-- apply / lift: remove the direct set_auth_ban calls, tighten reinstatement
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.apply_account_restriction(character varying, character varying, character varying, text, timestamp with time zone)'::regprocedure) into v_def;
  v_new := replace(v_def, E'\n    perform public.set_auth_ban(p_target_user_id, true);', '');
  if v_new = v_def and position('set_auth_ban' in v_def) > 0 then
    raise exception 'apply_account_restriction layout not recognised';
  end if;
  execute v_new;

  select pg_get_functiondef('public.lift_account_restriction(character varying)'::regprocedure) into v_def;
  if position('v_restriction.restriction_type = ''full_suspension''' in v_def) > 0 then
    return;  -- already patched (idempotent re-run)
  end if;
  v_new := replace(v_def,
    E'  select count(*) into v_still_active_others\n  from public.account_restrictions\n  where user_id = v_restriction.user_id and restriction_type = ''full_suspension'' and status = ''active'';\n\n  if v_still_active_others = 0 then\n    update public.users set account_status = ''active'' where id = v_restriction.user_id and account_status = ''suspended'';\n    perform public.set_auth_ban(v_restriction.user_id, false);\n  end if;',
    E'  -- Only lifting a full_suspension can reinstate the account, and only when no other\n  -- active/appealed, unexpired full_suspension remains. (The auth ban is cleared by the\n  -- enforce_account_auth_ban trigger on the status change.)\n  select count(*) into v_still_active_others\n  from public.account_restrictions\n  where user_id = v_restriction.user_id and restriction_type = ''full_suspension''\n    and status in (''active'', ''appealed'') and (expires_at is null or expires_at > now());\n\n  if v_restriction.restriction_type = ''full_suspension'' and v_still_active_others = 0 then\n    update public.users set account_status = ''active'' where id = v_restriction.user_id and account_status = ''suspended'';\n  end if;');
  if v_new = v_def then
    raise exception 'lift_account_restriction layout not recognised';
  end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------
-- detective + corrective controls for platform administrators
-- ---------------------------------------------------------------------
create or replace function public.list_suspended_accounts_not_banned()
returns table (user_id varchar, email varchar, account_status varchar, enforcement_status text,
               enforcement_detail text, banned_until timestamptz, live_sessions bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
  perform public.assert_account_active();
  if auth.uid() is null or not public.is_platform_admin(auth.uid()::varchar) then
    raise exception 'Only platform administrators may run this report.' using errcode = '42501';
  end if;
  return query
    select u.id, u.email, u.account_status, e.status, e.detail, au.banned_until,
           (select count(*) from auth.sessions s where s.user_id = au.id)
    from public.users u
    join auth.users au on au.id::varchar = u.id
    left join public.account_auth_enforcement e on e.user_id = u.id
    where u.account_status in ('suspended', 'deactivated')
      and (au.banned_until is null or au.banned_until <= now()
           or exists (select 1 from auth.sessions s where s.user_id = au.id)
           or coalesce(e.status, '') = 'failed');
end;
$$;

create or replace function public.reapply_account_auth_ban(p_user_id varchar)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_result text;
begin
  perform public.assert_account_active();
  if auth.uid() is null or not public.is_platform_admin(auth.uid()::varchar) then
    raise exception 'Only platform administrators may re-apply an authentication ban.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and account_status in ('suspended', 'deactivated')) then
    raise exception 'Account % is not suspended.', p_user_id using errcode = '22023';
  end if;
  v_result := public.set_auth_ban(p_user_id, true);
  insert into public.account_auth_enforcement (user_id, status, detail, updated_at)
  values (p_user_id, case when v_result = 'ok' then 'applied' when v_result = 'no_auth_user' then 'no_auth_user' else 'failed' end, v_result, now())
  on conflict (user_id) do update set status = excluded.status, detail = excluded.detail, updated_at = now();
  return v_result;
end;
$$;

revoke all on function public.list_suspended_accounts_not_banned() from public, anon;
revoke all on function public.reapply_account_auth_ban(varchar) from public, anon;
grant execute on function public.list_suspended_accounts_not_banned() to authenticated;
grant execute on function public.reapply_account_auth_ban(varchar) to authenticated;
