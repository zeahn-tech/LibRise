-- =====================================================================
-- F-31 (Medium): privileged SECURITY DEFINER functions were executable by `anon` on a real
-- Supabase database.
--
-- Supabase grants EXECUTE on every new function in `public` to anon, authenticated and
-- service_role through default privileges. Older migrations only ran
-- `REVOKE ... FROM PUBLIC` (which removes the PostgreSQL default grant to PUBLIC but not those
-- explicit per-role grants), so on a real project these were callable by `anon`:
--   apply_account_restriction, lift_account_restriction, resolve_content_report,
--   decide_verification_audit, review_verification_request, get_platform_analytics,
--   create_organization_with_owner, create_conversation_with_participants, find_user_by_email,
--   get_conversation_participant_profiles, get_organization_member_profiles, submit_content_report.
-- Each refuses an unauthenticated caller internally, but an anonymous caller should not reach
-- them at all. Found by the CI pgTAP coverage test ("no other public function is executable by
-- anon"), which a local database without Supabase's default privileges could not show.
--
-- Fix:
--   * EXECUTE is revoked from PUBLIC and anon on every non-trigger function in `public` that is
--     not one of the intentionally public ones (get_business_listing_public,
--     list_business_listings_public, record_opportunity_view, priority_organization_ids,
--     org_effective_tier, tier_limits, normalize_momo_transaction_id, normalize_sender_phone).
--     authenticated / service_role grants are untouched, so signed-in use is unchanged.
--   * Default privileges for FUTURE functions created by the migration role no longer grant
--     EXECUTE to PUBLIC or anon: a new function is private to the roles it is explicitly granted
--     to. (Authors must GRANT deliberately; the coverage test fails if one is forgotten the
--     other way.)
-- Idempotent; no data is modified.
--
-- ROLLBACK: GRANT EXECUTE ON FUNCTION <each> TO anon;
--           ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, PUBLIC;
-- =====================================================================
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and p.proname not in (
        'get_business_listing_public', 'list_business_listings_public', 'record_opportunity_view',
        'priority_organization_ids', 'org_effective_tier', 'tier_limits',
        'normalize_momo_transaction_id', 'normalize_sender_phone')
      and (has_function_privilege('anon', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
