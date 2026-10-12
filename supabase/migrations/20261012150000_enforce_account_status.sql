-- =====================================================================
-- F-16 (P0/High): suspended accounts were not restricted by the database.
--
-- apply_account_restriction('full_suspension') only sets users.account_status
-- = 'suspended'. Nothing in RLS or in the client-callable SECURITY DEFINER
-- RPCs looked at it (the RLS matrix recorded this as a "CRITICAL FINDING":
-- a suspended user could still write via direct API calls, and the
-- per-action restrictions posting/messaging/applications/deal_room were
-- enforced only by the TypeScript client).
--
-- Intended behaviour (docs/TRUST_AND_SAFETY.md section 6):
--   active / pending_verification : normal.
--   suspended / deactivated        : "disables login" -> NO table or RPC access
--       except (a) reading their own users row and their own restriction rows
--       (so the app can show why), and (b) signing out. There is no appeal
--       write path in the schema (account_restrictions.appeal_notes has no
--       writer), so none is preserved; add an explicit allow-listed RPC when
--       one is built.
--   posting_disabled / applications_disabled / messaging_disabled /
--   deal_room_disabled             : the matching INSERT is denied.
--
-- Mechanism (no existing policy is edited):
--   1. helper functions is_account_suspended / has_active_restriction /
--      assert_account_active (SECURITY DEFINER, fixed search_path)
--   2. a RESTRICTIVE policy "restrict_suspended_accounts" on every
--      RLS-enabled public table (ANDed with the existing PERMISSIVE
--      policies; applies to the `authenticated` role only)
--   3. RESTRICTIVE INSERT policies for the per-action restrictions
--   4. an assert_account_active() call injected as the first statement of the
--      client-callable plpgsql RPCs (they bypass RLS as SECURITY DEFINER)
-- is_account_suspended() also honours an ACTIVE full_suspension restriction
-- row, so deleting one's own public.users row (a DELETE policy exists) cannot
-- lift a suspension.
--
-- Known limits: a suspended user's JWT stays valid until it expires -- also
-- ban the auth user (auth.users.banned_until / revoke sessions) in the
-- Supabase dashboard or admin API; Storage and Realtime are not covered here.
--
-- ROLLBACK (tested): drop every policy named restrict_* (the DO block above
-- shows the table list), then neutralise the RPC guards without rewriting the 21
-- functions:  CREATE OR REPLACE FUNCTION public.assert_account_active(p_action
-- varchar DEFAULT NULL) RETURNS void ... BEGIN RETURN; END;  The helper functions
-- can then stay. No data is modified by this migration or by its rollback.
-- =====================================================================

create or replace function public.is_account_suspended(p_uid varchar default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(p_uid, auth.uid()::varchar) is not null and (
    exists (
      select 1 from public.users u
      where u.id = coalesce(p_uid, auth.uid()::varchar)
        and u.account_status in ('suspended', 'deactivated')
    )
    or exists (
      select 1 from public.account_restrictions r
      where r.user_id = coalesce(p_uid, auth.uid()::varchar)
        and r.restriction_type = 'full_suspension'
        and r.status in ('active', 'appealed')
        and (r.expires_at is null or r.expires_at > now())
    )
  );
$$;

create or replace function public.has_active_restriction(p_uid varchar, p_type varchar)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_uid is not null and exists (
    select 1 from public.account_restrictions r
    where r.user_id = p_uid
      and r.restriction_type = p_type
      and r.status in ('active', 'appealed')
      and (r.expires_at is null or r.expires_at > now())
  );
$$;

create or replace function public.assert_account_active(p_action varchar default null)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    return;  -- anonymous callers are governed by the function's own checks
  end if;
  if public.is_account_suspended(auth.uid()::varchar) then
    raise exception 'This account is suspended.' using errcode = '42501';
  end if;
  if p_action is not null and public.has_active_restriction(auth.uid()::varchar, p_action) then
    raise exception 'This action is restricted for your account (%).', p_action using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.is_account_suspended(varchar) from public, anon;
revoke all on function public.has_active_restriction(varchar, varchar) from public, anon;
revoke all on function public.assert_account_active(varchar) from public, anon;
grant execute on function public.is_account_suspended(varchar) to authenticated;
grant execute on function public.has_active_restriction(varchar, varchar) to authenticated;
grant execute on function public.assert_account_active(varchar) to authenticated;

-- ---------------------------------------------------------------------
-- 2. RESTRICTIVE policy on every RLS-enabled public table
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('users', 'account_restrictions')
  loop
    execute format('drop policy if exists "restrict_suspended_accounts" on public.%I', t);
    execute format(
      'create policy "restrict_suspended_accounts" on public.%I as restrictive for all to authenticated '
      'using ((select not public.is_account_suspended())) with check ((select not public.is_account_suspended()))', t);
  end loop;
end $$;

-- users: a suspended account may still READ its own row (status display) but not change or delete it.
drop policy if exists "restrict_suspended_accounts_update" on public.users;
create policy "restrict_suspended_accounts_update" on public.users as restrictive for update to authenticated
  using ((select not public.is_account_suspended())) with check ((select not public.is_account_suspended()));
drop policy if exists "restrict_suspended_accounts_delete" on public.users;
create policy "restrict_suspended_accounts_delete" on public.users as restrictive for delete to authenticated
  using ((select not public.is_account_suspended()));
drop policy if exists "restrict_suspended_accounts_insert" on public.users;
create policy "restrict_suspended_accounts_insert" on public.users as restrictive for insert to authenticated
  with check ((select not public.is_account_suspended()));

-- ---------------------------------------------------------------------
-- 3. Per-action restrictions (INSERT only)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
      ('opportunities',          'posting_disabled'),
      ('business_listings',      'posting_disabled'),
      ('applications',           'applications_disabled'),
      ('direct_messages',        'messaging_disabled'),
      ('business_inquiries',     'messaging_disabled'),
      ('business_access_requests','deal_room_disabled')
    ) as v(tbl, rtype)
  loop
    execute format('drop policy if exists %I on public.%I', 'restrict_action_' || r.rtype, r.tbl);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      'with check ((select not public.has_active_restriction(auth.uid()::varchar, %L)))',
      'restrict_action_' || r.rtype, r.tbl, r.rtype);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. RPC guard: first statement of each client-callable plpgsql RPC.
--    pg_get_functiondef() round-trips owner-less definition, SECURITY DEFINER,
--    search_path and body exactly; CREATE OR REPLACE keeps existing grants.
--    Idempotent: functions already guarded are skipped. Fails loudly if the
--    body layout is not as expected (never silently skips a function).
-- ---------------------------------------------------------------------
do $$
declare
  f record;
  v_def text;
  v_new text;
  v_action text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and l.lanname = 'plpgsql'
      and p.proname in (
        'accept_organization_invitation', 'admin_review_payment', 'apply_account_restriction',
        'cancel_subscription', 'create_conversation_with_participants', 'create_organization_with_owner',
        'decide_verification_audit', 'find_user_by_email', 'get_conversation_participant_profiles',
        'get_organization_member_profiles', 'get_platform_analytics', 'get_public_candidate_profile',
        'lift_account_restriction', 'refresh_open_payment', 'resolve_content_report',
        'resume_subscription', 'review_verification_request', 'search_candidate_profiles',
        'submit_content_report', 'submit_payment_reference', 'switch_payment_provider')
  loop
    v_def := pg_get_functiondef(f.oid);
    if position('assert_account_active' in v_def) > 0 then
      continue;
    end if;
    v_action := case f.proname when 'create_conversation_with_participants' then '''messaging_disabled''' else '' end;
    v_new := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform public.assert_account_active(' || v_action || E');\n');
    if v_new = v_def then
      raise exception 'Could not inject the account-status guard into public.%', f.proname;
    end if;
    execute v_new;
  end loop;
end $$;
