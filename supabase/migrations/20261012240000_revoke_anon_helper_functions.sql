-- =====================================================================
-- F-20 (Low): anonymous callers could invoke internal SECURITY DEFINER
-- helpers with arbitrary arguments, turning them into boolean oracles:
--   is_platform_admin(<user id>)               -> is this user an administrator?
--   candidate_has_applied_to_org(<cand>,<org>) -> did this candidate apply there?
--   is_org_member / is_org_admin / has_org_permission / is_conversation_participant /
--   is_user_blocked / has_business_access / owner_listing_limit / org_has_publish_quota
--   expire_payment_if_stale                    -> never needed by anonymous callers
-- (PostgreSQL grants EXECUTE to PUBLIC by default, which is how `anon` got them.)
--
-- EXECUTE is revoked from PUBLIC and anon (REVOKE ... FROM anon alone would be a
-- no-op while the default PUBLIC grant exists) and granted explicitly to
-- authenticated and service_role, because the
-- RLS policies evaluate these helpers as the signed-in caller; no policy that
-- applies to `anon` calls them (verified: all suites and the anonymous
-- PostgREST checks pass). Remaining anon-executable functions are the
-- intentionally public ones: list_business_listings_public,
-- get_business_listing_public, record_opportunity_view, priority_organization_ids,
-- org_effective_tier (public tier badge), tier_limits and the pure normalize_*.
-- Signed-in callers can still probe these helpers; closing that needs the
-- self-only wrapper redesign used for the account-status helpers (20261012190000)
-- for each of them and is tracked as an open Low finding.
--
-- ROLLBACK: GRANT EXECUTE ON FUNCTION <each> TO anon (or PUBLIC).
-- =====================================================================
revoke execute on function public.is_platform_admin(varchar) from public, anon;
grant execute on function public.is_platform_admin(varchar) to authenticated, service_role;
revoke execute on function public.candidate_has_applied_to_org(varchar, varchar) from public, anon;
grant execute on function public.candidate_has_applied_to_org(varchar, varchar) to authenticated, service_role;
revoke execute on function public.is_org_member(varchar) from public, anon;
grant execute on function public.is_org_member(varchar) to authenticated, service_role;
revoke execute on function public.is_org_admin(varchar) from public, anon;
grant execute on function public.is_org_admin(varchar) to authenticated, service_role;
revoke execute on function public.has_org_permission(varchar, text) from public, anon;
grant execute on function public.has_org_permission(varchar, text) to authenticated, service_role;
revoke execute on function public.is_conversation_participant(varchar, varchar) from public, anon;
grant execute on function public.is_conversation_participant(varchar, varchar) to authenticated, service_role;
revoke execute on function public.is_user_blocked(varchar, varchar) from public, anon;
grant execute on function public.is_user_blocked(varchar, varchar) to authenticated, service_role;
revoke execute on function public.has_business_access(varchar, varchar) from public, anon;
grant execute on function public.has_business_access(varchar, varchar) to authenticated, service_role;
revoke execute on function public.owner_listing_limit(varchar) from public, anon;
grant execute on function public.owner_listing_limit(varchar) to authenticated, service_role;
revoke execute on function public.org_has_publish_quota(varchar) from public, anon;
grant execute on function public.org_has_publish_quota(varchar) to authenticated, service_role;
revoke execute on function public.expire_payment_if_stale(varchar) from public, anon;
grant execute on function public.expire_payment_if_stale(varchar) to authenticated, service_role;
