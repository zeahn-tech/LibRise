-- 1. Real vacancy analytics, 2. Pro priority visibility, 3. plan cancellation.
-- Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Analytics counters that actually work
--    * views_count was incremented by a client-side UPDATE that row-level
--      security refuses for nearly every viewer, so it barely moved.
--    * applications_count was never maintained by anything (always 0).
-- ---------------------------------------------------------------------

-- One view per call; the app calls it once per browser session per vacancy.
-- Members of the posting organization (the employer looking at their own job)
-- are not counted, and only published vacancies count.
create or replace function public.record_opportunity_view(p_opportunity_id varchar)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    update public.opportunities o
       set views_count = coalesce(o.views_count, 0) + 1
     where o.id = p_opportunity_id
       and o.status = 'published'
       and not (
           auth.uid() is not null
           and exists (
               select 1 from public.organization_memberships m
                where m.organization_id = o.organization_id
                  and m.user_id = auth.uid()::varchar
                  and m.status = 'active'
           )
       );
end;
$$;
revoke all on function public.record_opportunity_view(varchar) from public;
grant execute on function public.record_opportunity_view(varchar) to anon, authenticated;

create or replace function public.maintain_opportunity_applications_count()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    if tg_op = 'INSERT' then
        update public.opportunities
           set applications_count = coalesce(applications_count, 0) + 1
         where id = new.opportunity_id;
    elsif tg_op = 'DELETE' then
        update public.opportunities
           set applications_count = greatest(coalesce(applications_count, 0) - 1, 0)
         where id = old.opportunity_id;
    end if;
    return null;
end;
$$;

drop trigger if exists trg_applications_count on public.applications;
create trigger trg_applications_count
    after insert or delete on public.applications
    for each row execute function public.maintain_opportunity_applications_count();

-- one-time backfill so existing vacancies show the true number
update public.opportunities o
   set applications_count = (select count(*) from public.applications a where a.opportunity_id = o.id);

-- ---------------------------------------------------------------------
-- 2. Pro "priority visibility": organizations whose effective plan is Pro
--    rank above ordinary listings (below paid Boost/Featured/Premium).
--    Returns only organization ids, and lapses with the subscription.
-- ---------------------------------------------------------------------
create or replace function public.priority_organization_ids()
returns setof varchar
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
    select s.organization_id::varchar
      from public.organization_subscriptions s
     where public.org_effective_tier(s.organization_id) = 'pro';
$$;
revoke all on function public.priority_organization_ids() from public;
grant execute on function public.priority_organization_ids() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Cancellation. Payments are manual and prepaid, so nothing renews by
--    itself; "cancel" therefore means one of two honest things:
--      * at period end (default): keep what you paid for, flagged to end;
--      * immediately: drop to Free now (no refund).
--    Data is never deleted. Paying again (renewal) restores the paid plan:
--    admin_review_payment() sets status 'active' and clears the flag.
-- ---------------------------------------------------------------------
create or replace function public.cancel_subscription(p_organization_id varchar, p_immediate boolean default false)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_sub public.organization_subscriptions;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;
    if not (public.is_platform_admin(v_uid) or public.has_org_permission(p_organization_id, 'payments.manage')) then
        raise exception 'You do not have permission to change this subscription.' using errcode = '42501';
    end if;

    select * into v_sub from public.organization_subscriptions
     where organization_id = p_organization_id for update;
    if not found or public.org_effective_tier(p_organization_id) = 'free' then
        raise exception 'There is no active paid plan to cancel.' using errcode = 'P0001';
    end if;

    update public.organization_subscriptions
       set cancel_at_period_end = true,
           status = case when p_immediate then 'canceled' else status end,
           updated_at = now()
     where organization_id = p_organization_id
     returning * into v_sub;
    return v_sub;
end;
$$;
revoke all on function public.cancel_subscription(varchar, boolean) from public, anon;
grant execute on function public.cancel_subscription(varchar, boolean) to authenticated;

-- Undo a scheduled cancellation while the paid period is still running.
create or replace function public.resume_subscription(p_organization_id varchar)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_sub public.organization_subscriptions;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;
    if not (public.is_platform_admin(v_uid) or public.has_org_permission(p_organization_id, 'payments.manage')) then
        raise exception 'You do not have permission to change this subscription.' using errcode = '42501';
    end if;

    update public.organization_subscriptions
       set cancel_at_period_end = false, updated_at = now()
     where organization_id = p_organization_id
       and status = 'active'
       and current_period_end > now()
     returning * into v_sub;
    if not found then
        raise exception 'This plan can no longer be resumed. Renew it instead.' using errcode = 'P0001';
    end if;
    return v_sub;
end;
$$;
revoke all on function public.resume_subscription(varchar) from public, anon;
grant execute on function public.resume_subscription(varchar) to authenticated;
