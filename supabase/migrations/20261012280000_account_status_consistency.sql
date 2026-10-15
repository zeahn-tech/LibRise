-- =====================================================================
-- F-28 (High): account status, restriction records and the Auth ban could disagree.
--
-- Review of 20261012260000 found, and a reproduction confirmed:
--  1. enforce_account_auth_ban() is an AFTER trigger. For "suspended -> active while
--     another full_suspension is still active/appealed" it did `return new`, but an
--     AFTER trigger's return value cannot cancel the UPDATE: the account committed as
--     'active' while its full_suspension row was still 'active' and the ban stayed.
--  2. get_organization_private_fields() checked users.account_status only. For that
--     inconsistent account it returned private organization data even though
--     is_account_suspended() (restriction-aware, used by RLS) said "suspended".
--  3. A full_suspension row inserted/re-activated by any path other than
--     apply_account_restriction() (dashboard SQL, an appeal workflow) did not move
--     the account to 'suspended' and therefore never banned the auth user.
--
-- Fix (all enforced by the database, for every role including service_role):
--  * BEFORE UPDATE trigger on users: account_status cannot leave
--    suspended/deactivated (or be set to any non-suspended value) while a QUALIFYING
--    full_suspension exists -- status 'active' or 'appealed' and not expired. The only
--    way to reinstate is lift_account_restriction() on the last qualifying row (it
--    marks that row lifted first, then sets the status), which still works.
--  * AFTER trigger on account_restrictions: a qualifying full_suspension row forces
--    the account to 'suspended' (which fires the auth-ban trigger).
--  * enforce_account_auth_ban() now raises if the impossible state is ever reached
--    (defence in depth) instead of pretending to cancel the change.
--  * handle_auth_user_email_confirmed() no longer turns a suspended account's
--    pending_verification into 'active'.
--  * get_organization_private_fields() uses is_account_suspended() (status OR
--    restriction row). All other client-callable functions already use
--    assert_account_active() / is_account_suspended(); the remaining direct
--    readers of account_status (get_platform_analytics counts, signup/confirm
--    triggers, the admin ban tooling) do not gate access.
--  * list_auth_enforcement_drift() (platform admins) and record_auth_enforcement()
--    (service_role only) support the supported-API enforcement path used by the
--    Express backend (see src/server/authEnforcement.ts).
-- Existing rows are not modified.
--
-- ROLLBACK: drop trigger trg_00_guard_account_status_consistency on public.users and
-- trg_sync_status_on_full_suspension on public.account_restrictions; drop the
-- guard/sync/helper/drift/record functions; re-apply the bodies of
-- enforce_account_auth_ban (260000), handle_auth_user_email_confirmed (20260908120000)
-- and get_organization_private_fields (140000).
-- =====================================================================
create or replace function public.has_qualifying_full_suspension(p_uid varchar)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_uid is not null and exists (
    select 1 from public.account_restrictions r
    where r.user_id = p_uid and r.restriction_type = 'full_suspension'
      and r.status in ('active', 'appealed')
      and (r.expires_at is null or r.expires_at > now())
  );
$$;
revoke all on function public.has_qualifying_full_suspension(varchar) from public, anon, authenticated;
grant execute on function public.has_qualifying_full_suspension(varchar) to service_role;

create or replace function public.guard_account_status_consistency()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.account_status not in ('suspended', 'deactivated')
     and public.has_qualifying_full_suspension(new.id) then
    raise exception 'Account % still has an active or appealed full suspension; lift the restriction instead of changing the status.', new.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_account_status_consistency() from public, anon, authenticated;
drop trigger if exists trg_00_guard_account_status_consistency on public.users;
create trigger trg_00_guard_account_status_consistency
  before update of account_status on public.users
  for each row when (new.account_status not in ('suspended', 'deactivated'))
  execute function public.guard_account_status_consistency();

create or replace function public.sync_status_on_full_suspension()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.users set account_status = 'suspended'
  where id = new.user_id and account_status not in ('suspended', 'deactivated');
  return new;
end;
$$;
revoke all on function public.sync_status_on_full_suspension() from public, anon, authenticated;
drop trigger if exists trg_sync_status_on_full_suspension on public.account_restrictions;
create trigger trg_sync_status_on_full_suspension
  after insert or update of status, expires_at, restriction_type on public.account_restrictions
  for each row
  when (new.restriction_type = 'full_suspension' and new.status in ('active', 'appealed')
        and (new.expires_at is null or new.expires_at > now()))
  execute function public.sync_status_on_full_suspension();

-- the auth-ban trigger: leaving suspended while a qualifying suspension exists can no longer happen
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
    if public.has_qualifying_full_suspension(new.id) then
      -- guard_account_status_consistency() makes this unreachable; never let it commit
      raise exception 'Account % cannot be reinstated while a full suspension is active or appealed.', new.id using errcode = '23514';
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

create or replace function public.handle_auth_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.users
    set is_email_verified = true,
        account_status = case
          when account_status = 'pending_verification' and not public.has_qualifying_full_suspension(new.id::varchar) then 'active'
          else account_status end
    where id = new.id::varchar;
  end if;
  return new;
end;
$$;

create or replace function public.get_organization_private_fields(p_org_ids character varying[])
returns table (id varchar, settings jsonb, registration_number varchar, tax_id_number varchar, contact_email varchar, contact_phone varchar)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select o.id, o.settings, o.registration_number, o.tax_id_number, o.contact_email, o.contact_phone
  from public.organizations o
  where o.id = any (p_org_ids)
    and auth.uid() is not null
    and not public.is_account_suspended(auth.uid()::varchar)
    and (
      public.is_platform_admin(auth.uid()::varchar)
      or exists (
        select 1 from public.organization_memberships m
        where m.organization_id = o.id and m.user_id = auth.uid()::varchar and m.status = 'active'
      )
    );
$$;
revoke all on function public.get_organization_private_fields(varchar[]) from public, anon;
grant execute on function public.get_organization_private_fields(varchar[]) to authenticated;

-- ---------------------------------------------------------------------
-- supported-API enforcement support (used by the Express backend)
-- ---------------------------------------------------------------------
create or replace function public.list_auth_enforcement_drift()
returns table (user_id varchar, email varchar, desired text, account_status varchar,
               auth_banned_until timestamptz, live_sessions bigint, enforcement_status text, enforcement_detail text)
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
    select u.id, u.email, d.desired, u.account_status, au.banned_until,
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
      (d.desired = 'ban' and (au.banned_until is null or au.banned_until <= now()
                              or exists (select 1 from auth.sessions s where s.user_id = au.id)
                              or coalesce(e.status, '') in ('failed')))
      or
      -- only accounts LibRise itself banned are ever auto-unbanned (never an operator's manual ban)
      (d.desired = 'unban' and au.banned_until is not null and au.banned_until > now()
                           and coalesce(e.status, '') in ('applied', 'failed', 'cleared_failed'));
end;
$$;
revoke all on function public.list_auth_enforcement_drift() from public, anon;
grant execute on function public.list_auth_enforcement_drift() to authenticated;

create or replace function public.record_auth_enforcement(p_user_id varchar, p_status text, p_detail text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_status not in ('applied', 'failed', 'cleared', 'cleared_failed') then
    raise exception 'invalid enforcement status %', p_status using errcode = '22023';
  end if;
  insert into public.account_auth_enforcement (user_id, status, detail, updated_at)
  values (p_user_id, p_status, p_detail, now())
  on conflict (user_id) do update set status = excluded.status, detail = excluded.detail, updated_at = now();
  if p_status in ('failed', 'cleared_failed') then
    insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
    values ('auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            null, 'user.auth_ban_failed', 'user', p_user_id,
            jsonb_build_object('operation', 'admin_api', 'result', p_detail));
  end if;
end;
$$;
revoke all on function public.record_auth_enforcement(varchar, text, text) from public, anon, authenticated;
grant execute on function public.record_auth_enforcement(varchar, text, text) to service_role;
