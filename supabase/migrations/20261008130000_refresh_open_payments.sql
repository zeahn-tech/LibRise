-- Unpaid checkouts must never show a stale price.
--
-- initiate() resumes an organization's open payment instead of creating a
-- second one (one open payment per target). That payment carried the price
-- quoted when it was created, so after a price change the checkout kept
-- showing the OLD amount (e.g. Starter annual at $470) and also ignored a
-- different plan picked afterwards.
--
-- A payment in status 'created' with no transaction reference has had no
-- money sent against it, so it is safe to re-quote. Once a reference is
-- submitted (payment_pending and later) the quoted amount is frozen.
-- Safe to re-run.

-- 1. One-time repair: re-quote every unpaid, unreferenced checkout.
update public.payments p
   set amount_minor = pl.amount_minor,
       currency = pl.currency,
       updated_at = now()
  from public.payment_plans pl
 where pl.id = p.plan_id
   and p.status = 'created'
   and p.provider_transaction_id is null
   and (p.amount_minor <> pl.amount_minor or p.currency <> pl.currency);

-- 2. Ongoing: a plan price change re-quotes unpaid checkouts automatically.
create or replace function public.requote_open_payments_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    if new.amount_minor is distinct from old.amount_minor or new.currency is distinct from old.currency then
        update public.payments
           set amount_minor = new.amount_minor,
               currency = new.currency,
               updated_at = now()
         where plan_id = new.id
           and status = 'created'
           and provider_transaction_id is null;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_requote_open_payments on public.payment_plans;
create trigger trg_requote_open_payments
    after update of amount_minor, currency on public.payment_plans
    for each row execute function public.requote_open_payments_on_plan_change();

-- 3. Called by checkout when it resumes an open payment: point it at the plan
--    the user actually picked, at that plan's current price, taken from the
--    plan row (never from the client).
create or replace function public.refresh_open_payment(p_payment_id varchar, p_plan_id varchar)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_payment public.payments;
    v_plan public.payment_plans;
begin
    if auth.uid() is null then
        raise exception 'Sign-in required.' using errcode = '28000';
    end if;

    select * into v_payment from public.payments where id = p_payment_id for update;
    if not found then
        raise exception 'Payment not found.' using errcode = 'P0002';
    end if;

    if not public.has_org_permission(v_payment.organization_id, 'payments.manage') then
        raise exception 'You do not have permission to change this payment.' using errcode = '42501';
    end if;

    if v_payment.status <> 'created' or v_payment.provider_transaction_id is not null then
        raise exception 'This payment can no longer be changed because a transaction reference was already submitted.' using errcode = 'P0001';
    end if;

    if v_payment.expires_at < now() then
        raise exception 'This payment window has expired. Please start a new payment.' using errcode = 'P0001';
    end if;

    select * into v_plan from public.payment_plans where id = p_plan_id and active = true;
    if not found then
        raise exception 'Payment plan not found.' using errcode = 'P0002';
    end if;

    -- a vacancy payment takes a vacancy plan; an organization payment a subscription plan
    if (v_payment.opportunity_id is null) <> (v_plan.plan_type = 'subscription') then
        raise exception 'That plan does not apply to this payment.' using errcode = 'P0001';
    end if;

    if v_payment.plan_id = v_plan.id
       and v_payment.amount_minor = v_plan.amount_minor
       and v_payment.currency = v_plan.currency then
        return v_payment;
    end if;

    update public.payments
       set plan_id = v_plan.id,
           amount_minor = v_plan.amount_minor,
           currency = v_plan.currency,
           description = v_plan.name || ' -- ' || case when v_plan.plan_type = 'subscription' then 'subscription upgrade' else 'vacancy publishing' end,
           expires_at = now() + interval '48 hours',
           updated_at = now()
     where id = p_payment_id
     returning * into v_payment;

    return v_payment;
end;
$$;

revoke all on function public.refresh_open_payment(varchar, varchar) from public, anon;
grant execute on function public.refresh_open_payment(varchar, varchar) to authenticated;

comment on function public.refresh_open_payment is
    'Re-quotes an unpaid, unreferenced payment to the chosen plan''s current price. Frozen once a transaction reference is submitted.';
