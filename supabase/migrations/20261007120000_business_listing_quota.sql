-- Business-listing quota, enforced in the database (mirrors the recruiter
-- vacancy limit). Limits per plan: free = 1, basic (Starter) = 5, pro = unlimited.
-- KEEP IN SYNC with src/data/subscriptionPlans.ts (maxActiveListings).

create or replace function public.owner_listing_limit(p_owner_id varchar)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
    -- Best plan across the organizations the seller owns/administers.
    -- No organization, no subscription, or a lapsed paid plan => free limit (1).
    select coalesce(max(
        case
            when s.organization_id is null then 1
            when s.status not in ('active', 'trialing') then 1
            when s.tier <> 'free' and s.current_period_end < now() then 1
            when s.tier = 'pro' then 2147483647
            when s.tier = 'basic' then 5
            else 1
        end
    ), 1)
    from public.organization_memberships m
    left join public.organization_subscriptions s on s.organization_id = m.organization_id
    where m.user_id = p_owner_id
      and m.status = 'active'
      and (m.org_role in ('owner', 'admin') or m.permissions ? 'all');
$$;

create or replace function public.enforce_business_listing_quota()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_limit integer;
    v_count integer;
begin
    -- Only gate a listing becoming published (new, or moving into 'published').
    if new.status is distinct from 'published' then
        return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'published' then
        return new;  -- already live: never re-gate existing listings
    end if;

    v_uid := auth.uid()::varchar;
    if v_uid is null then
        return new;  -- trusted server-side contexts (service role)
    end if;
    if public.is_platform_admin(v_uid) then
        return new;  -- platform admins are exempt
    end if;
    if v_uid <> new.owner_user_id then
        return new;  -- staff acting on someone else's listing (moderation) is not blocked
    end if;

    v_limit := public.owner_listing_limit(new.owner_user_id);

    select count(*) into v_count
    from public.business_listings b
    where b.owner_user_id = new.owner_user_id
      and b.status = 'published'
      and b.id <> new.id;

    if v_count >= v_limit then
        raise exception 'Your plan allows % active business listing(s). Upgrade your subscription to list more.', v_limit
            using errcode = 'P0403';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_enforce_business_listing_quota on public.business_listings;
create trigger trg_enforce_business_listing_quota
    before insert or update of status on public.business_listings
    for each row execute function public.enforce_business_listing_quota();
