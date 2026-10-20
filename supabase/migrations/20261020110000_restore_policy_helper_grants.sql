-- Restore EXECUTE for the helper functions that row-level-security policies call.
--
-- Diagnosed from a live-database report: signed-in users could not execute
-- is_org_member(varchar) and is_org_admin(varchar). Policies on organization_memberships,
-- organizations-related tables, opportunities, applications, etc. evaluate those helpers AS THE
-- SIGNED-IN CALLER, so every read/write that touches them failed with
-- "permission denied for function is_org_member" (PostgREST 42501). Result: a workspace was
-- created (the SECURITY DEFINER RPC succeeded) but could not be read back, so employers saw no
-- organization, no Post button and no recruiter features.
-- Cause: 20261012240000_revoke_anon_helper_functions.sql (which grants these to authenticated) had
-- not taken effect on the live database, while the later revoke-from-PUBLIC migration had.
--
-- Intentionally NOT granted here (kept private on purpose by 20261012190000 / 20261012270000):
-- has_business_access, candidate_has_applied_to_org, is_user_blocked, org_has_publish_quota,
-- owner_listing_limit, is_account_suspended, has_active_restriction, and the auth-ban functions.
--
-- Idempotent. Only the named functions (every overload) are touched.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('is_org_member', 'is_org_admin', 'is_platform_admin',
                        'has_org_permission', 'is_conversation_participant')
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  -- Self-only wrappers that the restrictive account-status policies use.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('current_account_suspended', 'current_has_restriction')
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
