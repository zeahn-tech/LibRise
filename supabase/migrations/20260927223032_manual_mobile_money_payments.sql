-- Phase: Manual Mobile Money Payments (interim, pre-API-integration)
--
-- Context (see conversation / docs/PAYMENTS.md for the full rationale):
-- direct MTN MoMo / Orange Money API integration requires real business
-- KYC with each provider that only the business owner can pursue, and
-- Orange's own developer docs disagree on whether Liberia is covered at
-- all yet. This migration implements a HONEST interim system: recruiters
-- send a real P2P mobile money payment to the platform's own MoMo
-- number(s), submit the transaction reference they received back into
-- the platform, and a platform admin manually confirms it against the
-- actual MoMo transaction history before the vacancy publishes. This is
-- not automatic and is not instant, and nothing here pretends otherwise
-- -- see the 'payment_required' -> 'payment_pending' -> 'published' flow
-- below, all human/admin-gated, never client-confirmed.
--
-- Design goals carried over from the original spec even though this is
-- the manual provider, not a real API integration, because the same
-- schema needs to support a real provider later without a redesign:
--   - `payments` / `payment_events` shape matches a real provider's
--     needs (provider_transaction_id, provider_reference, idempotency,
--     immutable event log) even though today only a human writes to
--     provider_transaction_id instead of a webhook.
--   - `payment_provider` is a free-text discriminator ('manual_momo_mtn',
--     'manual_momo_orange' today; 'mtn_momo_api', 'orange_money_api',
--     'stripe' later) so nothing about the table shape needs to change
--     when a real provider is added -- only a new provider adapter in
--     application code plus new webhook routes.
--   - The vacancy (opportunity) publish gate gets threaded through the
--     SAME entitlement check opportunityService.ts's publish() already
--     has for subscriptions (see that file): an org with remaining
--     subscription job quota still publishes for free, unchanged. A
--     successful payment is only required once quota is exhausted or
--     absent. This is additive, not a replacement of the existing
--     subscription system.

-- ---------------------------------------------------------------------
-- 1. payment_plans -- centralized pricing, never hard-coded client-side
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2. payments
-- ---------------------------------------------------------------------
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

-- Valid statuses (documented, not a CHECK constraint -- this table is
-- meant to accommodate a future real-API provider whose status vocabulary
-- isn't fully known yet; application code is the source of truth via
-- src/types/index.ts's PaymentStatus union):
--   created | payment_pending | payment_success | payment_failed
--   | payment_expired | cancelled
--
-- Note this intentionally does not include a distinct PENDING/PROCESSING
-- split the way a real provider's webhook-driven flow would -- for the
-- manual provider there is exactly one "awaiting confirmation" state
-- (payment_pending, from the moment the recruiter submits their
-- transaction reference until an admin reviews it).

create index if not exists idx_payments_organization_id on public.payments(organization_id);
create index if not exists idx_payments_opportunity_id on public.payments(opportunity_id);
create index if not exists idx_payments_status on public.payments(status);
create index if not exists idx_payments_created_by on public.payments(created_by_user_id);

-- DB-level idempotency / duplicate-payment protection:
--  * At most one open (created / awaiting-review) payment per vacancy, so
--    "Pay Now" pressed repeatedly -- or two browser tabs racing -- cannot
--    create parallel payment records for the same vacancy.
create unique index if not exists uq_payments_one_open_per_opportunity
    on public.payments(opportunity_id)
    where opportunity_id is not null and status in ('created', 'payment_pending');
--  * provider_reference (our own recruiter-facing code) is globally unique.
create unique index if not exists uq_payments_provider_reference
    on public.payments(provider_reference);
--  * A single real mobile money transaction reference can back only ONE
--    live payment. Without this, a recruiter could reuse one genuine
--    transfer's reference to "pay" for several vacancies. Rejected /
--    expired payments are excluded so a typo'd reference can be
--    corrected on a fresh payment.
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

-- Deliberately NO UPDATE policy for anyone (recruiter or admin). Every
-- mutation of a payment row after creation goes through one of two
-- SECURITY DEFINER functions below (submit_payment_reference for the
-- recruiter, admin_review_payment for platform admins), which run as the
-- function owner and so need no RLS UPDATE policy. This means a
-- recruiter calling Supabase directly with their own login can never
-- edit amount_minor, plan_id, status, paid_at, or reviewer fields on a
-- payment row -- they can only invoke the RPCs, which enforce the rules.

drop policy if exists "Platform admins can view all payments" on public.payments;
create policy "Platform admins can view all payments" on public.payments
    for select
    to authenticated
    using (public.is_platform_admin(auth.uid()::varchar));

-- Platform admins update payments ONLY through admin_review_payment()
-- (SECURITY DEFINER below), never via a direct RLS-permitted UPDATE --
-- deliberately no admin UPDATE policy exists here. This forces every
-- approval/rejection through one auditable, atomic function instead of
-- ad hoc client-side updates, which is what actually makes "only the
-- backend can publish after verified payment" true rather than aspirational.

-- ---------------------------------------------------------------------
-- 3. payment_events -- immutable audit trail
-- ---------------------------------------------------------------------
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

-- No INSERT policy for any role: payment_events rows are written only by
-- the trigger and SECURITY DEFINER functions below (which run as the
-- function owner, bypassing RLS by design for this one, narrow purpose).
-- This is what makes it a genuine append-only audit log rather than a
-- table the client happens to also write to.

-- ---------------------------------------------------------------------
-- 3b. Server-authoritative pricing. The INSERT RLS policy above lets an
--     org member create a payment row, so without this trigger a
--     technically capable recruiter could insert amount_minor = 1 for a
--     $20 plan. This trigger overwrites amount/currency from
--     payment_plans, resets every field only the review flow may set, and
--     verifies the vacancy belongs to the paying organization -- so the
--     client-supplied values for those fields are simply ignored.
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

-- ---------------------------------------------------------------------
-- 4. Automatic audit trail: log every payment status change
-- ---------------------------------------------------------------------
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
            'pevt-' || replace(uuid_generate_v4()::text, '-', ''),
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

-- ---------------------------------------------------------------------
-- 5. Recruiter action: submit the MoMo transaction reference they
--    received after sending a real P2P payment. Wrapped as a function
--    (rather than relying solely on the UPDATE policy above) so the
--    business-day expiry check and status transition happen atomically
--    and can't be raced by two submissions on the same payment.
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
        -- Just refuse. (Marking it expired here would be rolled back by the
        -- raise below; expire_payment_if_stale() is what persists expiry.)
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

-- ---------------------------------------------------------------------
-- 5b. Expire an unsubmitted payment whose window has passed. Without this
--     an abandoned 'created' payment would sit in that state forever and,
--     because of uq_payments_one_open_per_opportunity, block the recruiter
--     from ever starting a fresh payment for that vacancy. Only 'created'
--     payments expire: a 'payment_pending' payment means the recruiter says
--     they already sent money, so it must NEVER auto-expire -- it waits for
--     a human decision. The vacancy stays 'payment_required' (spec:
--     expired -> back to payment required).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 6. Admin action: approve or reject a pending manual payment. This is
--    the ONLY path that can set a payment to payment_success and, in the
--    same transaction, publish the associated vacancy -- satisfying
--    "only the backend can transition a vacancy into PUBLISHED after
--    verified successful payment" and "use a database transaction when
--    a payment succeeds" from the original spec, even without a real
--    provider webhook: a Postgres function body is itself an implicit
--    transaction, so payment + opportunity update + audit event either
--    all happen or none do.
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

-- ---------------------------------------------------------------------
-- 7. DATABASE-LEVEL PUBLISH GATE.
--
--    opportunityService.ts checks quota/payment before publishing, but a
--    client-side check protects nothing on its own: the opportunities RLS
--    policies let any org member with opportunities.create/edit write
--    status = 'published' directly through the Supabase API with their own
--    login. This trigger is the actual enforcement of the requirement
--    "protection against vacancy publication without payment".
--
--    A vacancy may transition INTO 'published' only if one of:
--      * there is no JWT user (service role / migrations / SQL editor --
--        trusted server-side contexts),
--      * the caller is a platform admin (moderation, and
--        admin_review_payment() which publishes on approval),
--      * the organization still has free publish quota on its active
--        subscription (free tier = 1 published vacancy, basic = 5, pro =
--        unlimited -- KEEP IN SYNC with src/data/subscriptionPlans.ts;
--        the limits are duplicated here because the DB cannot read the
--        TypeScript plan table), or
--      * this vacancy has an admin-approved payment whose paid duration
--        has not yet lapsed (so a paid vacancy can be closed and
--        reopened within its paid window).
--    Rows already 'published' are never re-gated (no retroactive break of
--    existing listings).
--
--    KNOWN LIMITATION: the quota branch trusts organization_subscriptions,
--    and its existing RLS lets an org ADMIN write their own org's
--    subscription row (see subscriptionService.ts header -- a documented
--    demo/mock path, not yet replaced by a real Stripe webhook). Until
--    that policy is locked down, an org admin can forge a 'pro' row and
--    skip payment. This trigger closes the direct-publish bypass; it does
--    not, by itself, close that separate, pre-existing subscription hole.
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
