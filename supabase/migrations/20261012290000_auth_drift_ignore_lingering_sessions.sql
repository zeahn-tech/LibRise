-- =====================================================================
-- F-29 (Medium): a correctly banned account was reported as "unenforced" forever.
--
-- list_auth_enforcement_drift() (20261012280000) and list_suspended_accounts_not_banned()
-- (20261012260000) treated ANY remaining auth.sessions row as drift for an account that
-- should be banned. But the supported enforcement path -- Auth Admin API
-- PUT /admin/users/{id} {ban_duration} -- only sets auth.users.banned_until. Reading the
-- GoTrue source (supabase/auth, internal/api/admin.go): that handler never deletes
-- sessions or refresh tokens (the only admin session deletion is hard user deletion), and
-- there is no admin endpoint to delete another user's sessions. A successfully banned
-- account therefore normally KEEPS its auth.sessions / auth.refresh_tokens rows (GoTrue
-- refuses to use them: tokens/service.go "Invalid Refresh Token: User Banned"; token.go
-- password grant; auth.go/middleware.go reject a banned user's pre-ban access token on
-- GoTrue's own endpoints). The old report therefore re-listed such accounts on every run,
-- and the sync route re-applied the same ban each time.
--
-- Fix: for desired = 'ban', drift now means
--     the ban is missing or expired        (banned_until null or in the past), OR
--     the last enforcement attempt failed   (account_auth_enforcement.status = 'failed').
-- Remaining session rows are reported in live_sessions for information only. Missing/
-- expired bans, failed bans, failed unbans (cleared_failed) and "previously banned account
-- that should be reinstated" are all still detected. NOTHING here relaxes database access
-- control: is_account_suspended()/assert_account_active()/the restrictive RLS policies are
-- untouched, so a suspended account (including one holding an access token issued before the
-- ban) is still denied every protected table and RPC. Remaining limitation: an access token
-- keeps validating against services that only check the JWT (PostgREST signature + exp,
-- Realtime, Storage) until it expires (GOTRUE_JWT_EXP, default 3600 s); the database
-- policies are what deny it for LibRise data.
--
-- ROLLBACK: re-apply the function bodies of 20261012280000 / 20261012260000.
-- =====================================================================
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
      -- ban wanted: missing/expired ban, or the last attempt failed. Session rows are NOT drift.
      (d.desired = 'ban' and (au.banned_until is null or au.banned_until <= now()
                              or coalesce(e.status, '') = 'failed'))
      or
      -- only accounts LibRise itself banned are ever auto-unbanned (never an operator's manual ban)
      (d.desired = 'unban' and au.banned_until is not null and au.banned_until > now()
                           and coalesce(e.status, '') in ('applied', 'failed', 'cleared_failed'));
end;
$$;
revoke all on function public.list_auth_enforcement_drift() from public, anon;
grant execute on function public.list_auth_enforcement_drift() to authenticated;

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
      and (au.banned_until is null or au.banned_until <= now() or coalesce(e.status, '') = 'failed');
end;
$$;
revoke all on function public.list_suspended_accounts_not_banned() from public, anon;
grant execute on function public.list_suspended_accounts_not_banned() to authenticated;
