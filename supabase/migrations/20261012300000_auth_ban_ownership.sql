-- =====================================================================
-- F-30 (High): LibRise could remove an operator's manual Supabase ban.
--
-- account_auth_enforcement.status says what LibRise TRIED, not who owns the ban that
-- currently exists. Reproduced on 20261012290000:
--  1. list_auth_enforcement_drift() selected for automatic UNBAN any active account with an
--     effective ban and a record in ('applied','failed','cleared_failed'). A 'failed' record
--     (a failed ban attempt) proves nothing about ownership: an operator-banned active account
--     was listed desired=unban, and the server would have cleared the operator's ban.
--  2. set_auth_ban(true) overwrote an existing ban with 'infinity', and the status-change
--     trigger cleared banned_until unconditionally on reinstatement, so a manual ban in place
--     when an account was suspended was destroyed when it was reinstated.
--
-- The existing schema cannot tell the two apart, so this migration records ownership
-- explicitly: account_auth_enforcement.imposed_banned_until = the exact banned_until value
-- LibRise wrote. LibRise treats a ban as its own ONLY while auth.users.banned_until is
-- exactly equal to that recorded value.
--   * Banning never overwrites a ban that is already in effect (set_auth_ban only writes when
--     there is none or it expired). If one is in effect the account is banned either way and
--     no ownership is claimed (imposed_banned_until stays NULL). If that ban later expires
--     while the account is still suspended, drift reports it and LibRise imposes (and owns) its own.
--   * Unbanning (status trigger and Admin-API sync) happens only when the current value equals
--     the recorded one. Otherwise the ban is left in place and the record says so.
--   * The drift report selects an account for automatic unban ONLY under that same equality
--     (and a status of applied / failed / cleared_failed); a record alone is never enough.
--   * list_auth_manual_review() (platform admins) lists bans on accounts that should not be
--     banned but that LibRise does not own (manual bans, and any pre-existing record with no
--     ownership value, e.g. created by an earlier build): LibRise will never remove these.
-- Values are compared at millisecond precision (JSON round trips drop microseconds).
-- Residual limitation: ownership is "the value LibRise wrote". An operator who writes exactly
-- that value (e.g. 'infinity' through SQL) is indistinguishable. Dashboard/Admin-API bans carry
-- a unique now()+duration timestamp and cannot collide.
-- No existing row is modified (the new column is NULL for old records = "not LibRise's").
--
-- ROLLBACK: re-apply the bodies from 20261012280000/290000 (set_auth_ban from 260000);
-- drop list_auth_manual_review, apply_account_auth_ban, clear_account_auth_ban,
-- auth_banned_until, same_ban_instant; alter table public.account_auth_enforcement drop column imposed_banned_until.
-- =====================================================================
alter table public.account_auth_enforcement add column if not exists imposed_banned_until timestamptz;
comment on column public.account_auth_enforcement.imposed_banned_until is
  'The exact auth.users.banned_until value LibRise wrote. NULL = LibRise owns no ban for this account. LibRise only ever clears a ban whose current value equals this.';

create or replace function public.auth_banned_until(p_uid varchar)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
  return (select banned_until from auth.users where id = p_uid::uuid);
exception when others then
  return null;
end;
$$;
revoke all on function public.auth_banned_until(varchar) from public, anon, authenticated;

-- Ownership is "the value LibRise wrote". A value that travelled through an API/JSON round trip may
-- lose sub-millisecond precision (Postgres stores microseconds; JavaScript dates hold milliseconds),
-- so ban values are compared at millisecond precision. ('infinity' = 'infinity'.)
create or replace function public.same_ban_instant(a timestamptz, b timestamptz)
returns boolean
language sql
immutable
set search_path to 'pg_temp'
as $$
  select a is not null and b is not null and date_trunc('milliseconds', a) = date_trunc('milliseconds', b);
$$;
revoke all on function public.same_ban_instant(timestamptz, timestamptz) from public, anon;
grant execute on function public.same_ban_instant(timestamptz, timestamptz) to authenticated, service_role;

-- the SQL ban never overwrites a ban that is already in effect
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
  begin
    if p_ban then
      update auth.users set banned_until = 'infinity'::timestamptz
      where id = p_uid::uuid and (banned_until is null or banned_until <= now());
    else
      update auth.users set banned_until = null where id = p_uid::uuid;
    end if;
    get diagnostics v_rows = row_count;
    if v_rows = 0 and not exists (select 1 from auth.users where id = p_uid::uuid) then
      return 'no_auth_user';
    end if;
  exception when others then
    v_errors := v_errors || ('ban: ' || sqlerrm);
  end;

  if p_ban then
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
-- internal helpers: ban / unban + ownership bookkeeping
-- ---------------------------------------------------------------------
create or replace function public.apply_account_auth_ban(p_uid varchar)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_prior timestamptz := public.auth_banned_until(p_uid);
  v_after timestamptz;
  v_old timestamptz;
  v_marker timestamptz;
  v_result text;
  v_status text;
begin
  v_result := public.set_auth_ban(p_uid, true);
  v_after := public.auth_banned_until(p_uid);
  select imposed_banned_until into v_old from public.account_auth_enforcement where user_id = p_uid;
  v_marker := case
    when (v_prior is null or v_prior <= now()) and v_after is not null and v_after > now() then v_after   -- LibRise imposed it
    when v_prior is not null and v_prior > now() and public.same_ban_instant(v_old, v_prior) then v_prior     -- already LibRise's
    else null                                                                                           -- someone else's ban, or none
  end;
  v_status := case when v_result = 'ok' then 'applied' when v_result = 'no_auth_user' then 'no_auth_user' else 'failed' end;

  insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until, updated_at)
  values (p_uid, v_status,
          case when v_result = 'ok' and v_marker is null then 'ban already in effect; not imposed by LibRise' else v_result end,
          v_marker, now())
  on conflict (user_id) do update
    set status = excluded.status, detail = excluded.detail, imposed_banned_until = excluded.imposed_banned_until, updated_at = now();

  if v_status = 'failed' then
    insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
    values ('auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), null,
            'user.auth_ban_failed', 'user', p_uid, jsonb_build_object('operation', 'ban', 'result', v_result));
    raise warning 'account auth enforcement failed for %: %', p_uid, v_result;
  end if;
  return v_result;
end;
$$;
revoke all on function public.apply_account_auth_ban(varchar) from public, anon, authenticated;

create or replace function public.clear_account_auth_ban(p_uid varchar)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_cur timestamptz := public.auth_banned_until(p_uid);
  v_old timestamptz;
  v_result text;
  v_status text;
  v_detail text;
  v_marker timestamptz;
begin
  select imposed_banned_until into v_old from public.account_auth_enforcement where user_id = p_uid;
  if public.same_ban_instant(v_cur, v_old) then
    v_result := public.set_auth_ban(p_uid, false);          -- the ban is LibRise's own: remove it
    v_status := case when v_result in ('ok', 'no_auth_user') then 'cleared' else 'cleared_failed' end;
    v_detail := v_result;
    v_marker := case when v_status = 'cleared' then null else v_old end;
  else
    v_result := 'ok';                                       -- nothing of LibRise's to remove
    v_status := 'cleared';
    v_detail := case when v_cur is not null and v_cur > now()
                     then 'a ban that LibRise did not impose was left in place'
                     else 'no LibRise-imposed ban to clear' end;
    v_marker := null;
  end if;

  insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until, updated_at)
  values (p_uid, v_status, v_detail, v_marker, now())
  on conflict (user_id) do update
    set status = excluded.status, detail = excluded.detail, imposed_banned_until = excluded.imposed_banned_until, updated_at = now();

  if v_status = 'cleared_failed' then
    insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
    values ('auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), null,
            'user.auth_ban_failed', 'user', p_uid, jsonb_build_object('operation', 'unban', 'result', v_result));
    raise warning 'account auth enforcement failed for %: %', p_uid, v_result;
  end if;
  return v_result;
end;
$$;
revoke all on function public.clear_account_auth_ban(varchar) from public, anon, authenticated;

create or replace function public.enforce_account_auth_ban()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_was boolean := old.account_status in ('suspended', 'deactivated');
  v_is boolean := new.account_status in ('suspended', 'deactivated');
begin
  if v_is and not v_was then
    perform public.apply_account_auth_ban(new.id);
  elsif v_was and not v_is then
    if public.has_qualifying_full_suspension(new.id) then
      raise exception 'Account % cannot be reinstated while a full suspension is active or appealed.', new.id using errcode = '23514';
    end if;
    perform public.clear_account_auth_ban(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_account_auth_ban() from public, anon, authenticated;

create or replace function public.reapply_account_auth_ban(p_user_id varchar)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
  perform public.assert_account_active();
  if auth.uid() is null or not public.is_platform_admin(auth.uid()::varchar) then
    raise exception 'Only platform administrators may re-apply an authentication ban.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and account_status in ('suspended', 'deactivated')) then
    raise exception 'Account % is not suspended.', p_user_id using errcode = '22023';
  end if;
  return public.apply_account_auth_ban(p_user_id);
end;
$$;
revoke all on function public.reapply_account_auth_ban(varchar) from public, anon;
grant execute on function public.reapply_account_auth_ban(varchar) to authenticated;

-- ---------------------------------------------------------------------
-- supported-API path: the server reports what it did, including whether LibRise imposed the ban
-- ---------------------------------------------------------------------
drop function if exists public.record_auth_enforcement(varchar, text, text);
drop function if exists public.record_auth_enforcement(varchar, text, text, timestamptz);   -- idempotent re-run
create function public.record_auth_enforcement(p_user_id varchar, p_status text, p_detail text, p_imposed_banned_until timestamptz default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old timestamptz;
  v_marker timestamptz;
begin
  if p_status not in ('applied', 'failed', 'cleared', 'cleared_failed') then
    raise exception 'invalid enforcement status %', p_status using errcode = '22023';
  end if;
  select imposed_banned_until into v_old from public.account_auth_enforcement where user_id = p_user_id;
  v_marker := case p_status
    when 'applied' then p_imposed_banned_until                 -- NULL = a ban was in effect that LibRise did not impose
    when 'cleared' then null
    else coalesce(p_imposed_banned_until, v_old)               -- failed / cleared_failed: keep what LibRise owns
  end;
  insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until, updated_at)
  values (p_user_id, p_status, p_detail, v_marker, now())
  on conflict (user_id) do update
    set status = excluded.status, detail = excluded.detail, imposed_banned_until = excluded.imposed_banned_until, updated_at = now();
  if p_status in ('failed', 'cleared_failed') then
    insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
    values ('auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), null,
            'user.auth_ban_failed', 'user', p_user_id, jsonb_build_object('operation', 'admin_api', 'result', p_detail));
  end if;
end;
$$;
revoke all on function public.record_auth_enforcement(varchar, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_auth_enforcement(varchar, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- reports (platform administrators)
-- ---------------------------------------------------------------------
drop function if exists public.list_auth_enforcement_drift();
create function public.list_auth_enforcement_drift()
returns table (user_id varchar, email varchar, desired text, account_status varchar,
               auth_banned_until timestamptz, imposed_banned_until timestamptz, live_sessions bigint,
               enforcement_status text, enforcement_detail text)
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
    select u.id, u.email, d.desired, u.account_status, au.banned_until, e.imposed_banned_until,
           (select count(*) from auth.sessions s where s.user_id = au.id),
           e.status, e.detail
    from public.users u
    join auth.users au on au.id::varchar = u.id
    left join public.account_auth_enforcement e on e.user_id = u.id
    cross join lateral (
      select case when u.account_status in ('suspended', 'deactivated') or public.has_qualifying_full_suspension(u.id)
                  then 'ban' else 'unban' end as desired
    ) d
    where
      -- ban wanted: missing/expired ban, or the last attempt failed. Session rows are NOT drift.
      (d.desired = 'ban' and (au.banned_until is null or au.banned_until <= now()
                              or coalesce(e.status, '') = 'failed'))
      or
      -- unban wanted: ONLY a ban LibRise itself imposed -- the current value must equal the
      -- value LibRise recorded. A record alone (whatever its status) is never enough.
      (d.desired = 'unban' and au.banned_until is not null and au.banned_until > now()
                           and public.same_ban_instant(au.banned_until, e.imposed_banned_until)
                           and coalesce(e.status, '') in ('applied', 'failed', 'cleared_failed'));
end;
$$;
revoke all on function public.list_auth_enforcement_drift() from public, anon;
grant execute on function public.list_auth_enforcement_drift() to authenticated;

create or replace function public.list_auth_manual_review()
returns table (user_id varchar, email varchar, account_status varchar, auth_banned_until timestamptz,
               imposed_banned_until timestamptz, enforcement_status text)
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
    select u.id, u.email, u.account_status, au.banned_until, e.imposed_banned_until, e.status
    from public.users u
    join auth.users au on au.id::varchar = u.id
    left join public.account_auth_enforcement e on e.user_id = u.id
    where u.account_status not in ('suspended', 'deactivated')
      and not public.has_qualifying_full_suspension(u.id)
      and au.banned_until is not null and au.banned_until > now()
      and not public.same_ban_instant(au.banned_until, e.imposed_banned_until);
end;
$$;
revoke all on function public.list_auth_manual_review() from public, anon;
grant execute on function public.list_auth_manual_review() to authenticated;
