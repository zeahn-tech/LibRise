-- Dual-currency (LRD + USD) payment plans for manual mobile money payments.
--
-- WHAT THIS DOES
--   * Every package (subscription, vacancy promotion, listing promotion) now exists as TWO
--     payment_plans rows: the existing USD row (id unchanged) and a new LRD row (id = '<usd id>-lrd').
--     Both share a `price_group` (the currency-independent package key, = the USD plan id) so the app
--     can pair them. No existing id, subscription, payment or foreign key is changed.
--   * The LRD price is an INDEPENDENT, administrator-set price, NOT a live conversion. It is seeded once
--     from the platform's usd_to_lrd benchmark (falling back to 195), rounded to the nearest LRD 50, and
--     is never touched again by this migration (re-running it does not overwrite edited prices).
--     Changing the display exchange rate (platform_settings.usd_to_lrd) does NOT change any plan price
--     and never changes an existing payment.
--   * The currency of a plan that payments already reference can no longer be changed.
--   * Plan price changes are audited (payment_plan_price_history).
--   * admin_set_payment_plan_price(): the sanctioned way for a platform admin to change a plan price.
--     Unpaid ('created') checkouts are re-quoted by the existing trigger; payments with a submitted
--     transaction reference keep the amount they were quoted (their amount/currency are frozen).
--
-- Payment security is unchanged: payments_enforce_server_pricing() still overwrites amount/currency from
-- the plan row, admin_review_payment() is still the only way to approve/reject, and RLS is untouched.
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------
-- 1. price_group: pairs the USD and LRD rows of one package
-- ---------------------------------------------------------------------
alter table public.payment_plans add column if not exists price_group varchar(100);

update public.payment_plans set price_group = id where price_group is null;

create or replace function public.payment_plans_default_price_group()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
    new.price_group := coalesce(new.price_group, new.id);
    return new;
end;
$$;

drop trigger if exists trg_payment_plans_default_price_group on public.payment_plans;
create trigger trg_payment_plans_default_price_group
    before insert on public.payment_plans
    for each row execute function public.payment_plans_default_price_group();

alter table public.payment_plans alter column price_group set not null;

-- ---------------------------------------------------------------------
-- 2. Constraints and indexes
-- ---------------------------------------------------------------------
alter table public.payment_plans drop constraint if exists payment_plans_currency_check;
alter table public.payment_plans add constraint payment_plans_currency_check
    check (currency in ('USD', 'LRD'));

-- One plan per package per currency.
create unique index if not exists uq_payment_plans_price_group_currency
    on public.payment_plans (price_group, currency);

create index if not exists idx_payment_plans_type_currency_active
    on public.payment_plans (plan_type, currency) where active;

-- Payments may only ever be in a supported currency. NOT VALID first so a stray legacy row can never abort
-- the migration; validated right after, and only reported (not fatal) if a legacy row disagrees.
alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments add constraint payments_currency_check
    check (currency in ('USD', 'LRD')) not valid;

do $$
begin
    alter table public.payments validate constraint payments_currency_check;
exception when check_violation then
    raise notice 'payments_currency_check left NOT VALID: some legacy payments use another currency. New payments are still enforced.';
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Seed the LRD plan rows (never overwrites an existing/edited row)
-- ---------------------------------------------------------------------
do $$
declare
    v_rate numeric;
begin
    select (value #>> '{}')::numeric into v_rate
      from public.platform_settings
     where key = 'usd_to_lrd' and jsonb_typeof(value) = 'number';
    if v_rate is null or v_rate < 50 or v_rate > 1000 then
        v_rate := 195;
    end if;

    insert into public.payment_plans (
        id, name, description, amount_minor, currency, duration_days, features, active,
        plan_type, subscription_tier, billing_cycle, promotion_level, price_group
    )
    select
        u.price_group || '-lrd',
        u.name,
        -- Annual descriptions quote a USD saving ("Save $20 annually."); that would be wrong on an LRD plan.
        nullif(btrim(regexp_replace(coalesce(u.description, ''), '\s*Save \$[0-9,.]+ annually\.?', '', 'g')), ''),
        (greatest(1, round((u.amount_minor / 100.0) * v_rate / 50)) * 50 * 100)::integer,
        'LRD',
        u.duration_days,
        u.features,
        u.active,
        u.plan_type,
        u.subscription_tier,
        u.billing_cycle,
        u.promotion_level,
        u.price_group
    from public.payment_plans u
    where u.currency = 'USD' and u.active
    on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. A plan's currency is immutable once any payment references it
-- ---------------------------------------------------------------------
create or replace function public.guard_payment_plan_currency()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
    if new.currency is distinct from old.currency
       and exists (select 1 from public.payments where plan_id = old.id) then
        raise exception 'The currency of a payment plan that already has payments cannot be changed. Create a plan in the other currency instead.'
            using errcode = 'P0001';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_guard_payment_plan_currency on public.payment_plans;
create trigger trg_guard_payment_plan_currency
    before update of currency on public.payment_plans
    for each row execute function public.guard_payment_plan_currency();

-- ---------------------------------------------------------------------
-- 5. Price-change audit trail
-- ---------------------------------------------------------------------
create table if not exists public.payment_plan_price_history (
    id bigint generated always as identity primary key,
    plan_id varchar(100) not null references public.payment_plans(id) on delete cascade,
    currency varchar(10) not null,
    old_amount_minor integer not null,
    new_amount_minor integer not null,
    changed_by_user_id varchar(100),
    changed_at timestamptz not null default now()
);

create index if not exists idx_payment_plan_price_history_plan
    on public.payment_plan_price_history (plan_id, changed_at desc);

alter table public.payment_plan_price_history enable row level security;
revoke all on public.payment_plan_price_history from anon, authenticated;
grant select on public.payment_plan_price_history to authenticated;

drop policy if exists "Platform admins can view plan price history" on public.payment_plan_price_history;
create policy "Platform admins can view plan price history" on public.payment_plan_price_history
    for select to authenticated
    using (public.is_platform_admin(auth.uid()::varchar));

-- Suspended accounts are blocked on every RLS table (repo-wide invariant, see platform_settings).
drop policy if exists "restrict_suspended_accounts" on public.payment_plan_price_history;
create policy "restrict_suspended_accounts" on public.payment_plan_price_history
    as restrictive for all to authenticated
    using ((select not public.current_account_suspended())) with check ((select not public.current_account_suspended()));

-- No INSERT/UPDATE/DELETE policy: rows are written only by the trigger below.
create or replace function public.log_payment_plan_price_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    if new.amount_minor is distinct from old.amount_minor then
        insert into public.payment_plan_price_history (plan_id, currency, old_amount_minor, new_amount_minor, changed_by_user_id)
        values (new.id, new.currency, old.amount_minor, new.amount_minor, auth.uid()::varchar);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_log_payment_plan_price_change on public.payment_plans;
create trigger trg_log_payment_plan_price_change
    after update of amount_minor on public.payment_plans
    for each row execute function public.log_payment_plan_price_change();

-- ---------------------------------------------------------------------
-- 6. admin_set_payment_plan_price(): platform admins only
--    Changes the price of ONE plan row (so the LRD and USD prices are set independently).
--    p_amount_minor is in minor units (cents): LRD 2,500.00 = 250000.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_payment_plan_price(p_plan_id varchar, p_amount_minor integer)
returns public.payment_plans
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
    v_plan public.payment_plans;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null or not public.is_platform_admin(v_uid) then
        raise exception 'You do not have permission to change payment plan prices.' using errcode = '42501';
    end if;
    if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 1000000000 then
        raise exception 'The price must be a positive amount in minor units (e.g. 250000 = 2,500.00).' using errcode = '22023';
    end if;

    update public.payment_plans
       set amount_minor = p_amount_minor, updated_at = now()
     where id = p_plan_id and active
     returning * into v_plan;

    if v_plan.id is null then
        raise exception 'Payment plan not found.' using errcode = 'P0002';
    end if;
    return v_plan;
end;
$$;

revoke all on function public.admin_set_payment_plan_price(varchar, integer) from public, anon;
grant execute on function public.admin_set_payment_plan_price(varchar, integer) to authenticated;

comment on function public.admin_set_payment_plan_price(varchar, integer) is
    'Platform admin sets the price of one payment plan row. LRD and USD rows are priced independently; the display exchange rate never changes plan prices. Unpaid (created) checkouts are re-quoted by trg_requote_open_payments; payments with a submitted reference keep their quoted amount.';

-- Trigger functions are not meant to be called directly.
revoke all on function public.payment_plans_default_price_group() from public, anon, authenticated;
revoke all on function public.guard_payment_plan_currency() from public, anon, authenticated;
revoke all on function public.log_payment_plan_price_change() from public, anon, authenticated;
