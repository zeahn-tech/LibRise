-- Pricing revision for the Liberian market.
--
--   Subscriptions : Starter $10/mo or $100/yr, Pro $25/mo or $250/yr
--   Pay-as-you-go : Basic $3, Featured $5, Premium/Boosted $10
--   Limits        : Free 1 job / Starter 10 / Pro 50 (no more "unlimited");
--                   business listings Free 1 / Starter 3 / Pro 10
--
-- Free is, and stays, a permanent plan: it is the ABSENCE of a paid
-- organization_subscriptions row, so it never expires. (The old "14-day
-- trial" wording only ever existed in UI copy.)
--
-- Prices are authoritative here (payment_plans); trg_payments_enforce_server_pricing
-- already overwrites any client-supplied amount with the plan's amount.
-- Existing plan ids are kept. Already-created payments keep the amount they
-- were quoted. Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.payment_plans add column if not exists promotion_level varchar(20);
alter table public.opportunities add column if not exists featured_until timestamptz;
alter table public.opportunities add column if not exists boosted_until timestamptz;

alter table public.payment_plans drop constraint if exists payment_plans_promotion_level_check;
alter table public.payment_plans add constraint payment_plans_promotion_level_check
    check (promotion_level is null or promotion_level in ('basic', 'featured', 'premium'));

-- ---------------------------------------------------------------------
-- 2. Prices (UPDATE in place, ids unchanged)
-- ---------------------------------------------------------------------
insert into public.payment_plans (id, name, description, amount_minor, currency, duration_days, features, plan_type, subscription_tier, billing_cycle, promotion_level, active)
values
    ('plan-vacancy-basic', 'Basic Job Post', 'Standard listing, visible in search and category browsing.', 300, 'USD', 30,
        '["Standard placement", "30 days active"]'::jsonb, 'vacancy', null, null, 'basic', true),
    ('plan-vacancy-featured', 'Featured Job Post', 'Featured badge and improved placement.', 500, 'USD', 30,
        '["Featured badge", "Priority placement", "30 days active"]'::jsonb, 'vacancy', null, null, 'featured', true),
    ('plan-vacancy-premium', 'Premium / Boosted Job', 'Featured, plus the top boosted slot for the whole period.', 1000, 'USD', 45,
        '["Featured badge", "Top boosted placement", "45 days active", "Highlighted in weekly digest"]'::jsonb, 'vacancy', null, null, 'premium', true),
    ('plan-sub-basic-monthly', 'Starter (Monthly)', 'Everything a growing business needs to recruit and get discovered.', 1000, 'USD', 30,
        '["Up to 10 active jobs", "Job promotion", "Applicant management", "Standard support"]'::jsonb, 'subscription', 'basic', 'monthly', null, true),
    ('plan-sub-basic-annual', 'Starter (Annual)', 'Everything a growing business needs to recruit and get discovered. Save $20 annually.', 10000, 'USD', 365,
        '["Up to 10 active jobs", "Job promotion", "Applicant management", "Standard support"]'::jsonb, 'subscription', 'basic', 'annual', null, true),
    ('plan-sub-pro-monthly', 'Pro (Monthly)', 'More recruiting capacity, greater visibility, and better tools for established businesses.', 2500, 'USD', 30,
        '["Up to 50 active jobs", "Featured vacancies", "Priority visibility", "Advanced analytics", "AI candidate matching", "Priority support"]'::jsonb, 'subscription', 'pro', 'monthly', null, true),
    ('plan-sub-pro-annual', 'Pro (Annual)', 'More recruiting capacity, greater visibility, and better tools for established businesses. Save $50 annually.', 25000, 'USD', 365,
        '["Up to 50 active jobs", "Featured vacancies", "Priority visibility", "Advanced analytics", "AI candidate matching", "Priority support"]'::jsonb, 'subscription', 'pro', 'annual', null, true)
on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    amount_minor = excluded.amount_minor,
    currency = excluded.currency,
    duration_days = excluded.duration_days,
    features = excluded.features,
    plan_type = excluded.plan_type,
    subscription_tier = excluded.subscription_tier,
    billing_cycle = excluded.billing_cycle,
    promotion_level = excluded.promotion_level,
    active = true,
    updated_at = now();

-- A subscription period is decided by the plan row, never by the client.
-- Make it impossible to mis-seed an annual plan with a 30-day period.
alter table public.payment_plans drop constraint if exists payment_plans_cycle_duration_check;
alter table public.payment_plans add constraint payment_plans_cycle_duration_check
    check (plan_type <> 'subscription'
           or (billing_cycle = 'monthly' and duration_days = 30)
           or (billing_cycle = 'annual' and duration_days = 365));

-- ---------------------------------------------------------------------
-- 3. ONE place for tier limits (jobs, business listings, featured slots)
--    and ONE place for "what tier is this org effectively on right now".
--    KEEP IN SYNC with src/data/subscriptionPlans.ts (display only).
-- ---------------------------------------------------------------------
create or replace function public.tier_limits(p_tier varchar)
returns table (max_jobs integer, max_listings integer, max_featured integer)
language sql
immutable
as $$
    select
        case p_tier when 'pro' then 50 when 'basic' then 10 else 1 end,
        case p_tier when 'pro' then 10 when 'basic' then 3  else 1 end,
        case p_tier when 'pro' then 5  when 'basic' then 1  else 0 end;
$$;

-- No paid row, a non-active status, or a lapsed period => 'free'. Nothing is
-- deleted: existing jobs/listings/applications stay, only new publishing is
-- capped, and renewing restores the paid tier.
create or replace function public.org_effective_tier(p_org_id varchar)
returns varchar
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
    select coalesce((
        select case
                 when s.status not in ('active', 'trialing') then 'free'
                 when s.tier <> 'free' and s.current_period_end < now() then 'free'
                 else s.tier
               end
        from public.organization_subscriptions s
        where s.organization_id = p_org_id
    ), 'free')::varchar;
$$;

create or replace function public.org_has_publish_quota(p_org_id varchar)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
    select (
        select count(*) from public.opportunities o
        where o.organization_id = p_org_id and o.status = 'published'
    ) < (select l.max_jobs from public.tier_limits(public.org_effective_tier(p_org_id)) l);
$$;

create or replace function public.owner_listing_limit(p_owner_id varchar)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
    select coalesce(max(
        (select l.max_listings from public.tier_limits(public.org_effective_tier(m.organization_id)) l)
    ), 1)
    from public.organization_memberships m
    where m.user_id = p_owner_id
      and m.status = 'active'
      and (m.org_role in ('owner', 'admin') or m.permissions ? 'all');
$$;

-- ---------------------------------------------------------------------
-- 4. Promotion columns are not client-writable. Featured/boosted status is
--    granted ONLY by (a) a platform admin approving a Featured/Premium
--    pay-as-you-go payment, or (b) a paid subscription's featured slots
--    (Starter 1, Pro 5 at a time), which last until the period ends.
-- ---------------------------------------------------------------------
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

    -- Boost can never be set by the owner.
    if tg_op = 'INSERT' then
        new.boosted_until := null;
        new.featured_until := null;
    else
        new.boosted_until := old.boosted_until;
        new.featured_until := old.featured_until;
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
            raise exception 'Featuring a vacancy needs a plan with a free featured slot, or the Featured/Premium job post option.'
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
    before insert or update of is_featured, featured_until, boosted_until on public.opportunities
    for each row execute function public.guard_opportunity_promotion();

-- ---------------------------------------------------------------------
-- 5. admin_review_payment(): identical to 20261006100000 except that
--    approving a Featured/Premium vacancy payment also applies the
--    purchased promotion. Subscription duration still comes from the plan
--    row (30 / 365 days, now also guaranteed by the CHECK above).
-- ---------------------------------------------------------------------
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
            -- Pay-as-you-go tiers: Basic publishes normally; Featured also
            -- gets the featured badge/placement; Premium additionally gets the
            -- top "boost" slot. Both promotions last as long as the plan's
            -- duration_days. Only this function (platform admin) can set
            -- these columns -- see guard_opportunity_promotion().
            update public.opportunities
            set status = 'published',
                is_featured = case when v_plan.promotion_level in ('featured', 'premium') then true else is_featured end,
                featured_until = case when v_plan.promotion_level in ('featured', 'premium')
                                      then now() + make_interval(days => v_plan.duration_days) else featured_until end,
                boosted_until = case when v_plan.promotion_level = 'premium'
                                     then now() + make_interval(days => v_plan.duration_days) else boosted_until end,
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
            update public.opportunities
            set status = 'payment_failed', updated_at = now()
            where id = v_payment.opportunity_id;
        end if;
    end if;

    return v_payment;
end;
$$;

revoke all on function public.admin_review_payment(varchar, varchar, text) from public, anon;
grant execute on function public.admin_review_payment(varchar, varchar, text) to authenticated;
