-- LibRise payments setup. Paste ALL of this into the Supabase SQL Editor and click Run.
-- Safe to run more than once. Each part reports its own result in the table at the bottom.
-- LibRise payments setup. Paste ALL of this into the Supabase SQL Editor and click Run.
-- Safe to run more than once. Checks prerequisites first and tells you what is missing.
create extension if not exists "uuid-ossp" with schema extensions;

do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.users') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.opportunities') is null then
    missing := array_append(missing, 'core tables (users / organizations / opportunities)  ->  run 20260907203348_init_schema.sql');
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'has_org_permission') then
    missing := array_append(missing, 'function has_org_permission  ->  run 20260909130000_organization_service_backend.sql then 20260909140000_opportunity_service_backend.sql');
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'is_platform_admin') then
    missing := array_append(missing, 'function is_platform_admin  ->  run 20260911100000_verification_service_backend.sql');
  end if;

  if to_regclass('public.organization_subscriptions') is null then
    missing := array_append(missing, 'table organization_subscriptions  ->  run 20260911200000_subscription_notification_analytics_backend.sql');
  end if;

  if cardinality(missing) > 0 then
    raise exception E'Payments setup cannot run yet. Missing prerequisites:\n  - %\nRun the listed migration files (from supabase/migrations in your repo) in that order, then run this script again.',
      array_to_string(missing, E'\n  - ');
  end if;
end $$;

create temp table if not exists _setup_log (step text, result text, details text);
delete from _setup_log;

do $run$
declare
  v_msg text; v_detail text; v_hint text;
begin
  execute $part2$
create table if not exists public.payment_plans (
    id varchar(100) primary key,
    name varchar(255) not null,
    description text,
    amount_minor integer not null check (amount_minor > 0),
    currency varchar(10) not null default 'USD',
    duration_days integer not null default 30,
    features jsonb not null default '[]'::jsonb,
    active boolean not null default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

insert into public.payment_plans (id, name, description, amount_minor, currency, duration_days, features)
values
    ('plan-vacancy-basic', 'Basic Vacancy', 'Standard listing, visible in search and category browsing.', 500, 'USD', 30, '["Standard placement", "30 days active"]'::jsonb),
    ('plan-vacancy-featured', 'Featured Vacancy', 'Highlighted placement plus a featured badge.', 1000, 'USD', 30, '["Featured badge", "Priority placement", "30 days active"]'::jsonb),
    ('plan-vacancy-premium', 'Premium Vacancy', 'Top placement, featured badge, and extended duration.', 2000, 'USD', 45, '["Featured badge", "Top placement", "45 days active", "Highlighted in weekly digest"]'::jsonb)
on conflict (id) do nothing;

alter table public.payment_plans enable row level security;

drop policy if exists "Anyone can view active payment plans" on public.payment_plans;
create policy "Anyone can view active payment plans" on public.payment_plans
    for select using (active = true);

create table if not exists public.payments (
    id varchar(100) primary key,
    public_payment_id varchar(100) unique not null,
    organization_id varchar(100) not null references public.organizations(id) on delete cascade,
    created_by_user_id varchar(100) not null references public.users(id) on delete restrict,
    opportunity_id varchar(100) references public.opportunities(id) on delete cascade,
    plan_id varchar(100) not null references public.payment_plans(id) on delete restrict,
    payment_provider varchar(50) not null,
    payment_method varchar(50),
    provider_transaction_id varchar(255),
    provider_reference varchar(255) not null,
    sender_phone_number varchar(50),
    amount_minor integer not null check (amount_minor > 0),
    currency varchar(10) not null,
    description text,
    status varchar(50) not null default 'created',
    metadata jsonb not null default '{}'::jsonb,
    failure_reason text,
    expires_at timestamptz not null default (now() + interval '48 hours'),
    paid_at timestamptz,
    reviewed_by_user_id varchar(100) references public.users(id) on delete set null,
    reviewed_at timestamptz,
    idempotency_key varchar(255) unique,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_payments_organization_id on public.payments(organization_id);
create index if not exists idx_payments_opportunity_id on public.payments(opportunity_id);
create index if not exists idx_payments_status on public.payments(status);
create index if not exists idx_payments_created_by on public.payments(created_by_user_id);

create unique index if not exists uq_payments_one_open_per_opportunity
    on public.payments(opportunity_id)
    where opportunity_id is not null and status in ('created', 'payment_pending');
create unique index if not exists uq_payments_provider_reference
    on public.payments(provider_reference);
create unique index if not exists uq_payments_provider_txn_live
    on public.payments(payment_provider, provider_transaction_id)
    where provider_transaction_id is not null and status in ('payment_pending', 'payment_success');

alter table public.payments enable row level security;

drop policy if exists "Org members with payments.manage can view their org's payments" on public.payments;
create policy "Org members with payments.manage can view their org's payments" on public.payments
    for select
    to authenticated
    using (public.has_org_permission(organization_id, 'payments.manage'));

drop policy if exists "Org members with payments.manage can create payments" on public.payments;
create policy "Org members with payments.manage can create payments" on public.payments
    for insert
    to authenticated
    with check (
        public.has_org_permission(organization_id, 'payments.manage')
        and created_by_user_id = auth.uid()::varchar
        and status = 'created'
    );

drop policy if exists "Platform admins can view all payments" on public.payments;
create policy "Platform admins can view all payments" on public.payments
    for select
    to authenticated
    using (public.is_platform_admin(auth.uid()::varchar));

create table if not exists public.payment_events (
    id varchar(100) primary key,
    payment_id varchar(100) not null references public.payments(id) on delete cascade,
    event_type varchar(100) not null,
    provider varchar(50) not null,
    actor_user_id varchar(100) references public.users(id) on delete set null,
    provider_event_id varchar(255),
    payload jsonb not null default '{}'::jsonb,
    signature_valid boolean,
    created_at timestamptz default now()
);

create index if not exists idx_payment_events_payment_id on public.payment_events(payment_id);

alter table public.payment_events enable row level security;

drop policy if exists "Org members with payments.manage can view their org's payment events" on public.payment_events;
create policy "Org members with payments.manage can view their org's payment events" on public.payment_events
    for select
    to authenticated
    using (
        exists (
            select 1 from public.payments p
            where p.id = payment_id
            and public.has_org_permission(p.organization_id, 'payments.manage')
        )
    );

drop policy if exists "Platform admins can view all payment events" on public.payment_events;
create policy "Platform admins can view all payment events" on public.payment_events
    for select
    to authenticated
    using (public.is_platform_admin(auth.uid()::varchar));

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

drop trigger if exists trg_payments_enforce_server_pricing on public.payments;
create trigger trg_payments_enforce_server_pricing
    before insert on public.payments
    for each row execute function public.payments_enforce_server_pricing();

create or replace function public.log_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
        insert into public.payment_events (id, payment_id, event_type, provider, actor_user_id, payload)
        values (
            'pevt-' || replace(extensions.uuid_generate_v4()::text, '-', ''),
            new.id,
            case when tg_op = 'INSERT' then 'payment.created' else 'payment.status_changed' end,
            new.payment_provider,
            auth.uid()::varchar,
            jsonb_build_object(
                'from_status', case when tg_op = 'INSERT' then null else old.status end,
                'to_status', new.status,
                'provider_transaction_id', new.provider_transaction_id
            )
        );
    end if;
    return new;
end;
$$;

drop trigger if exists trg_log_payment_status_change on public.payments;
create trigger trg_log_payment_status_change
    after insert or update on public.payments
    for each row execute function public.log_payment_status_change();

create or replace function public.submit_payment_reference(
    p_payment_id varchar,
    p_provider_transaction_id varchar,
    p_sender_phone_number varchar default null
)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_payment public.payments;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;

    select * into v_payment from public.payments where id = p_payment_id for update;
    if v_payment is null then
        raise exception 'Payment not found.' using errcode = 'P0002';
    end if;
    if v_payment.created_by_user_id <> v_uid then
        raise exception 'You do not have permission to update this payment.' using errcode = '42501';
    end if;
    if v_payment.status <> 'created' then
        raise exception 'This payment has already had a reference submitted, or is no longer awaiting one (current status: %).', v_payment.status using errcode = 'P0001';
    end if;
    if v_payment.expires_at < now() then
        raise exception 'This payment window has expired. Please start a new payment.' using errcode = 'P0001';
    end if;
    if p_provider_transaction_id is null or length(trim(p_provider_transaction_id)) = 0 then
        raise exception 'A transaction reference is required.' using errcode = '22023';
    end if;

    begin
        update public.payments
        set status = 'payment_pending',
            provider_transaction_id = upper(trim(p_provider_transaction_id)),
            sender_phone_number = coalesce(p_sender_phone_number, sender_phone_number),
            updated_at = now()
        where id = p_payment_id
        returning * into v_payment;
    exception when unique_violation then
        raise exception 'This transaction reference has already been submitted for another payment. Each mobile money transaction can only be used once.' using errcode = 'P0001';
    end;

    return v_payment;
end;
$$;

create or replace function public.expire_payment_if_stale(p_payment_id varchar)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_payment public.payments;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;

    select * into v_payment from public.payments where id = p_payment_id for update;
    if v_payment.id is null then
        raise exception 'Payment not found.' using errcode = 'P0002';
    end if;
    if not (public.has_org_permission(v_payment.organization_id, 'payments.manage')
            or public.is_platform_admin(v_uid)) then
        raise exception 'You do not have permission to update this payment.' using errcode = '42501';
    end if;

    if v_payment.status = 'created' and v_payment.expires_at < now() then
        update public.payments
        set status = 'payment_expired', updated_at = now()
        where id = p_payment_id
        returning * into v_payment;
    end if;

    return v_payment;
end;
$$;

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

        if v_payment.opportunity_id is not null then
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

        if v_payment.opportunity_id is not null then
            update public.opportunities
            set status = 'payment_failed', updated_at = now()
            where id = v_payment.opportunity_id;
        end if;
    end if;

    return v_payment;
end;
$$;

comment on function public.submit_payment_reference is
    'Recruiter submits the MoMo transaction reference from a P2P payment they made outside the platform. Moves payment from created -> payment_pending. Never sets payment_success -- see admin_review_payment().';
comment on function public.admin_review_payment is
    'Platform admin approves/rejects a payment_pending payment after manually checking it against real MoMo transaction history. The ONLY path that can set payment_success and publish the associated vacancy, atomically.';

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
    ) < coalesce((
        select case s.tier when 'pro' then 2147483647 when 'basic' then 5 else 1 end
        from public.organization_subscriptions s
        where s.organization_id = p_org_id and s.status in ('active', 'trialing')
    ), 1);
$$;

create or replace function public.enforce_publish_payment_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
begin
    if new.status is distinct from 'published' then
        return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'published' then
        return new;
    end if;

    v_uid := auth.uid()::varchar;
    if v_uid is null then
        return new;
    end if;
    if public.is_platform_admin(v_uid) then
        return new;
    end if;
    if public.org_has_publish_quota(new.organization_id) then
        return new;
    end if;
    if exists (
        select 1
        from public.payments p
        join public.payment_plans pl on pl.id = p.plan_id
        where p.opportunity_id = new.id
          and p.status = 'payment_success'
          and p.paid_at is not null
          and p.paid_at + make_interval(days => pl.duration_days) > now()
    ) then
        return new;
    end if;

    raise exception 'Payment is required to publish this vacancy.' using errcode = 'P0402';
end;
$$;

drop trigger if exists trg_enforce_publish_payment_gate on public.opportunities;
create trigger trg_enforce_publish_payment_gate
    before insert or update of status on public.opportunities
    for each row execute function public.enforce_publish_payment_gate();
  $part2$;
  insert into _setup_log values ('2. Base payments tables and functions', 'ok', null);
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  insert into _setup_log values ('2. Base payments tables and functions', 'FAILED',
    concat_ws(' | ', v_msg, 'code ' || sqlstate, nullif(v_detail, ''), nullif(v_hint, '')));
end
$run$;

do $run$
declare
  v_msg text; v_detail text; v_hint text;
begin
  execute $part3$
do $$
begin
  if to_regclass('public.payments') is null then
    raise exception 'public.payments does not exist. Run 20260927223032_manual_mobile_money_payments.sql first, or run supabase/manual/payments_setup.sql, which installs all payment migrations in the right order.';
  end if;
end $$;

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

drop policy if exists "Org admins can manage their org's subscription" on public.organization_subscriptions;
drop policy if exists "Org admins can update their org's subscription" on public.organization_subscriptions;

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

create unique index if not exists uq_payments_one_open_subscription_per_org
    on public.payments(organization_id)
    where opportunity_id is null and status in ('created', 'payment_pending');
  $part3$;
  insert into _setup_log values ('3. Subscription payments (adds 4 subscription plans)', 'ok', null);
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  insert into _setup_log values ('3. Subscription payments (adds 4 subscription plans)', 'FAILED',
    concat_ws(' | ', v_msg, 'code ' || sqlstate, nullif(v_detail, ''), nullif(v_hint, '')));
end
$run$;

do $run$
declare
  v_msg text; v_detail text; v_hint text;
begin
  execute $part4$
do $$
begin
  if to_regclass('public.payments') is null then
    raise exception 'public.payments does not exist. Run 20260927223032_manual_mobile_money_payments.sql first, or run supabase/manual/payments_setup.sql, which installs all payment migrations in the right order.';
  end if;
end $$;

create or replace function public.switch_payment_provider(p_payment_id varchar, p_provider varchar)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_payment public.payments;
begin
    if auth.uid() is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;

    if p_provider not in ('manual_momo_mtn', 'manual_momo_orange') then
        raise exception 'Unsupported payment method.' using errcode = 'P0001';
    end if;

    select * into v_payment from public.payments where id = p_payment_id for update;
    if not found then
        raise exception 'Payment not found.' using errcode = 'P0002';
    end if;

    if not public.has_org_permission(v_payment.organization_id, 'payments.manage') then
        raise exception 'You do not have permission to change this payment.' using errcode = '42501';
    end if;

    if v_payment.status <> 'created' then
        raise exception 'The payment method can only be changed before a transaction reference is submitted (current status: %).', v_payment.status using errcode = 'P0001';
    end if;

    if v_payment.expires_at < now() then
        raise exception 'This payment window has expired. Please start a new payment.' using errcode = 'P0001';
    end if;

    if v_payment.payment_provider = p_provider then
        return v_payment;
    end if;

    update public.payments
       set payment_provider = p_provider,
           updated_at = now()
     where id = p_payment_id
     returning * into v_payment;

    return v_payment;
end;
$$;

revoke all on function public.switch_payment_provider(varchar, varchar) from public, anon;
grant execute on function public.switch_payment_provider(varchar, varchar) to authenticated;

comment on function public.switch_payment_provider is
    'Recruiter switches MTN <-> Orange on a payment that has not had a reference submitted yet. Changes only payment_provider.';
  $part4$;
  insert into _setup_log values ('4. MTN / Orange switching', 'ok', null);
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  insert into _setup_log values ('4. MTN / Orange switching', 'FAILED',
    concat_ws(' | ', v_msg, 'code ' || sqlstate, nullif(v_detail, ''), nullif(v_hint, '')));
end
$run$;

do $run$
declare
  v_msg text; v_detail text; v_hint text;
begin
  execute $part5$
do $$
begin
  if to_regclass('public.payments') is null or to_regclass('public.organization_subscriptions') is null then
    raise exception 'Parts 2-4 must succeed first (payments / organization_subscriptions missing).';
  end if;
end $$;

-- Hardening of the manual mobile money flow + subscription period enforcement.
--
-- WHY: the transaction ID is issued by MTN / Orange, not by us, so the system
-- can never prove a submitted ID is real -- only a human checking the business
-- MoMo statement can. What the database CAN do (and now does, server-side, so a
-- direct API call cannot bypass it) is make fake submissions expensive and
-- easy for the admin to catch:
--   1. reject obviously invalid IDs (wrong shape/length, repeated or sequential
--      characters, our own OHL- reference, the payer's own phone number);
--   2. require the sender's phone number (admin matches it to the statement);
--   3. pause submissions after repeated rejections, and cap simultaneous
--      pending submissions, so guessing numbers until one "sticks" stops working.
-- The existing unique index on (provider, transaction_id) still stops a REAL
-- transaction from backing two payments.
--
-- ALSO: subscriptions never expired. org_has_publish_quota() only checked
-- status = 'active', so a paid tier kept its limits forever after
-- current_period_end. Paid tiers now fall back to the free limit once the
-- period has lapsed, and renewing the same tier early extends the period
-- instead of discarding the days already paid for.

-- ---------------------------------------------------------------------
-- 1. Validation helpers (messages are P0001 so the UI shows them verbatim)
-- ---------------------------------------------------------------------
create or replace function public.normalize_momo_transaction_id(
    p_txn text,
    p_own_reference text,
    p_sender_phone text
)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $$
declare
    v text;
    v_alnum text;
begin
    v := upper(regexp_replace(coalesce(p_txn, ''), '\s+', '', 'g'));
    if v = '' then
        raise exception 'A transaction ID is required.' using errcode = 'P0001';
    end if;
    -- Conservative shape check (8-25 chars: letters, digits, dot, dash). Real
    -- MTN / Orange IDs fit comfortably; tighten per network once real samples
    -- are confirmed.
    if v !~ '^[A-Z0-9][A-Z0-9.-]{6,23}[A-Z0-9]$' then
        raise exception 'That does not look like a mobile money transaction ID. Copy it exactly from your confirmation message (8-25 letters or numbers).' using errcode = 'P0001';
    end if;
    if position(v in upper(coalesce(p_own_reference, ''))) > 0 then
        raise exception 'That is our payment reference, not the transaction ID. The transaction ID comes from your MTN / Orange confirmation message.' using errcode = 'P0001';
    end if;

    v_alnum := regexp_replace(v, '[^A-Z0-9]', '', 'g');
    if (select count(distinct c) from regexp_split_to_table(v_alnum, '') as c) < 4 then
        raise exception 'That transaction ID looks invalid. Copy it exactly from your confirmation message.' using errcode = 'P0001';
    end if;
    if v_alnum ~ '^[0-9]+$'
       and (position(v_alnum in '01234567890123456789') > 0
            or position(v_alnum in '98765432109876543210') > 0) then
        raise exception 'That transaction ID looks invalid. Copy it exactly from your confirmation message.' using errcode = 'P0001';
    end if;
    if length(regexp_replace(coalesce(p_sender_phone, ''), '[^0-9]', '', 'g')) >= 7
       and v_alnum = regexp_replace(p_sender_phone, '[^0-9]', '', 'g') then
        raise exception 'That is a phone number, not a transaction ID.' using errcode = 'P0001';
    end if;
    return v;
end;
$$;

create or replace function public.normalize_sender_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $$
declare
    s text;
begin
    s := regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g');
    if s !~ '^\+?[0-9]{7,15}$' then
        raise exception 'Enter the phone number you paid from, for example 0770000000 or +231770000000.' using errcode = 'P0001';
    end if;
    return s;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. submit_payment_reference(): same contract, now validated and throttled
-- ---------------------------------------------------------------------
create or replace function public.submit_payment_reference(
    p_payment_id varchar,
    p_provider_transaction_id varchar,
    p_sender_phone_number varchar default null
)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_payment public.payments;
    v_txn text;
    v_phone text;
    v_recent_rejected int;
    v_pending int;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;

    select * into v_payment from public.payments where id = p_payment_id for update;
    if v_payment is null then
        raise exception 'Payment not found.' using errcode = 'P0002';
    end if;
    if v_payment.created_by_user_id <> v_uid then
        raise exception 'You do not have permission to update this payment.' using errcode = '42501';
    end if;
    if v_payment.status <> 'created' then
        raise exception 'This payment has already had a reference submitted, or is no longer awaiting one (current status: %).', v_payment.status using errcode = 'P0001';
    end if;
    if v_payment.expires_at < now() then
        raise exception 'This payment window has expired. Please start a new payment.' using errcode = 'P0001';
    end if;

    -- Anti-guessing: repeated rejections pause submissions; pending ones are capped.
    select count(*) into v_recent_rejected
    from public.payments
    where created_by_user_id = v_uid
      and status = 'payment_failed'
      and reviewed_at > now() - interval '24 hours';
    if v_recent_rejected >= 3 then
        raise exception 'Several of your recent payments could not be verified, so new submissions are paused for 24 hours. Please contact support with your payment reference.' using errcode = 'P0001';
    end if;
    select count(*) into v_pending
    from public.payments
    where created_by_user_id = v_uid and status = 'payment_pending';
    if v_pending >= 3 then
        raise exception 'You already have 3 payments awaiting confirmation. Please wait for them to be reviewed before submitting another.' using errcode = 'P0001';
    end if;

    v_phone := public.normalize_sender_phone(p_sender_phone_number);
    v_txn := public.normalize_momo_transaction_id(p_provider_transaction_id, v_payment.provider_reference, v_phone);

    begin
        update public.payments
        set status = 'payment_pending',
            provider_transaction_id = v_txn,
            sender_phone_number = v_phone,
            updated_at = now()
        where id = p_payment_id
        returning * into v_payment;
    exception when unique_violation then
        raise exception 'This transaction reference has already been submitted for another payment. Each mobile money transaction can only be used once.' using errcode = 'P0001';
    end;

    return v_payment;
end;
$$;

revoke all on function public.submit_payment_reference(varchar, varchar, varchar) from public, anon;
grant execute on function public.submit_payment_reference(varchar, varchar, varchar) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Subscription periods are enforced
-- ---------------------------------------------------------------------
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
    ) < coalesce((
        select case
                 when s.tier <> 'free' and s.current_period_end < now() then 1  -- lapsed paid plan => free limit
                 when s.tier = 'pro' then 2147483647
                 when s.tier = 'basic' then 5
                 else 1
               end
        from public.organization_subscriptions s
        where s.organization_id = p_org_id and s.status in ('active', 'trialing')
    ), 1);
$$;

-- ---------------------------------------------------------------------
-- 4. admin_review_payment(): renewing the same tier early extends the
--    current period instead of throwing away the days already paid for.
--    (Switching tier starts a fresh period from now.) Everything else is
--    unchanged from 20260930094556.
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

revoke all on function public.admin_review_payment(varchar, varchar, text) from public, anon;
grant execute on function public.admin_review_payment(varchar, varchar, text) to authenticated;

comment on function public.admin_review_payment is
    'Platform admin approves/rejects a payment_pending payment after manually checking it against real MoMo transaction history. For plan_type=vacancy, publishes the associated opportunity; for plan_type=subscription, upserts organization_subscriptions (renewing the same tier extends the current period). The ONLY path that can do either, atomically.';

  $part5$;
  insert into _setup_log values ('5. Reference hardening + subscription expiry', 'ok', null);
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  insert into _setup_log values ('5. Reference hardening + subscription expiry', 'FAILED',
    concat_ws(' | ', v_msg, 'code ' || sqlstate, nullif(v_detail, ''), nullif(v_hint, '')));
end
$run$;

notify pgrst, 'reload schema';

select step, result, details from _setup_log
union all
select 'FINAL CHECK',
  case
    when (select count(*) from public.payment_plans) >= 7
     and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('submit_payment_reference', 'admin_review_payment', 'switch_payment_provider', 'normalize_momo_transaction_id')) = 4
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'payment_plans' and column_name = 'plan_type')
    then 'OK - payments fully installed'
    else 'INCOMPLETE - see the FAILED row above'
  end,
  'plans=' || (select count(*) from public.payment_plans)
    || ', functions=' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('submit_payment_reference', 'admin_review_payment', 'switch_payment_provider', 'normalize_momo_transaction_id'))
order by 1;
