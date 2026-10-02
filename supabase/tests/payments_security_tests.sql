-- =====================================================================
-- PAYMENT SECURITY TESTS -- LibRise
-- Companion to rls_security_test_matrix.sql; same harness: pgTAP in the
-- `extensions` schema, roles impersonated via set_config('role', ...) +
-- request.jwt.claim.sub inside ONE transaction that is always ROLLED
-- BACK, so no fixture data persists.
--
-- Run (after `supabase db reset` / migrations applied):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -t -A -f supabase/tests/payments_security_tests.sql
-- Pass/fail = the `ok N - ...` / `not ok N - ...` lines it prints.
--
-- STATUS: WRITTEN BUT NEVER EXECUTED. The environment this was authored in
-- has no Docker/Postgres, so neither the migration nor these tests have
-- run against a real database. Expect to iterate (fixture column names,
-- pgTAP argument signatures) on the first real run, exactly as the
-- certification report says of the CI rls-security-tests job.
--
-- What this proves (spec: "Security tests"):
--   amount manipulation        -> server-authoritative pricing trigger
--   payment for another org's vacancy -> ownership check
--   duplicate payment          -> one-open-payment-per-vacancy index
--   duplicate / reused txn id  -> live-transaction unique index
--   publication without payment-> DB-level publish gate (P0402)
--   forged approval            -> non-admin cannot call admin_review_payment
--   direct status tampering    -> no UPDATE policy on payments
--   cross-tenant access        -> org B cannot see org A's payments
--   legitimate path works      -> admin approval publishes atomically and a
--                                 paid vacancy can be closed and reopened
-- =====================================================================
begin;

select extensions.no_plan();

create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_status, is_verified, contact_email, contact_phone)
values
  ('org-paytest-a', 'paytest-org-a', 'Pay Test Org A', 'employer', 'Technology', 'Montserrado', 'Sinkor', 'Org A', 'unverified', false, 'a@example.com', '+231-770-200-001'),
  ('org-paytest-b', 'paytest-org-b', 'Pay Test Org B', 'employer', 'Technology', 'Montserrado', 'Congo Town', 'Org B', 'unverified', false, 'b@example.com', '+231-770-200-002');

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values
  ('11111111-aaaa-4aaa-8aaa-000000000001', 'paytest-a-owner@example.com', 'Pay A Owner', '+231-770-200-011', 'employer', 'user', 'active'),
  ('11111111-aaaa-4aaa-8aaa-000000000002', 'paytest-b-owner@example.com', 'Pay B Owner', '+231-770-200-012', 'employer', 'user', 'active'),
  ('11111111-aaaa-4aaa-8aaa-000000000003', 'paytest-admin@example.com', 'Pay Platform Admin', '+231-770-200-013', 'platform_admin', 'platform_admin', 'active');

insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions)
values
  ('mem-paytest-a-owner', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'owner', 'active', '[]'::jsonb),
  ('mem-paytest-b-owner', 'org-paytest-b', '11111111-aaaa-4aaa-8aaa-000000000002', 'owner', 'active', '[]'::jsonb);

-- Org A has NO subscription row (=> free tier, quota 1) and already has one
-- published vacancy, so its free quota is exhausted. Fixtures are inserted
-- by the superuser (no JWT user), which the publish gate deliberately allows.
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status)
values
  ('opp-paytest-a-live',  'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'Existing live job', 'paytest-a-live', 'job', 'onsite', 'Montserrado', 'Sinkor', 'Already published', 'published'),
  ('opp-paytest-a-draft', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'Org A draft job',   'paytest-a-draft', 'job', 'onsite', 'Montserrado', 'Sinkor', 'Needs payment', 'draft'),
  ('opp-paytest-b-draft', 'org-paytest-b', '11111111-aaaa-4aaa-8aaa-000000000002', 'Org B draft job',   'paytest-b-draft', 'job', 'onsite', 'Montserrado', 'Congo Town', 'Org B draft', 'draft');

insert into test_log(line) select * from extensions.ok(true, '[FIXTURES] loaded successfully');

-- =============================================================================
-- 1. PUBLICATION WITHOUT PAYMENT (DB-level gate)
-- =============================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.opportunities set status = 'published' where id = 'opp-paytest-a-draft'$$,
  'P0402'::char(5), NULL::text,
  '[opportunities][org A owner, quota exhausted][UPDATE draft->published] *** payment gate *** cannot publish directly through the API without quota or an approved payment'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status)
    values ('opp-paytest-a-direct', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'Direct publish', 'paytest-a-direct', 'job', 'onsite', 'Montserrado', 'Sinkor', 'x', 'published')$$,
  'P0402'::char(5), NULL::text,
  '[opportunities][org A owner, quota exhausted][INSERT published] *** payment gate *** cannot insert an already-published vacancy without quota or payment'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.opportunities set status = 'payment_required' where id = 'opp-paytest-a-draft'$$,
  '[opportunities][org A owner][UPDATE -> payment_required] non-published status changes are unaffected by the gate'
);
reset role;

-- =============================================================================
-- 2. AMOUNT MANIPULATION / OWNERSHIP / DUPLICATES ON payments INSERT
-- =============================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-1', 'pub-paytest-1', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'opp-paytest-a-draft', 'plan-vacancy-basic', 'manual_momo_mtn', 'OHL-PAYTEST-1', 1, 'USD', 'created')$$,
  '[payments][org A owner][INSERT] recruiter can create a payment (attempting amount_minor = 1)'
);
insert into test_log(line) select * from extensions.ok(
  (select amount_minor from public.payments where id = 'pay-paytest-1') = 500,
  '[payments][amount manipulation] *** server-authoritative pricing *** client-supplied amount_minor = 1 was overwritten with the plan price (500)'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-dup', 'pub-paytest-dup', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'opp-paytest-a-draft', 'plan-vacancy-basic', 'manual_momo_mtn', 'OHL-PAYTEST-DUP', 500, 'USD', 'created')$$,
  '23505'::char(5), NULL::text,
  '[payments][duplicate payment] *** idempotency *** a second open payment for the same vacancy is rejected'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-xorg', 'pub-paytest-xorg', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'opp-paytest-b-draft', 'plan-vacancy-basic', 'manual_momo_mtn', 'OHL-PAYTEST-XORG', 500, 'USD', 'created')$$,
  '42501'::char(5), NULL::text,
  '[payments][payment for another org''s vacancy] *** ownership *** cannot create a payment against a vacancy belonging to a different organization'
);
-- Direct status tampering: there is deliberately no UPDATE policy at all.
with upd as (update public.payments set status = 'payment_success', paid_at = now() where id = 'pay-paytest-1' returning 1)
insert into test_log(line) select * from extensions.ok((select count(*) from upd) = 0,
  '[payments][org A owner][UPDATE] *** no direct writes *** recruiter cannot mark their own payment successful via a direct UPDATE');
with upd as (update public.payments set amount_minor = 1 where id = 'pay-paytest-1' returning 1)
insert into test_log(line) select * from extensions.ok((select count(*) from upd) = 0,
  '[payments][org A owner][UPDATE] recruiter cannot edit the amount of an existing payment');
reset role;

-- =============================================================================
-- 3. SUBMIT REFERENCE, THEN STILL CANNOT PUBLISH
-- =============================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-paytest-1', 'txn-abc-12345', '+231770000000')$$,
  '[payments][org A owner][submit_payment_reference] recruiter can submit a transaction reference'
);
insert into test_log(line) select * from extensions.ok(
  (select status from public.payments where id = 'pay-paytest-1') = 'payment_pending'
  and (select provider_transaction_id from public.payments where id = 'pay-paytest-1') = 'TXN-ABC-12345',
  '[payments][submit_payment_reference] status is payment_pending (NOT success) and the reference is normalized to upper case'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.opportunities set status = 'published' where id = 'opp-paytest-a-draft'$$,
  'P0402'::char(5), NULL::text,
  '[opportunities][payment_pending] *** frontend/self-report is not payment *** submitting a reference does NOT allow publishing'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.submit_payment_reference('pay-paytest-1', 'txn-other-999')$$,
  'P0001'::char(5), NULL::text,
  '[payments][submit_payment_reference] a reference cannot be resubmitted/changed once pending'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.admin_review_payment('pay-paytest-1', 'approve')$$,
  '42501'::char(5), NULL::text,
  '[payments][forged approval] *** authorization *** a non-admin recruiter cannot call admin_review_payment'
);
reset role;

-- =============================================================================
-- 4. CROSS-TENANT ISOLATION + REUSED TRANSACTION ID
-- =============================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000002',true);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payments where id = 'pay-paytest-1') = 0,
  '[payments][org B owner][SELECT] *** cross-tenant *** org B cannot see org A''s payments'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_events where payment_id = 'pay-paytest-1') = 0,
  '[payment_events][org B owner][SELECT] org B cannot see org A''s payment audit trail'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.submit_payment_reference('pay-paytest-1', 'TXN-B-ATTEMPT')$$,
  '42501'::char(5), NULL::text,
  '[payments][org B owner] cannot submit a reference on another org''s payment'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-b', 'pub-paytest-b', 'org-paytest-b', '11111111-aaaa-4aaa-8aaa-000000000002', 'opp-paytest-b-draft', 'plan-vacancy-basic', 'manual_momo_mtn', 'OHL-PAYTEST-B', 500, 'USD', 'created')$$,
  '[payments][org B owner][INSERT] org B can create its own payment'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.submit_payment_reference('pay-paytest-b', 'txn-abc-12345')$$,
  'P0001'::char(5), NULL::text,
  '[payments][reused transaction id] *** duplicate txn *** the same real transaction id (even in different letter case) cannot back a second live payment'
);
reset role;

-- =============================================================================
-- 5. ADMIN APPROVAL: the one legitimate path to publication
-- =============================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-paytest-1', 'approve', 'verified against MoMo statement')$$,
  '[payments][platform admin][admin_review_payment approve] admin can approve a pending payment'
);
insert into test_log(line) select * from extensions.ok(
  (select status from public.payments where id = 'pay-paytest-1') = 'payment_success'
  and (select paid_at from public.payments where id = 'pay-paytest-1') is not null
  and (select status from public.opportunities where id = 'opp-paytest-a-draft') = 'published',
  '[payments][admin approval] *** atomic *** payment is payment_success AND the vacancy is published in the same operation'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.admin_review_payment('pay-paytest-1', 'approve')$$,
  'P0001'::char(5), NULL::text,
  '[payments][admin approval] an already-approved payment cannot be approved again (no double processing)'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.payment_events where payment_id = 'pay-paytest-1') >= 3,
  '[payment_events][audit trail] created + pending + success transitions were each recorded automatically'
);
reset role;

-- A paid vacancy can be closed and reopened within its paid window.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.opportunities set status = 'draft' where id = 'opp-paytest-a-draft'$$,
  '[opportunities][paid vacancy] owner can take a paid vacancy back to draft'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.opportunities set status = 'published' where id = 'opp-paytest-a-draft'$$,
  '[opportunities][paid vacancy] *** paid coverage *** owner can republish a vacancy whose payment is approved and unexpired'
);
reset role;

-- =============================================================================
-- 6. EXPIRY: an abandoned payment must not block a fresh one forever
-- =============================================================================
reset role;
update public.payments set expires_at = now() - interval '1 hour' where id = 'pay-paytest-b';

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000002',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.submit_payment_reference('pay-paytest-b', 'TXN-LATE-1')$$,
  'P0001'::char(5), NULL::text,
  '[payments][expired] a reference cannot be submitted after the payment window has passed'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.expire_payment_if_stale('pay-paytest-b')$$,
  '[payments][expire_payment_if_stale] owner can expire their own stale unsubmitted payment'
);
insert into test_log(line) select * from extensions.ok(
  (select status from public.payments where id = 'pay-paytest-b') = 'payment_expired',
  '[payments][expired] stale unsubmitted payment is now payment_expired'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-b2', 'pub-paytest-b2', 'org-paytest-b', '11111111-aaaa-4aaa-8aaa-000000000002', 'opp-paytest-b-draft', 'plan-vacancy-basic', 'manual_momo_mtn', 'OHL-PAYTEST-B2', 500, 'USD', 'created')$$,
  '[payments][expired] after expiry the recruiter can start a fresh payment for the same vacancy'
);
reset role;

-- =============================================================================
-- 7. SUBSCRIPTION PAYMENTS: the hole that caused all this, now closed
-- =============================================================================
-- Direct writes to organization_subscriptions are no longer possible for
-- anyone but admin_review_payment() -- this is the actual fix for
-- "clicking Upgrade switched plans with nowhere to send money": that
-- mock path worked specifically because this table was writable by org
-- admins. Confirm it no longer is, for both INSERT and UPDATE.
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
with ins as (
  insert into public.organization_subscriptions (id, organization_id, plan_id, tier, status, billing_cycle, current_period_start, current_period_end)
  values ('osub-forged', 'org-paytest-a', 'plan-sub-pro-annual', 'pro', 'active', 'annual', now(), now() + interval '1 year')
  on conflict do nothing
  returning 1
)
insert into test_log(line) select * from extensions.ok((select count(*) from ins) = 0,
  '[organization_subscriptions][org A owner][INSERT] *** the actual fix *** org admin cannot grant themselves a paid tier directly -- no insert policy exists');
reset role;

-- Give org A a real existing baseline, then attempt a direct UPDATE as
-- well. This is fixture setup, not a test of access -- organization_
-- subscriptions now has ZERO write policies for any ordinary role (that
-- IS the fix), so even this connection's default "postgres" role is not
-- automatically exempt the way it is for other tables in this suite.
-- service_role is Supabase's real, designed-for-this RLS-bypass role
-- (what the backend's service-role key actually runs as) -- using it
-- here mirrors how a real trusted backend process would seed this, not
-- a loophole specific to this test.
select set_config('role','service_role',true);
insert into public.organization_subscriptions (id, organization_id, plan_id, tier, status, billing_cycle, current_period_start, current_period_end)
values ('osub-paytest-a', 'org-paytest-a', 'plan-sub-basic-monthly', 'basic', 'active', 'monthly', now(), now() + interval '30 days')
on conflict (organization_id) do nothing;
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
with upd as (update public.organization_subscriptions set tier = 'pro' where organization_id = 'org-paytest-a' returning 1)
insert into test_log(line) select * from extensions.ok((select count(*) from upd) = 0,
  '[organization_subscriptions][org A owner][UPDATE] org admin cannot upgrade their own tier directly either');
reset role;

-- Amount manipulation + ownership + the full approve path, same rigor as
-- the vacancy-payment tests above.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-sub', 'pub-paytest-sub', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', NULL, 'plan-sub-pro-annual', 'manual_momo_orange', 'OHL-PAYTEST-SUB', 1, 'USD', 'created')$$,
  '[payments][subscription][org A owner][INSERT] can start a subscription payment (attempting amount_minor = 1, no opportunity_id)'
);
insert into test_log(line) select * from extensions.ok(
  (select amount_minor from public.payments where id = 'pay-paytest-sub') = 143000,
  '[payments][subscription][amount manipulation] *** server-authoritative pricing *** overwritten with the real annual Pro price (143000 = $1,430.00)'
);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.payments (id, public_payment_id, organization_id, created_by_user_id, opportunity_id, plan_id, payment_provider, provider_reference, amount_minor, currency, status)
    values ('pay-paytest-sub-badopp', 'pub-paytest-sub-badopp', 'org-paytest-a', '11111111-aaaa-4aaa-8aaa-000000000001', 'opp-paytest-a-draft', 'plan-sub-pro-annual', 'manual_momo_orange', 'OHL-PAYTEST-SUB-BADOPP', 143000, 'USD', 'created')$$,
  'P0001'::char(5), NULL::text,
  '[payments][subscription] *** target integrity *** a subscription-plan payment must NOT reference an opportunity'
);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.submit_payment_reference('pay-paytest-sub', 'txn-sub-77777')$$,
  '[payments][subscription][submit_payment_reference] recruiter submits the reference same as a vacancy payment'
);
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','11111111-aaaa-4aaa-8aaa-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.admin_review_payment('pay-paytest-sub', 'approve', 'verified against MoMo statement')$$,
  '[payments][subscription][platform admin] admin can approve a pending subscription payment'
);
insert into test_log(line) select * from extensions.ok(
  (select status from public.payments where id = 'pay-paytest-sub') = 'payment_success'
  and (select tier from public.organization_subscriptions where organization_id = 'org-paytest-a') = 'pro'
  and (select status from public.organization_subscriptions where organization_id = 'org-paytest-a') = 'active'
  and (select plan_id from public.organization_subscriptions where organization_id = 'org-paytest-a') = 'plan-sub-pro-annual',
  '[payments][subscription][admin approval] *** atomic, the actual grant *** org A''s subscription is upserted to pro/active/plan-sub-pro-annual -- the ONLY way this happens now'
);
insert into test_log(line) select * from extensions.ok(
  (select count(*) from public.organization_subscriptions where organization_id = 'org-paytest-a') = 1,
  '[organization_subscriptions][upsert] approving a second time (conceptually) would update, not duplicate -- confirmed exactly one row exists for org A'
);
reset role;

-- =============================================================================
-- FINAL: dump the log
-- =============================================================================
select line from test_log order by seq;

rollback;
