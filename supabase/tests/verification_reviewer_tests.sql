-- =====================================================================
-- Regression tests for 20261023100000_verification_reviewer_role.sql
-- A verification officer can review requests, but cannot self-verify,
-- cannot perform other admin operations, and cannot be impersonated.
-- Everything runs inside begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values
 ('0e0e0e0e-0000-4000-8000-000000000001','vr-officer@example.com','VR Officer','+231-770-300-001','recruiter','verification_officer','active',true),
 ('0e0e0e0e-0000-4000-8000-000000000002','vr-submitter@example.com','VR Submitter','+231-770-300-002','employer','user','active',true),
 ('0e0e0e0e-0000-4000-8000-000000000003','vr-plain@example.com','VR Plain','+231-770-300-003','job_seeker','user','active',true),
 ('0e0e0e0e-0000-4000-8000-000000000004','vr-susp-officer@example.com','VR Suspended Officer','+231-770-300-004','recruiter','verification_officer','suspended',true);
insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_status) values
 ('org-vr-a','org-vr-a','VR Org A','employer','services','Montserrado','Monrovia','fixture','unverified'),
 ('org-vr-own','org-vr-own','VR Officer Own Org','employer','services','Montserrado','Monrovia','fixture','unverified');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values
 ('mem-vr-a','org-vr-a','0e0e0e0e-0000-4000-8000-000000000002','owner','active'),
 ('mem-vr-own','org-vr-own','0e0e0e0e-0000-4000-8000-000000000001','owner','active');
insert into public.verification_requests (id, entity_type, entity_id, entity_name, submitter_user_id, submitter_name, submitter_email, badge_requested, county) values
 ('vr-1','organization','org-vr-a','VR Org A','0e0e0e0e-0000-4000-8000-000000000002','VR Submitter','vr-submitter@example.com','verified_business','Montserrado'),
 ('vr-2','organization','org-vr-own','VR Officer Own Org','0e0e0e0e-0000-4000-8000-000000000001','VR Officer','vr-officer@example.com','verified_business','Montserrado');

-- Officer
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is((select count(*)::int from public.verification_requests), 2, '[officer] can see the review queue');
insert into test_log(line) select * from extensions.throws_ok($$select public.review_verification_request('vr-2','verified','self',null)$$, '42501'::char(5), NULL::text, '[officer] cannot verify their own organization (no self-granted badge)');
insert into test_log(line) select * from extensions.throws_ok($$select public.review_verification_request('vr-1','suspended','x',null)$$, '42501'::char(5), NULL::text, '[officer] cannot use the admin-only suspended decision');
insert into test_log(line) select * from extensions.throws_ok($$select public.review_verification_request('vr-1','bogus','x',null)$$, '22023'::char(5), NULL::text, '[officer] invalid decision rejected');
insert into test_log(line) select * from extensions.throws_ok($$update public.organizations set verification_status='verified', verification_badge='gold' where id='org-vr-own'$$, NULL::char(5), NULL::text, '[officer] cannot edit organization verification directly');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_user_system_role('0e0e0e0e-0000-4000-8000-000000000001','platform_admin')$$, '42501'::char(5), NULL::text, '[officer] cannot promote self via admin RPC');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_review_payment('nope','approve','x')$$, '42501'::char(5), NULL::text, '[officer] cannot review payments');
insert into test_log(line) select * from extensions.throws_ok($$select public.decide_verification_audit('nope','approved','x')$$, '42501'::char(5), NULL::text, '[officer] cannot use the legacy admin audit decision');
insert into test_log(line) select * from extensions.lives_ok($$select public.review_verification_request('vr-1','verified','ok',null)$$, '[officer] can verify another organization');
reset role;
insert into test_log(line) select * from extensions.is((select verification_status from public.organizations where id='org-vr-a'), 'verified', '[officer] decision updated the organization');
insert into test_log(line) select * from extensions.is((select verification_status from public.organizations where id='org-vr-own'), 'unverified', '[officer] own organization remained unverified');

-- Plain user
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.is((select count(*)::int from public.verification_requests), 0, '[plain user] cannot see the queue');
insert into test_log(line) select * from extensions.throws_ok($$select public.review_verification_request('vr-2','verified','x',null)$$, '42501'::char(5), NULL::text, '[plain user] cannot review');
reset role;

-- Suspended officer
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.review_verification_request('vr-2','verified','x',null)$$, NULL::char(5), NULL::text, '[suspended officer] cannot review');
reset role;

-- Anon
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.current_user_is_verification_reviewer()$$, '42501'::char(5), NULL::text, '[anon] cannot call the reviewer helper');
reset role;

select line from test_log order by seq;
rollback;
