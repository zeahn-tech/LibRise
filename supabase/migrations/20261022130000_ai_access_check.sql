-- Server-side enforcement of the "AI tools" plan entitlement.
--
-- The employer AI endpoints (candidate matching, job-description drafting, scam shield) are a Pro-plan benefit.
-- Until now that was only hidden in the browser, so a signed-in user could call the endpoints directly. The
-- Express server now asks this function, with the caller's own token, before running them.
--
-- Rule (mirrors canUseAI in src/data/subscriptionPlans.ts and org_effective_tier()):
--   platform admins, OR an active member of any organization whose effective tier is 'pro'
--   (an expired or non-active subscription counts as free).
-- Idempotent.

create or replace function public.my_ai_access()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    public.is_platform_admin(auth.uid()::varchar)
    or exists (
      select 1
      from public.organization_memberships m
      where m.user_id = auth.uid()::varchar
        and m.status = 'active'
        and public.org_effective_tier(m.organization_id) = 'pro'
    );
$$;

revoke all on function public.my_ai_access() from public, anon;
grant execute on function public.my_ai_access() to authenticated;
