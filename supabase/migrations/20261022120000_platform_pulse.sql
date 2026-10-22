-- Public "Platform Pulse" figures for the Discover sidebar -- real database aggregates, no hardcoded numbers.
--
-- Returns ONLY aggregate counts/sums and the headline of the single most recent live opportunity, so it is
-- safe for anon + authenticated callers. SECURITY DEFINER is needed because RLS would otherwise make each
-- visitor see a different (under-)count based on their own memberships.
--
-- Definitions:
--   verified_candidates : active job_seeker accounts with a verified email
--   open_tenders        : published + moderation-approved opportunities of type 'tender' that have not passed their deadline
--   ma_asset_value_usd  : sum of asking prices of live (published + moderation-approved) business listings
--   counties_active     : distinct counties with a live opportunity, a live business listing or a registered organization
--   latest_opportunity  : newest live opportunity (title, type, county, employer)
-- Idempotent.

create or replace function public.get_platform_pulse()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'verified_candidates', (
      select count(*) from public.users u
      where u.primary_role = 'job_seeker' and u.is_email_verified is true
        and coalesce(u.account_status, 'active') = 'active'
    ),
    'open_tenders', (
      select count(*) from public.opportunities o
      where o.opportunity_type = 'tender' and o.status = 'published' and o.moderation_status = 'published'
        and (o.application_deadline is null or o.application_deadline > now())
    ),
    'ma_asset_value_usd', (
      select coalesce(sum(b.asking_price_usd), 0) from public.business_listings b
      where b.status = 'published' and b.moderation_status = 'published'
    ),
    'counties_active', (
      select count(distinct county) from (
        select o.county from public.opportunities o
          where o.status = 'published' and o.moderation_status = 'published'
        union
        select b.county from public.business_listings b
          where b.status = 'published' and b.moderation_status = 'published'
        union
        select g.county from public.organizations g
      ) c where county is not null
    ),
    'latest_opportunity', (
      select jsonb_build_object(
        'title', o.title, 'type', o.opportunity_type, 'county', o.county,
        'organization', g.name, 'published_at', o.created_at)
      from public.opportunities o
      left join public.organizations g on g.id = o.organization_id
      where o.status = 'published' and o.moderation_status = 'published'
        and (o.application_deadline is null or o.application_deadline > now())
      order by o.created_at desc
      limit 1
    ),
    'generated_at', now()
  );
$$;

revoke all on function public.get_platform_pulse() from public;
grant execute on function public.get_platform_pulse() to anon, authenticated;
