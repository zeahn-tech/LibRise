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
