-- Free basic job + optional paid promotion (Boost $3 / Featured $5 / Premium $10).
--
--   * The first active job on the Free plan is FREE and publishes immediately.
--     Nothing here changes that: org_has_publish_quota() already allows it.
--   * The $3/$5/$10 plans are now OPTIONAL PROMOTIONS, not posting fees:
--       Boost    ($3)  "Boosted" badge, ranks above basic listings        30 days
--       Featured ($5)  "Featured" badge, ranks above Boost and basic      30 days
--       Premium  ($10) "Premium" badge, top placement above everything    45 days
--     (An over-limit job still needs one of them to go live, as before.)
--   * Plan ids are unchanged; plan-vacancy-basic becomes "Boost".
--   * Promotions expire by themselves (checked when listings are read); the
--     vacancy is never deleted or unpublished when its promotion ends.
--   * Rejecting a promotion payment no longer takes a live free job offline.
-- Prices are unchanged from 20261008100000. Safe to re-run.

alter table public.opportunities add column if not exists promotion_level varchar(10);
alter table public.opportunities add column if not exists promotion_until timestamptz;
alter table public.opportunities drop constraint if exists opportunities_promotion_level_check;
alter table public.opportunities add constraint opportunities_promotion_level_check
    check (promotion_level is null or promotion_level in ('boost', 'featured', 'premium'));

-- rename the $3 level basic -> boost
alter table public.payment_plans drop constraint if exists payment_plans_promotion_level_check;
update public.payment_plans set promotion_level = 'boost' where promotion_level = 'basic';
alter table public.payment_plans add constraint payment_plans_promotion_level_check
    check (promotion_level is null or promotion_level in ('boost', 'featured', 'premium'));

update public.payment_plans set
    name = 'Boost',
    description = 'Optional visibility boost: a Boosted badge and better placement than basic listings.',
    features = '["Boosted badge", "Ranks above basic listings", "30 days"]'::jsonb,
    promotion_level = 'boost',
    updated_at = now()
 where id = 'plan-vacancy-basic';
update public.payment_plans set
    name = 'Featured',
    description = 'Stronger visibility: a Featured badge and placement above boosted and basic listings.',
    features = '["Featured badge", "Ranks above Boost and basic listings", "30 days"]'::jsonb,
    promotion_level = 'featured',
    updated_at = now()
 where id = 'plan-vacancy-featured';
update public.payment_plans set
    name = 'Premium',
    description = 'Maximum visibility for one vacancy: a Premium badge and top placement above all other listings.',
    features = '["Premium badge", "Top placement above all other listings", "45 days"]'::jsonb,
    promotion_level = 'premium',
    updated_at = now()
 where id = 'plan-vacancy-premium';

-- Promotion columns are not client-writable (extends guard_opportunity_promotion()).
create or replace function public.guard_opportunity_promotion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_tier varchar;
    v_max integer;
    v_count integer;
    v_period_end timestamptz;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null or public.is_platform_admin(v_uid) then
        return new;  -- service role / platform admin (incl. admin_review_payment)
    end if;

    -- Paid promotion and boost are never set by the owner.
    if tg_op = 'INSERT' then
        new.boosted_until := null;
        new.featured_until := null;
        new.promotion_level := null;
        new.promotion_until := null;
    else
        new.boosted_until := old.boosted_until;
        new.featured_until := old.featured_until;
        new.promotion_level := old.promotion_level;
        new.promotion_until := old.promotion_until;
    end if;

    if new.is_featured is true and (tg_op = 'INSERT' or old.is_featured is distinct from true) then
        v_tier := public.org_effective_tier(new.organization_id);
        select l.max_featured into v_max from public.tier_limits(v_tier) l;
        select count(*) into v_count
        from public.opportunities o
        where o.organization_id = new.organization_id
          and o.is_featured is true
          and (o.featured_until is null or o.featured_until > now())
          and o.id <> new.id;
        if v_max <= 0 or v_count >= v_max then
            raise exception 'Featuring a vacancy needs a plan with a free featured slot, or the Featured/Premium promotion.'
                using errcode = 'P0402';
        end if;
        select s.current_period_end into v_period_end
        from public.organization_subscriptions s where s.organization_id = new.organization_id;
        new.featured_until := v_period_end;
    elsif new.is_featured is not true then
        new.featured_until := null;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_guard_opportunity_promotion on public.opportunities;
create trigger trg_guard_opportunity_promotion
    before insert or update of is_featured, featured_until, boosted_until, promotion_level, promotion_until on public.opportunities
    for each row execute function public.guard_opportunity_promotion();

-- admin_review_payment(): same as 20261008100000 plus the promotion handling above.
create or replace function public.admin_review_payment(
    p_payment_id varchar,
    p_decision varchar, -- 'approve' | 'reject'
    p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_cur_level varchar;
    v_cur_until timestamptz;
    v_rank_new integer;
    v_rank_cur integer;
    v_uid varchar;
    v_payment public.payments;
    v_plan public.payment_plans;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null or not public.is_platform_admin(v_uid) then
        raise exception 'You do not have permission to review payments.' using errcode = '42501';
    end if;
    if p_decision not in ('approve', 'reject') then
        raise exception 'Invalid decision: must be approve or reject.' using errcode = '22023';
    end if;

    select * into v_payment from public.payments where id = p_payment_id for update;
    if v_payment is null then
        raise exception 'Payment not found.' using errcode = 'P0002';
    end if;
    if v_payment.status <> 'payment_pending' then
        raise exception 'Only payments awaiting review can be approved or rejected (current status: %).', v_payment.status using errcode = 'P0001';
    end if;

    select * into v_plan from public.payment_plans where id = v_payment.plan_id;

    if p_decision = 'approve' then
        update public.payments
        set status = 'payment_success',
            paid_at = now(),
            reviewed_by_user_id = v_uid,
            reviewed_at = now(),
            metadata = metadata || jsonb_build_object('review_notes', p_notes),
            updated_at = now()
        where id = p_payment_id
        returning * into v_payment;

        if v_plan.plan_type = 'subscription' then
            insert into public.organization_subscriptions (
                id, organization_id, plan_id, tier, status, billing_cycle,
                current_period_start, current_period_end, cancel_at_period_end
            )
            values (
                'osub-' || replace(extensions.uuid_generate_v4()::text, '-', ''),
                v_payment.organization_id, v_plan.id, v_plan.subscription_tier, 'active', v_plan.billing_cycle,
                now(), now() + make_interval(days => v_plan.duration_days), false
            )
            on conflict (organization_id) do update set
                current_period_start = case
                    when organization_subscriptions.tier = excluded.tier
                         and organization_subscriptions.status = 'active'
                         and organization_subscriptions.current_period_end > now()
                    then organization_subscriptions.current_period_start
                    else now() end,
                current_period_end = case
                    when organization_subscriptions.tier = excluded.tier
                         and organization_subscriptions.status = 'active'
                         and organization_subscriptions.current_period_end > now()
                    then organization_subscriptions.current_period_end + make_interval(days => v_plan.duration_days)
                    else now() + make_interval(days => v_plan.duration_days) end,
                plan_id = excluded.plan_id,
                tier = excluded.tier,
                status = 'active',
                billing_cycle = excluded.billing_cycle,
                cancel_at_period_end = false,
                updated_at = now();
        elsif v_payment.opportunity_id is not null then
            -- Vacancy payment. Two cases, both handled here:
            --  * the vacancy was waiting on payment (over the free limit):
            --    approval publishes it, as before;
            --  * the vacancy is ALREADY live as a free Basic post and the payer
            --    bought a promotion: nothing is republished, the promotion is
            --    simply switched on.
            -- Promotion is time-limited (plan duration_days) and is checked at
            -- read time, so it lapses on its own back to a normal listing.
            -- Only this function (platform admin) can set these columns; see
            -- guard_opportunity_promotion().
            select o.promotion_level, o.promotion_until
              into v_cur_level, v_cur_until
              from public.opportunities o
             where o.id = v_payment.opportunity_id
             for update;

            v_rank_new := case v_plan.promotion_level when 'premium' then 3 when 'featured' then 2 when 'boost' then 1 else 0 end;
            v_rank_cur := case when v_cur_until is not null and v_cur_until > now()
                               then case v_cur_level when 'premium' then 3 when 'featured' then 2 when 'boost' then 1 else 0 end
                               else 0 end;

            update public.opportunities
            set status = case when status in ('payment_required', 'payment_failed') then 'published' else status end,
                -- stronger (or new) promotion replaces; the same level renews;
                -- a weaker one never downgrades, it just adds time.
                promotion_level = case when v_rank_new >= v_rank_cur then v_plan.promotion_level else promotion_level end,
                promotion_until = case
                    when v_rank_new > v_rank_cur or v_rank_cur = 0 then now() + make_interval(days => v_plan.duration_days)
                    else promotion_until + make_interval(days => v_plan.duration_days) end,
                is_featured = case when v_rank_new >= 2 then true else is_featured end,
                featured_until = case when v_rank_new >= 2 then now() + make_interval(days => v_plan.duration_days) else featured_until end,
                boosted_until = case when v_rank_new = 3 then now() + make_interval(days => v_plan.duration_days) else boosted_until end,
                updated_at = now()
            where id = v_payment.opportunity_id;
        end if;
    else
        update public.payments
        set status = 'payment_failed',
            failure_reason = coalesce(p_notes, 'Payment could not be verified by the platform.'),
            reviewed_by_user_id = v_uid,
            reviewed_at = now(),
            updated_at = now()
        where id = p_payment_id
        returning * into v_payment;

        if v_plan.plan_type = 'vacancy' and v_payment.opportunity_id is not null then
            -- Only a vacancy that was WAITING on this payment is marked failed.
            -- A live free Basic post whose promotion payment is rejected stays live.
            update public.opportunities
            set status = 'payment_failed', updated_at = now()
            where id = v_payment.opportunity_id
              and status = 'payment_required';
        end if;
    end if;

    return v_payment;
end;
$$;

revoke all on function public.admin_review_payment(varchar, varchar, text) from public, anon;
grant execute on function public.admin_review_payment(varchar, varchar, text) to authenticated;
