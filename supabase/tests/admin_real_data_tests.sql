-- Regression tests for 20261026100000_admin_real_data.sql: admin-only access, moderation reason + notification,
-- settings validation, plan changes and audit entry.
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values
 ('0b0b0b0b-0000-4000-8000-000000000001','ar-admin@example.com','AR Admin','+231-770-500-001','platform_admin','platform_admin','active',true),
 ('0b0b0b0b-0000-4000-8000-000000000002','ar-owner@example.com','AR Owner','+231-770-500-002','employer','user','active',true),
 ('0b0b0b0b-0000-4000-8000-000000000003','ar-user@example.com','AR User','+231-770-500-003','job_seeker','user','active',true);
insert into public.organizations (id, slug, name, type, industry, county, city_district, description) values
 ('org-ar','org-ar','AR Org','private_company','services','Montserrado','Monrovia','fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions) values
 ('ar-m-owner','org-ar','0b0b0b0b-0000-4000-8000-000000000002','owner','active','[]'::jsonb);
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values
 ('opp-ar-pub','org-ar','0b0b0b0b-0000-4000-8000-000000000002','AR Published','ar-published','job','onsite','Montserrado','x','x','published'),
 ('opp-ar-draft','org-ar','0b0b0b0b-0000-4000-8000-000000000002','AR Draft','ar-draft','job','onsite','Montserrado','x','x','draft');

-- 1. A normal user is refused by every admin function.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_platform_metrics(7)$$, '42501'::char(5), NULL::text, '[user] cannot read platform metrics');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_revenue_overview(6)$$, '42501'::char(5), NULL::text, '[user] cannot read revenue overview');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.admin_list_payments(10)$$, '42501'::char(5), NULL::text, '[user] cannot read the payments ledger');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.admin_list_subscriptions()$$, '42501'::char(5), NULL::text, '[user] cannot list subscriptions');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_subscription('org-ar','pro',30)$$, '42501'::char(5), NULL::text, '[user] cannot change a plan');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_moderate_opportunity('opp-ar-pub','quarantined','a good reason')$$, '42501'::char(5), NULL::text, '[user] cannot moderate a vacancy');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('usd_to_lrd', to_jsonb(190))$$, '42501'::char(5), NULL::text, '[user] cannot change platform settings');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_log_action('report.resolve','content_report','x','{}'::jsonb)$$, '42501'::char(5), NULL::text, '[user] cannot write an audit entry');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.platform_settings(key,value) values ('usd_to_lrd', to_jsonb(1))$$, '42501'::char(5), NULL::text, '[user] cannot write platform_settings directly');

-- 2. Settings are readable by anyone (anon) once set, never writable directly.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_set_platform_setting('announcement', '{"enabled": true, "message": "Maintenance on Sunday"}'::jsonb)$$, '[admin] can publish an announcement');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_set_platform_setting('usd_to_lrd', to_jsonb(190.5))$$, '[admin] can set the exchange rate');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_set_platform_setting('extra_industries', '["Fisheries","Rubber"]'::jsonb)$$, '[admin] can add industries');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('announcement', '{"enabled": true, "message": ""}'::jsonb)$$, '22023'::char(5), NULL::text, '[admin] an enabled announcement needs a message');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('announcement', '{"enabled": true}'::jsonb)$$, '22023'::char(5), NULL::text, '[admin] a missing message field is rejected, not skipped');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('usd_to_lrd', to_jsonb(10))$$, '22023'::char(5), NULL::text, '[admin] an out-of-range rate is rejected');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('extra_industries', '["Dup","dup"]'::jsonb)$$, '22023'::char(5), NULL::text, '[admin] duplicate industries are rejected');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('maintenance_mode', 'true'::jsonb)$$, '22023'::char(5), NULL::text, '[admin] unknown keys are rejected');
reset role;
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.is((select value ->> 'message' from public.platform_settings where key='announcement'), 'Maintenance on Sunday', '[anon] can read the announcement');
insert into test_log(line) select * from extensions.is((select (value #>> '{}')::numeric from public.platform_settings where key='usd_to_lrd'), 190.5, '[anon] can read the exchange rate');
reset role;
-- Regression: a signed-in user once got "permission denied for function is_account_suspended" here, so the banner never
-- reached signed-in people. Signed-in users (and admins) must be able to read the settings too.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.is((select value ->> 'message' from public.platform_settings where key='announcement'), 'Maintenance on Sunday', '[signed-in user] can read the announcement');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is((select (value #>> '{}')::numeric from public.platform_settings where key='usd_to_lrd'), 190.5, '[admin] can read the exchange rate while signed in');
reset role;

-- 3. Moderation: reason required, status/visibility change, employer notified, drafts are not force-published.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_moderate_opportunity('opp-ar-pub','quarantined',null)$$, '22023'::char(5), NULL::text, '[admin] quarantine requires a reason');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_moderate_opportunity('opp-ar-pub','quarantined','no')$$, '22023'::char(5), NULL::text, '[admin] a too-short reason is rejected');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_moderate_opportunity('opp-ar-pub','bogus','long enough reason')$$, '22023'::char(5), NULL::text, '[admin] unknown moderation status is rejected');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_moderate_opportunity('opp-ar-pub','quarantined','Asks applicants to pay a fee')$$, '[admin] can quarantine with a reason');
reset role;
insert into test_log(line) select * from extensions.is((select status || '/' || moderation_status || '/' || moderation_note from public.opportunities where id='opp-ar-pub'), 'archived/quarantined/Asks applicants to pay a fee', 'quarantine hides the vacancy and stores the reason');
insert into test_log(line) select * from extensions.is((select count(*) from public.notifications where recipient_user_id='0b0b0b0b-0000-4000-8000-000000000002' and context_id='opp-ar-pub'), 1::bigint, 'the employer owner is notified of the quarantine');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_moderate_opportunity('opp-ar-pub','published')$$, '[admin] can restore a quarantined vacancy');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_moderate_opportunity('opp-ar-draft','published')$$, '[admin] can approve a draft without publishing it');
reset role;
insert into test_log(line) select * from extensions.is((select status || '/' || moderation_status from public.opportunities where id='opp-ar-pub'), 'published/published', 'restore puts the vacancy back live');
insert into test_log(line) select * from extensions.is((select status from public.opportunities where id='opp-ar-draft'), 'draft', 'approving a draft leaves it a draft');
insert into test_log(line) select * from extensions.ok(exists(select 1 from public.audit_logs where action='opportunity.moderate' and resource_id='opp-ar-pub'), 'moderation is written to the audit trail');

-- 4. Plans and analytics.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_set_subscription('org-ar','pro',14)$$, '[admin] can grant a plan');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_subscription('org-ar','enterprise',14)$$, '22023'::char(5), NULL::text, '[admin] unknown plan tiers are rejected');
insert into test_log(line) select * from extensions.is((select tier from public.admin_list_subscriptions() where organization_id='org-ar'), 'pro', 'the plan list reflects the granted tier');
insert into test_log(line) select * from extensions.ok((public.admin_platform_metrics(7) -> 'totals' ->> 'users')::int >= 3, 'metrics count real users');
insert into test_log(line) select * from extensions.is(jsonb_array_length(public.admin_platform_metrics(7) -> 'daily'), 7, 'metrics return one row per requested day');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_log_action('report.resolve','content_report','ar-report','{"action":"dismissed"}'::jsonb)$$, '[admin] can write an audit entry for a report decision');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_log_action('user.delete','user','x','{}'::jsonb)$$, '22023'::char(5), NULL::text, '[admin] only whitelisted audit actions are accepted');
reset role;

select line from test_log order by seq;
rollback;
