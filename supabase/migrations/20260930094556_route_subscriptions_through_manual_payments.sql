-- Phase: Route subscription upgrades through the real manual mobile
-- money payment system, and close the security hole that let it be
-- skipped entirely.
--
-- Context: SubscriptionManager.tsx's "Upgrade" button called
-- subscriptionService.mockFulfillSubscription(), which writes straight
-- to organization_subscriptions with a FAKE stripe_customer_id and no
-- payment of any kind -- exactly why a user reported "I click upgrade
-- and it switches plans, but I never see anywhere to send money." This
-- was a known, previously-documented gap (see docs/PAYMENTS.md
-- "Known limitations" #2 and the certification report): the RLS on
-- organization_subscriptions let an org admin write their own org's row
-- directly, so ANY client code (not just the mock helper) could grant
-- a paid tier for free.
--
-- This migration generalizes the same manual-mobile-money-payment
-- system built for vacancy publishing (see
-- *_manual_mobile_money_payments.sql) to also cover subscription
-- upgrades, and removes the org-admin write access that made the mock
-- possible in the first place. After this migration, upgrading a
-- subscription requires the same real P2P payment + admin verification
-- flow as publishing a paid vacancy -- there is no other path.

-- ---------------------------------------------------------------------
-- 1. payment_plans: distinguish vacancy packages from subscription
--    tiers, and seed real subscription pricing matching
--    src/data/subscriptionPlans.ts exactly (keep both in sync manually --
--    the DB cannot read the TypeScript file).
-- ---------------------------------------------------------------------
alter table public.payment_plans
    add column if not exists plan_type varchar(20) not null default 'vacancy',
    add column if not exists subscription_tier varchar(20),
    add column if not exists billing_cycle varchar(20);

comment on column public.payment_plans.plan_type is
    'vacancy (one-time, publishes a specific opportunity) or subscription (recurring org-wide tier). Drives branching in admin_review_payment().';

insert into public.payment_plans (id, name, description, amount_minor, currency, duration_days, features, plan_type, subscription_tier, billing_cycle)
values
    ('plan-sub-basic-monthly', 'Starter (Monthly)', 'For growing teams with consistent hiring needs.', 4900, 'USD', 30, '["Up to 5 active jobs", "Unlimited candidate profiles", "Candidate contact info", "Standard support"]'::jsonb, 'subscription', 'basic', 'monthly'),
    ('plan-sub-basic-annual', 'Starter (Annual)', 'For growing teams with consistent hiring needs. ~20% off annual.', 47000, 'USD', 365, '["Up to 5 active jobs", "Unlimited candidate profiles", "Candidate contact info", "Standard support"]'::jsonb, 'subscription', 'basic', 'annual'),
    ('plan-sub-pro-monthly', 'Pro (Monthly)', 'Advanced recruiting tools and AI matching.', 14900, 'USD', 30, '["Unlimited active jobs", "AI-powered candidate matching", "Priority support", "Advanced analytics"]'::jsonb, 'subscription', 'pro', 'monthly'),
    ('plan-sub-pro-annual', 'Pro (Annual)', 'Advanced recruiting tools and AI matching. ~20% off annual.', 143000, 'USD', 365, '["Unlimited active jobs", "AI-powered candidate matching", "Priority support", "Advanced analytics"]'::jsonb, 'subscription', 'pro', 'annual')
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
    updated_at = now();

-- ---------------------------------------------------------------------
-- 2. Close the hole: organization_subscriptions is no longer writable
--    by org admins at all. Every change goes through
--    admin_review_payment() (SECURITY DEFINER, below), which is the
--    only thing that can insert/update this table now.
-- ---------------------------------------------------------------------
drop policy if exists "Org admins can manage their org's subscription" on public.organization_subscriptions;
drop policy if exists "Org admins can update their org's subscription" on public.organization_subscriptions;

-- No INSERT/UPDATE policy replaces them. There is currently no
-- self-service cancellation flow in the app (SubscriptionManager.tsx's
-- "Manage Billing" is a placeholder alert()), so nothing is broken by
-- removing write access outright -- see docs/PAYMENTS.md for a
-- cancel_own_subscription()-style RPC as a documented follow-up if a
-- real self-service cancel/downgrade flow is added later.

-- ---------------------------------------------------------------------
-- 3. payments: opportunity_id is optional for a subscription payment
--    (there is no vacancy involved). Add organization-ownership
--    validation for that case too, matching the vacancy branch.
-- ---------------------------------------------------------------------
create or replace function public.payments_enforce_server_pricing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_plan public.payment_plans;
    v_opp_org varchar;
begin
    select * into v_plan from public.payment_plans where id = new.plan_id and active = true;
    if v_plan.id is null then
        raise exception 'Unknown or inactive payment plan.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'vacancy' and new.opportunity_id is null then
        raise exception 'A vacancy payment must reference an opportunity.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'subscription' and new.opportunity_id is not null then
        raise exception 'A subscription payment must not reference an opportunity.' using errcode = 'P0001';
    end if;

    new.amount_minor := v_plan.amount_minor;
    new.currency := v_plan.currency;
    new.status := 'created';
    new.paid_at := null;
    new.reviewed_by_user_id := null;
    new.reviewed_at := null;
    new.provider_transaction_id := null;
    new.failure_reason := null;
    new.expires_at := now() + interval '48 hours';

    if new.opportunity_id is not null then
        select organization_id into v_opp_org from public.opportunities where id = new.opportunity_id;
        if v_opp_org is null or v_opp_org <> new.organization_id then
            raise exception 'This vacancy does not belong to the paying organization.' using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. admin_review_payment(): branch on plan_type. Vacancy behavior is
--    UNCHANGED (still publishes the opportunity on approval). A
--    subscription payment upserts organization_subscriptions instead --
--    the only remaining way that table can be written at all.
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
                plan_id = excluded.plan_id,
                tier = excluded.tier,
                status = 'active',
                billing_cycle = excluded.billing_cycle,
                current_period_start = now(),
                current_period_end = now() + make_interval(days => v_plan.duration_days),
                cancel_at_period_end = false,
                updated_at = now();
        elsif v_payment.opportunity_id is not null then
            update public.opportunities
            set status = 'published', updated_at = now()
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

comment on function public.admin_review_payment is
    'Platform admin approves/rejects a payment_pending payment after manually checking it against real MoMo transaction history. For plan_type=vacancy, publishes the associated opportunity; for plan_type=subscription, upserts organization_subscriptions. The ONLY path that can do either, atomically.';

-- ---------------------------------------------------------------------
-- 5. Idempotency for subscription payments: the existing
--    uq_payments_one_open_per_opportunity index only covers
--    opportunity_id IS NOT NULL (vacancy payments). A subscription
--    payment has opportunity_id = NULL, so without this it could be
--    started twice in parallel (two tabs, a double-click) the same way
--    vacancy payments were already protected against.
-- ---------------------------------------------------------------------
create unique index if not exists uq_payments_one_open_subscription_per_org
    on public.payments(organization_id)
    where opportunity_id is null and status in ('created', 'payment_pending');

