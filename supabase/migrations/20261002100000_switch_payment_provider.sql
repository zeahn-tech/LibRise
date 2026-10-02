-- ---------------------------------------------------------------------
-- Let a recruiter switch between MTN Mobile Money and Orange Money on a
-- payment they have started but not yet paid/submitted.
--
-- Why: starting a payment is idempotent (one open payment per vacancy /
-- subscription, enforced by unique indexes), so tapping "Orange Money" after
-- an open MTN payment already exists used to silently reuse the MTN payment
-- while the screen showed the Orange number. The recruiter would pay via
-- Orange while the record said MTN, and an admin checking MTN history would
-- reject it.
--
-- Safety: payments deliberately have NO UPDATE policy for anyone, so this is
-- a SECURITY DEFINER function that changes exactly ONE column. It only works
--   * for a member who can manage payments for that organization,
--   * while status = 'created' (no transaction reference submitted yet), and
--   * before the payment window has expired.
-- Amount, plan, status and reviewer fields can never be touched through it.
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------
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
