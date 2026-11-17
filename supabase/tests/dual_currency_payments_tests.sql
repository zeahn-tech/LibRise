-- =====================================================================
-- DUAL-CURRENCY (LRD + USD) PAYMENT TESTS -- LibRise
-- Companion to payments_security_tests.sql; same harness (pgTAP in the `extensions` schema, roles
-- impersonated via set_config inside ONE transaction that is always rolled back).
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -f supabase/tests/dual_currency_payments_tests.sql
--      (or supabase/tests/local/run.sh, which runs every suite against a disposable database)
--
-- Proves: LRD plan rows exist for every USD package; amount AND currency always come from the plan row
-- (a client cannot choose a price or a currency); LRD/USD vacancy, subscription (monthly + annual) and
-- listing-promotion payments; currency switch before submission; txn-id reuse protection across currencies;
-- admin approval/rejection of LRD payments; non-admins cannot approve or change prices; price changes are
-- audited and never rewrite a submitted payment; the display exchange rate never changes plan prices.
-- =====================================================================
begin;

select extensions.no_plan();

create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_status, is_verified, contact_email, contact_phone)
values
  ('org-dc-a', 'dc-org-a', 'DC Org A', 'employer', 'Technology', 'Montserrado', 'Sinkor', 'A', 'unverified', false, 'dca@example.com', '+231-770-300-001'),
  ('org-dc-b', 'dc-org-b', 'DC Org B', 'employer', 'Technology', 'Montserrado', 'Congo Town', 'B', 'unverified', false, 'dcb@example.com', '+231-770-300-002');
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values
  ('11111111-dc00-4aaa-8aaa-000000000001', 'dc-a@example.com', 'DC A Owner', '+231-770-300-011', 'employer', 'user', 'active'),
  ('11111111-dc00-4aaa-8aaa-000000000002', 'dc-b@example.com', 'DC B Owner', '+231-770-300-012', 'employer', 'user', 'active'),
  ('11111111-dc00-4aaa-8aaa-000000000003', 'dc-admin@example.com', 'DC Admin', '+231-770-300-013', 'platform_admin', 'platform_admin', 'active');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions)
values
  ('mem-dc-a', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'owner', 'active', '[]'::jsonb),
  ('mem-dc-b', 'org-dc-b', '11111111-dc00-4aaa-8aaa-000000000002', 'owner', 'active', '[]'::jsonb);
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status)
values
  ('opp-dc-lrd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'DC LRD vacancy', 'dc-lrd', 'job', 'onsite', 'Montserrado', 'Sinkor', 'x', 'payment_required'),
  ('opp-dc-usd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'DC USD vacancy', 'dc-usd', 'job', 'onsite', 'Montserrado', 'Sinkor', 'x', 'payment_required');
insert into public.business_listings (id, owner_user_id, title, slug, listing_type, industry, county, city_district, headline, description, status, is_confidential, asking_price_usd)
values
  ('biz-dc-lrd', '11111111-dc00-4aaa-8aaa-000000000001', 'DC LRD listing', 'dc-biz-lrd', 'business', 'DcIndustry', 'Montserrado', 'Sinkor', 'h', 'd', 'published', false, 1000),
  ('biz-dc-usd', '11111111-dc00-4aaa-8aaa-000000000001', 'DC USD listing', 'dc-biz-usd', 'business', 'DcIndustry', 'Montserrado', 'Sinkor', 'h', 'd', 'published', false, 1000);

-- 1. PLAN DATA (superuser view)
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_plans u where u.currency = 'USD' and u.active and not exists (select 1 from public.payment_plans l where l.price_group = u.price_group and l.currency = 'LRD')) = 0,
  '[plans] every active USD package has an LRD plan row'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_plans l join public.payment_plans u on u.price_group = l.price_group and u.currency = 'USD' where l.currency = 'LRD' and l.id = u.id || '-lrd' and l.plan_type = u.plan_type and l.subscription_tier is not distinct from u.subscription_tier and l.billing_cycle is not distinct from u.billing_cycle and l.duration_days = u.duration_days and l.promotion_level is not distinct from u.promotion_level) = (select count(*) from public.payment_plans where currency = 'LRD'),
  '[plans] each LRD plan mirrors its USD plan''s type, tier, cycle, duration and promotion level'
);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.payment_plans where currency = 'LRD' and plan_type = 'subscription')::int,
  4,
  '[plans] LRD subscription plans: Starter + Pro, monthly + annual'
);
insert into test_log(line) select * from extensions.is(
  (select duration_days from public.payment_plans where id = 'plan-sub-basic-monthly-lrd'),
  30,
  '[plans] LRD monthly = 30 days'
);
insert into test_log(line) select * from extensions.is(
  (select duration_days from public.payment_plans where id = 'plan-sub-pro-annual-lrd'),
  365,
  '[plans] LRD annual = 365 days'
);
insert into test_log(line) select * from extensions.is(
  (select amount_minor::text || '/' || currency from public.payment_plans where id = 'plan-sub-basic-monthly'),
  '1000/USD'::text,
  '[plans] existing USD plan id and price are unchanged'
);
insert into test_log(line) select * from extensions.ok(
  (select amount_minor from public.payment_plans where id = 'plan-sub-basic-monthly-lrd') > 1000 and (select amount_minor % 5000 from public.payment_plans where id = 'plan-sub-basic-monthly-lrd') = 0,
  '[plans] LRD price is a real LRD amount (whole 50-LRD steps), not a copy of the USD number'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.payment_plans (id, name, description, amount_minor, currency, duration_days, plan_type) values ('plan-eur', 'x', 'x', 100, 'EUR', 30, 'vacancy')$$,
  '23514'::char(5),
  NULL::text,
  '[constraints] a plan in an unsupported currency is rejected'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.payment_plans (id, name, description, amount_minor, currency, duration_days, plan_type, price_group) values ('plan-dup-lrd', 'x', 'x', 100, 'LRD', 30, 'subscription', 'plan-sub-basic-monthly')$$,
  '23505'::char(5),
  NULL::text,
  '[constraints] only one LRD plan per package'
);

-- 2. VACANCY PAYMENTS IN BOTH CURRENCIES (client-supplied amount and currency are ignored)
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-vlrd', 'pub-pay-dc-vlrd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'opp-dc-lrd', 'plan-vacancy-featured-lrd', 'manual_momo_mtn', 'OHL-DC-VLRD', 1, 'USD', 'created')$$,
  '[vacancy][LRD] owner creates a Featured payment on the LRD plan while claiming amount 1 / USD'
);
insert into test_log(line) select * from extensions.is(
  (select amount_minor from public.payments where id = 'pay-dc-vlrd'),
  (select amount_minor from public.payment_plans where id = 'plan-vacancy-featured-lrd'),
  '[vacancy][LRD] amount comes from the LRD plan row, not the client'
);
insert into test_log(line) select * from extensions.is(
  (select currency from public.payments where id = 'pay-dc-vlrd'),
  'LRD'::varchar,
  '[vacancy][LRD] currency is LRD even though the client sent USD'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-vusd', 'pub-pay-dc-vusd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'opp-dc-usd', 'plan-vacancy-featured', 'manual_momo_orange', 'OHL-DC-VUSD', 1, 'LRD', 'created')$$,
  '[vacancy][USD] owner creates a Featured payment on the USD plan while claiming amount 1 / LRD'
);
insert into test_log(line) select * from extensions.is(
  (select amount_minor::text || '/' || currency from public.payments where id = 'pay-dc-vusd'),
  '500/USD'::text,
  '[vacancy][USD] amount and currency come from the USD plan (500 = $5.00)'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-vdup', 'pub-dc-vdup', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'opp-dc-lrd', 'plan-vacancy-featured', 'manual_momo_mtn', 'OHL-DC-VDUP', 1, 'USD', 'created')$$,
  '23505'::char(5),
  NULL::text,
  '[vacancy] a second open payment for the same vacancy is rejected even in the other currency'
);
update public.payments set currency = 'USD', amount_minor = 1 where id = 'pay-dc-vlrd';
insert into test_log(line) select * from extensions.ok(
  (select currency = 'LRD' and amount_minor > 1 from public.payments where id = 'pay-dc-vlrd'),
  '[payments] an owner cannot edit currency/amount of their payment (no UPDATE policy: the update changes nothing)'
);
reset role;
select set_config('request.jwt.claim.sub','',true);

-- 3. SUBSCRIPTIONS: LRD monthly, currency switch before submission, USD annual
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-slrd', 'pub-pay-dc-slrd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'plan-sub-basic-monthly-lrd', 'manual_momo_mtn', 'OHL-DC-SLRD', 1, 'USD', 'created')$$,
  '[subscription][LRD monthly] owner starts an LRD Starter monthly checkout'
);
insert into test_log(line) select * from extensions.is(
  (select currency || ':' || amount_minor::text from public.payments where id = 'pay-dc-slrd'),
  (select currency || ':' || amount_minor::text from public.payment_plans where id = 'plan-sub-basic-monthly-lrd'),
  '[subscription][LRD monthly] quoted from the LRD plan'
);
insert into test_log(line) select * from extensions.is(
  (select (public.refresh_open_payment('pay-dc-slrd', 'plan-sub-basic-monthly')).currency),
  'USD'::varchar,
  '[switch] before a reference is submitted the same checkout can be switched to the USD plan'
);
insert into test_log(line) select * from extensions.is(
  (select amount_minor from public.payments where id = 'pay-dc-slrd'),
  1000,
  '[switch] ...and it is re-quoted at the USD plan price (not converted)'
);
insert into test_log(line) select * from extensions.is(
  (select (public.refresh_open_payment('pay-dc-slrd', 'plan-sub-basic-monthly-lrd')).plan_id),
  'plan-sub-basic-monthly-lrd'::varchar,
  '[switch] ...and back to LRD'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-dc-slrd', 'dc-txn-0001', '+231770000011')$$,
  '[submit][LRD] owner submits the transaction id'
);
insert into test_log(line) select * from extensions.is(
  (select status from public.payments where id = 'pay-dc-slrd'),
  'payment_pending'::varchar,
  '[submit][LRD] submitted = pending review, never success'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.refresh_open_payment('pay-dc-slrd', 'plan-sub-basic-monthly')$$,
  'P0001'::char(5),
  NULL::text,
  '[switch] once a reference is submitted the payment can no longer change plan or currency'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.organization_subscriptions where organization_id = 'org-dc-a' and tier = 'basic') = 0,
  '[subscription] nothing activates before an administrator approves'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000002',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-sann', 'pub-pay-dc-sann', 'org-dc-b', '11111111-dc00-4aaa-8aaa-000000000002', 'plan-sub-pro-annual', 'manual_momo_mtn', 'OHL-DC-SANN', 1, 'LRD', 'created')$$,
  '[subscription][USD annual] org B starts a USD Pro annual checkout'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.submit_payment_reference('pay-dc-sann', 'DC-TXN-0001', '+231770000012')$$,
  'P0001'::char(5),
  NULL::text,
  '[txn reuse] the same MTN transaction id (any letter case) cannot back a second live payment, across currencies'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-dc-sann', 'dc-txn-0002', '+231770000012')$$,
  '[submit][USD annual] org B submits its own transaction id'
);
reset role;
select set_config('request.jwt.claim.sub','',true);

-- 4. ADMIN APPROVAL / REJECTION
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.admin_review_payment('pay-dc-slrd', 'approve')$$,
  '42501'::char(5),
  NULL::text,
  '[approve] an organization owner cannot approve their own LRD payment'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.admin_set_payment_plan_price('plan-sub-basic-monthly-lrd', 1)$$,
  '42501'::char(5),
  NULL::text,
  '[prices] an organization owner cannot change plan prices'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-dc-slrd', 'approve', 'verified against the MTN statement: LRD')$$,
  '[approve][LRD monthly] admin approves the LRD monthly subscription'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-dc-sann', 'approve', 'verified against the MTN statement: USD')$$,
  '[approve][USD annual] admin approves the USD annual subscription'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.is(
  (select tier || '/' || billing_cycle || '/' || plan_id from public.organization_subscriptions where organization_id = 'org-dc-a'),
  'basic/monthly/plan-sub-basic-monthly-lrd'::text,
  '[approve][LRD monthly] org A now has Starter monthly (recorded against the LRD plan)'
);
insert into test_log(line) select * from extensions.ok(
  (select current_period_end - current_period_start from public.organization_subscriptions where organization_id = 'org-dc-a') between interval '29 days 23 hours' and interval '30 days 1 hour',
  '[approve][LRD monthly] period is 30 days'
);
insert into test_log(line) select * from extensions.is(
  (select tier || '/' || billing_cycle from public.organization_subscriptions where organization_id = 'org-dc-b'),
  'pro/annual'::text,
  '[approve][USD annual] org B now has Pro annual'
);
insert into test_log(line) select * from extensions.ok(
  (select current_period_end - current_period_start from public.organization_subscriptions where organization_id = 'org-dc-b') between interval '364 days 23 hours' and interval '365 days 1 hour',
  '[approve][USD annual] period is 365 days'
);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.organization_subscriptions where organization_id in ('org-dc-a','org-dc-b'))::int,
  2,
  '[approve] exactly one subscription row per organization (no duplicates)'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_events where payment_id in ('pay-dc-slrd','pay-dc-sann')) >= 2,
  '[audit] payment events are recorded for the approved payments'
);

-- 5. SUBSCRIPTION RENEWAL (same tier, other currency) EXTENDS the period
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-srenew', 'pub-pay-dc-srenew', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'plan-sub-basic-monthly', 'manual_momo_orange', 'OHL-DC-SRENEW', 1, 'LRD', 'created')$$,
  '[renewal] org A renews Starter monthly, this time in USD'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-dc-srenew', 'dc-txn-0003', '+231770000011')$$,
  '[renewal] reference submitted'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-dc-srenew', 'approve', 'verified')$$,
  '[renewal] admin approves'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.ok(
  (select current_period_end - now() from public.organization_subscriptions where organization_id = 'org-dc-a') > interval '59 days',
  '[renewal] renewing the same tier in the other currency extends the existing period (about 60 days remain)'
);

-- 6. VACANCY APPROVAL + REJECTION
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-dc-vlrd', 'dc-txn-0004', '+231770000011')$$,
  '[vacancy][LRD] reference submitted'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-dc-vusd', 'dc-txn-0005', '+231770000011')$$,
  '[vacancy][USD] reference submitted'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-dc-vlrd', 'approve', 'verified LRD')$$,
  '[vacancy][LRD] admin approves'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-dc-vusd', 'reject', 'amount did not match')$$,
  '[vacancy][USD] admin rejects'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.is(
  (select status from public.opportunities where id = 'opp-dc-lrd'),
  'published'::varchar,
  '[vacancy][LRD] approval publishes only the LRD-paid vacancy'
);
insert into test_log(line) select * from extensions.ok(
  (select status from public.opportunities where id = 'opp-dc-usd') <> 'published',
  '[vacancy][USD] a rejected payment does not publish its vacancy'
);
insert into test_log(line) select * from extensions.is(
  (select status from public.payments where id = 'pay-dc-vusd'),
  'payment_failed'::varchar,
  '[vacancy][USD] rejected payment is payment_failed'
);

-- 7. LISTING PROMOTIONS IN BOTH CURRENCIES
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, business_listing_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-llrd', 'pub-pay-dc-llrd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'biz-dc-lrd', 'plan-listing-featured-lrd', 'manual_momo_mtn', 'OHL-DC-LLRD', 1, 'USD', 'created')$$,
  '[listing][LRD] owner starts an LRD Featured listing promotion'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, business_listing_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status) values ('pay-dc-lusd', 'pub-pay-dc-lusd', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', 'biz-dc-usd', 'plan-listing-boost', 'manual_momo_mtn', 'OHL-DC-LUSD', 1, 'LRD', 'created')$$,
  '[listing][USD] owner starts a USD Boost listing promotion'
);
insert into test_log(line) select * from extensions.is(
  (select currency from public.payments where id = 'pay-dc-llrd') || (select currency from public.payments where id = 'pay-dc-lusd'),
  'LRDUSD'::text,
  '[listing] currencies come from the plans'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-dc-llrd', 'dc-txn-0006', '+231770000011')$$,
  '[listing][LRD] reference submitted'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-dc-llrd', 'approve', 'verified LRD')$$,
  '[listing][LRD] admin approves'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.is(
  (select promotion_level from public.business_listings where id = 'biz-dc-lrd'),
  'featured'::varchar,
  '[listing][LRD] the paid listing is promoted'
);
insert into test_log(line) select * from extensions.ok(
  (select promotion_until between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour' from public.business_listings where id = 'biz-dc-lrd'),
  '[listing][LRD] promotion lasts the plan''s 30 days'
);
insert into test_log(line) select * from extensions.ok(
  (select promotion_level is null from public.business_listings where id = 'biz-dc-usd'),
  '[listing] the other listing is untouched'
);

-- 8. PRICE INTEGRITY: price changes, audit, display exchange rate
insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
values ('pay-dc-frozen', 'pub-dc-frozen', 'org-dc-b', '11111111-dc00-4aaa-8aaa-000000000002', null, 'plan-sub-basic-monthly-lrd', 'manual_momo_mtn', 'OHL-DC-FROZEN', 1, 'LRD', 'created');
update public.payments set status = 'payment_pending', provider_transaction_id = 'DC-TXN-FROZEN', sender_phone_number = '+231770000012' where id = 'pay-dc-frozen';
insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
values ('pay-dc-open', 'pub-dc-open', 'org-dc-a', '11111111-dc00-4aaa-8aaa-000000000001', null, 'plan-sub-basic-monthly-lrd', 'manual_momo_orange', 'OHL-DC-OPEN', 1, 'LRD', 'created')
on conflict do nothing;
create temp table dc_before as select amount_minor as plan_amount from public.payment_plans where id = 'plan-sub-pro-monthly-lrd';
grant select on dc_before to authenticated;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_set_payment_plan_price('plan-sub-basic-monthly-lrd', 2000000)$$,
  '[prices] platform admin sets the LRD Starter monthly price'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.admin_set_payment_plan_price('plan-sub-basic-monthly-lrd', 0)$$,
  '22023'::char(5),
  NULL::text,
  '[prices] a zero/negative price is rejected'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.is(
  (select amount_minor from public.payment_plans where id = 'plan-sub-basic-monthly-lrd'),
  2000000,
  '[prices] LRD price updated'
);
insert into test_log(line) select * from extensions.is(
  (select amount_minor from public.payment_plans where id = 'plan-sub-basic-monthly'),
  1000,
  '[prices] the USD plan is not affected by the LRD price change'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_plan_price_history where plan_id = 'plan-sub-basic-monthly-lrd' and new_amount_minor = 2000000 and currency = 'LRD') = 1,
  '[prices][audit] the price change is recorded in the price history'
);
insert into test_log(line) select * from extensions.ok(
  (select amount_minor from public.payments where id = 'pay-dc-frozen') <> 2000000,
  '[prices] *** frozen quote *** a payment with a submitted transaction id keeps the amount it was quoted'
);
insert into test_log(line) select * from extensions.ok(
  (select amount_minor from public.payments where id = 'pay-dc-open') = 2000000,
  '[prices] an unpaid (created) LRD checkout is re-quoted to the new price'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.payment_plans set currency = 'USD' where id = 'plan-sub-basic-monthly-lrd'$$,
  'P0001'::char(5),
  NULL::text,
  '[prices] the currency of a plan that has payments cannot be changed'
);
insert into public.platform_settings (key, value) values ('usd_to_lrd', '400'::jsonb) on conflict (key) do update set value = excluded.value;
insert into test_log(line) select * from extensions.is(
  (select amount_minor from public.payment_plans where id = 'plan-sub-pro-monthly-lrd'),
  (select plan_amount from dc_before),
  '[exchange rate] changing the display exchange rate does not change any plan price'
);
insert into test_log(line) select * from extensions.ok(
  (select amount_minor from public.payments where id = 'pay-dc-slrd') <> 2000000 and (select amount_minor from public.payments where id = 'pay-dc-slrd') <> 400 * 10,
  '[exchange rate] an approved payment keeps its original LRD amount after rate and price changes'
);

-- 9. RLS: org B cannot see org A's LRD payments; payment plans are readable by everyone
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-dc00-4aaa-8aaa-000000000002',true);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payments where organization_id = 'org-dc-a') = 0,
  '[rls] org B cannot see org A''s payments (either currency)'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_plans where currency = 'LRD' and active) > 0,
  '[rls] active LRD plans are readable by signed-in users'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_plan_price_history) = 0,
  '[rls] the price history is admin-only'
);
reset role;
select set_config('request.jwt.claim.sub','',true);

-- FINAL: dump the log
select line from test_log order by seq;

rollback;
