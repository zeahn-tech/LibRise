-- Paid promotion for Business-for-Sale listings (Boost / Featured / Premium).
--
-- Basic presence stays FREE (Free plan: 1 active listing; Starter 3; Pro 10,
-- enforced by tier_limits()). A seller can optionally buy a time-limited
-- promotion for ONE listing through the SAME manual Mobile Money payment and
-- admin approval flow used for vacancies. Levels, ranking and rules mirror
-- vacancies; prices are the same $3 / $5 / $10 (Boost / Featured / Premium),
-- 30 / 30 / 45 days, taken from payment_plans (plan_type = 'listing').
-- Promotions expire by themselves (checked when read); the listing is never
-- touched. Sellers cannot set promotion columns themselves.
-- Safe to re-run.

alter table public.business_listings add column if not exists promotion_level varchar(10);
alter table public.business_listings add column if not exists promotion_until timestamptz;
alter table public.business_listings drop constraint if exists business_listings_promotion_level_check;
alter table public.business_listings add constraint business_listings_promotion_level_check
    check (promotion_level is null or promotion_level in ('boost', 'featured', 'premium'));

-- A payment targets at most one of: a vacancy, a listing (neither = subscription).
alter table public.payments add column if not exists business_listing_id varchar(100)
    references public.business_listings(id) on delete cascade;
alter table public.payments drop constraint if exists payments_single_target_check;
alter table public.payments add constraint payments_single_target_check
    check (not (opportunity_id is not null and business_listing_id is not null));
-- One open SUBSCRIPTION payment per organization: it used to be "opportunity_id is
-- null", which would now also match listing promotions. Narrow it to true
-- subscription payments (no vacancy and no listing).
drop index if exists public.uq_payments_one_open_subscription_per_org;
create unique index uq_payments_one_open_subscription_per_org
    on public.payments(organization_id)
    where opportunity_id is null and business_listing_id is null and status in ('created', 'payment_pending');

create index if not exists idx_payments_business_listing_id on public.payments(business_listing_id);
create unique index if not exists uq_payments_one_open_per_listing
    on public.payments(business_listing_id)
    where business_listing_id is not null and status in ('created', 'payment_pending');

insert into public.payment_plans (id, name, description, amount_minor, currency, duration_days, features, plan_type, subscription_tier, billing_cycle, promotion_level, active)
values
    ('plan-listing-boost', 'Boost', 'Optional visibility boost for your business listing: a Boosted badge and better placement than basic listings.', 300, 'USD', 30,
        '["Boosted badge", "Ranks above basic listings", "30 days"]'::jsonb, 'listing', null, null, 'boost', true),
    ('plan-listing-featured', 'Featured', 'Stronger visibility for your business listing: a Featured badge and placement above boosted and basic listings.', 500, 'USD', 30,
        '["Featured badge", "Ranks above Boost and basic listings", "30 days"]'::jsonb, 'listing', null, null, 'featured', true),
    ('plan-listing-premium', 'Premium', 'Maximum visibility for one business listing: a Premium badge and top placement above all other listings.', 1000, 'USD', 45,
        '["Premium badge", "Top placement above all other listings", "45 days"]'::jsonb, 'listing', null, null, 'premium', true)
on conflict (id) do update set
    name = excluded.name, description = excluded.description, amount_minor = excluded.amount_minor,
    currency = excluded.currency, duration_days = excluded.duration_days, features = excluded.features,
    plan_type = excluded.plan_type, promotion_level = excluded.promotion_level, active = true, updated_at = now();

-- ---------------------------------------------------------------------
-- Server-side pricing + target validation, now with the listing target.
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
    v_listing_owner varchar;
    v_listing_status varchar;
begin
    select * into v_plan from public.payment_plans where id = new.plan_id and active = true;
    if v_plan.id is null then
        raise exception 'Unknown or inactive payment plan.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'vacancy' and new.opportunity_id is null then
        raise exception 'A vacancy payment must reference an opportunity.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'listing' and new.business_listing_id is null then
        raise exception 'A listing promotion must reference a business listing.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'subscription' and (new.opportunity_id is not null or new.business_listing_id is not null) then
        raise exception 'A subscription payment must not reference a vacancy or a listing.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'vacancy' and new.business_listing_id is not null then
        raise exception 'A vacancy payment must not reference a business listing.' using errcode = 'P0001';
    end if;
    if v_plan.plan_type = 'listing' and new.opportunity_id is not null then
        raise exception 'A listing promotion must not reference a vacancy.' using errcode = 'P0001';
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

    if new.business_listing_id is not null then
        select owner_user_id, status into v_listing_owner, v_listing_status
          from public.business_listings where id = new.business_listing_id;
        -- only the listing's own seller can pay to promote it, and only while it is live
        if v_listing_owner is null or v_listing_owner <> new.created_by_user_id then
            raise exception 'This business listing does not belong to you.' using errcode = '42501';
        end if;
        if v_listing_status <> 'published' then
            raise exception 'Only a published business listing can be promoted.' using errcode = 'P0001';
        end if;
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Checkout re-quote (refresh_open_payment) understands the listing target.
-- ---------------------------------------------------------------------
create or replace function public.refresh_open_payment(p_payment_id varchar, p_plan_id varchar)
returns public.payments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_payment public.payments;
    v_plan public.payment_plans;
    v_kind varchar;
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

    v_kind := case when v_payment.business_listing_id is not null then 'listing'
                   when v_payment.opportunity_id is not null then 'vacancy'
                   else 'subscription' end;
    if v_plan.plan_type <> v_kind then
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
           description = v_plan.name || ' -- ' || case v_kind
               when 'subscription' then 'subscription upgrade'
               when 'listing' then 'business listing promotion'
               else 'vacancy publishing' end,
           expires_at = now() + interval '48 hours',
           updated_at = now()
     where id = p_payment_id
     returning * into v_payment;

    return v_payment;
end;
$$;
revoke all on function public.refresh_open_payment(varchar, varchar) from public, anon;
grant execute on function public.refresh_open_payment(varchar, varchar) to authenticated;

-- ---------------------------------------------------------------------
-- Sellers cannot write promotion columns; only admin approval can.
-- ---------------------------------------------------------------------
create or replace function public.guard_listing_promotion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid varchar;
begin
    v_uid := auth.uid()::varchar;
    if v_uid is null or public.is_platform_admin(v_uid) then
        return new;
    end if;
    if tg_op = 'INSERT' then
        new.promotion_level := null;
        new.promotion_until := null;
    else
        new.promotion_level := old.promotion_level;
        new.promotion_until := old.promotion_until;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_guard_listing_promotion on public.business_listings;
create trigger trg_guard_listing_promotion
    before insert or update of promotion_level, promotion_until on public.business_listings
    for each row execute function public.guard_listing_promotion();

-- ---------------------------------------------------------------------
-- Browse order: paid promotion first (server-side, so it holds across pages).
-- ---------------------------------------------------------------------
create or replace function public.list_business_listings_public(
  p_county text default null,
  p_industry text default null,
  p_listing_type text default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    case
      when auth.uid()::varchar = b.owner_user_id then to_jsonb(b)
      when not b.is_confidential then to_jsonb(b)
      when auth.uid() is not null and exists (
        select 1
        from public.business_access_requests r
        where r.listing_id = b.id
          and r.buyer_user_id = auth.uid()::varchar
          and r.status = 'approved'
          and r.nda_signed = true
      ) then to_jsonb(b)
      else to_jsonb(b)
        - 'annual_revenue_usd' - 'annual_cash_flow_usd' - 'exact_address'
        - 'seller_name' - 'seller_contact_email' - 'seller_contact_phone'
    end
  from public.business_listings b
  where b.status = 'published'
    and (p_county is null or b.county = p_county)
    and (p_industry is null or b.industry = p_industry)
    and (p_listing_type is null or b.listing_type = p_listing_type)
  -- Paid promotion first (Premium > Featured > Boost), only while it is in
  -- date; everything else, and expired promotions, newest first.
  order by case when b.promotion_until > now()
                then case b.promotion_level when 'premium' then 3 when 'featured' then 2 when 'boost' then 1 else 0 end
                else 0 end desc,
           b.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.list_business_listings_public(text, text, text, integer, integer) from public;
grant execute on function public.list_business_listings_public(text, text, text, integer, integer) to authenticated, anon;

-- ---------------------------------------------------------------------
-- admin_review_payment(): same as 20261009100000 plus the listing branch.
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
        elsif v_payment.business_listing_id is not null then
            -- Business-for-Sale listing promotion (same Boost/Featured/Premium
            -- levels and rules as vacancies). The listing is already published;
            -- approval only switches the time-limited promotion on. A stronger
            -- active promotion is never downgraded by a weaker purchase.
            select b.promotion_level, b.promotion_until
              into v_cur_level, v_cur_until
              from public.business_listings b
             where b.id = v_payment.business_listing_id
             for update;

            v_rank_new := case v_plan.promotion_level when 'premium' then 3 when 'featured' then 2 when 'boost' then 1 else 0 end;
            v_rank_cur := case when v_cur_until is not null and v_cur_until > now()
                               then case v_cur_level when 'premium' then 3 when 'featured' then 2 when 'boost' then 1 else 0 end
                               else 0 end;

            update public.business_listings
            set promotion_level = case when v_rank_new >= v_rank_cur then v_plan.promotion_level else promotion_level end,
                promotion_until = case
                    when v_rank_new > v_rank_cur or v_rank_cur = 0 then now() + make_interval(days => v_plan.duration_days)
                    else promotion_until + make_interval(days => v_plan.duration_days) end,
                updated_at = now()
            where id = v_payment.business_listing_id;
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
