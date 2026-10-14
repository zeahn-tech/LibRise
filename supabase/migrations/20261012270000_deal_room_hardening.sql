-- =====================================================================
-- F-24b: remaining deal-room paths, and information-disclosure helpers.
--
-- Intended deal-room policy (no document sets one; this is the most
-- conservative behaviour consistent with legitimate ownership):
--   buyer, active, no approval        -> confidential fields withheld
--   buyer, approved + NDA signed      -> full listing
--   buyer with deal_room_disabled     -> withheld; cannot request access; cannot
--                                        sign an NDA / change a request
--   buyer suspended/deactivated       -> treated as anonymous (RLS + RPC)
--   owner, active                     -> full own listing; approves/declines requests
--   owner suspended/deactivated       -> treated as anonymous (RLS + RPC)
--   owner with deal_room_disabled     -> still sees and manages their own listing
--                                        (edit/unpublish), but cannot approve or
--                                        decline access requests (new grants frozen);
--                                        buyers approved earlier keep access
--                                        (AMBIGUOUS: revoking them is a product decision)
--   platform admin                    -> no confidential read path exists today and
--                                        none is added (unchanged)
--
-- (1) a RESTRICTIVE UPDATE policy on business_access_requests freezes
--     approve/decline/NDA-signing for anyone with an active deal_room_disabled
--     restriction (20261012150000 only restricted INSERT).
-- (2) has_business_access, candidate_has_applied_to_org, is_user_blocked,
--     org_has_publish_quota and owner_listing_limit are used only by SECURITY
--     DEFINER code (verified: no policy, invoker function, trigger-invoker or
--     client RPC call references them), yet were executable by every signed-in
--     user with arbitrary arguments, i.e. "does user X have deal-room access to
--     listing Y / apply to org Z / block user W" oracles. EXECUTE is revoked from
--     PUBLIC/anon/authenticated (service_role keeps it); the definer functions that
--     call them run as the function owner and are unaffected.
-- Still executable by signed-in users because policies need them: is_platform_admin(uid),
-- is_conversation_participant(conv, uid) (residual Low).
--
-- ROLLBACK: drop policy "restrict_action_deal_room_update" on public.business_access_requests;
-- GRANT EXECUTE ON FUNCTION <the five> TO authenticated.
-- =====================================================================
drop policy if exists "restrict_action_deal_room_update" on public.business_access_requests;
create policy "restrict_action_deal_room_update" on public.business_access_requests as restrictive for update to authenticated
  using ((select not public.current_has_restriction('deal_room_disabled')))
  with check ((select not public.current_has_restriction('deal_room_disabled')));

revoke execute on function public.has_business_access(varchar, varchar) from public, anon, authenticated;
revoke execute on function public.candidate_has_applied_to_org(varchar, varchar) from public, anon, authenticated;
revoke execute on function public.is_user_blocked(varchar, varchar) from public, anon, authenticated;
revoke execute on function public.org_has_publish_quota(varchar) from public, anon, authenticated;
revoke execute on function public.owner_listing_limit(varchar) from public, anon, authenticated;
grant execute on function public.has_business_access(varchar, varchar) to service_role;
grant execute on function public.candidate_has_applied_to_org(varchar, varchar) to service_role;
grant execute on function public.is_user_blocked(varchar, varchar) to service_role;
grant execute on function public.org_has_publish_quota(varchar) to service_role;
grant execute on function public.owner_listing_limit(varchar) to service_role;
