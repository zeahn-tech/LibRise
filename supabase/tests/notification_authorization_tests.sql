-- =====================================================================
-- F-18 regression tests (migration 20261012210000): notification recipients.
-- begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- U1, U2: members of org-nf | X: unrelated user | C: candidate who applied to org-nf | PA: platform admin
-- B: buyer with a deal-room request on a listing owned by U1 | SU: suspended user
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0d0d0d0d-0000-4000-8000-000000000001', 'nf-u1@example.com', 'NF U1', '+231-770-700-001', 'employer',  'user', 'active'),
  ('0d0d0d0d-0000-4000-8000-000000000002', 'nf-u2@example.com', 'NF U2', '+231-770-700-002', 'recruiter', 'user', 'active'),
  ('0d0d0d0d-0000-4000-8000-000000000003', 'nf-x@example.com',  'NF X',  '+231-770-700-003', 'job_seeker','user', 'active'),
  ('0d0d0d0d-0000-4000-8000-000000000004', 'nf-c@example.com',  'NF C',  '+231-770-700-004', 'job_seeker','user', 'active'),
  ('0d0d0d0d-0000-4000-8000-000000000005', 'nf-pa@example.com', 'NF PA', '+231-770-700-005', 'platform_admin','platform_admin', 'active'),
  ('0d0d0d0d-0000-4000-8000-000000000006', 'nf-su@example.com', 'NF SU', '+231-770-700-006', 'employer',  'user', 'suspended');
insert into public.organizations (id, slug, name, type, industry, county, city_district, description)
values ('org-nf', 'org-nf', 'NF Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values
  ('nf-m1', 'org-nf', '0d0d0d0d-0000-4000-8000-000000000001', 'owner',  'active'),
  ('nf-m2', 'org-nf', '0d0d0d0d-0000-4000-8000-000000000002', 'member', 'active'),
  ('nf-m6', 'org-nf', '0d0d0d0d-0000-4000-8000-000000000006', 'member', 'active');
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status)
values ('opp-nf', 'org-nf', '0d0d0d0d-0000-4000-8000-000000000001', 'NF Job', 'nf-job', 'job', 'onsite', 'Montserrado', 'x', 'x', 'published');
insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage)
values ('app-nf', 'opp-nf', '0d0d0d0d-0000-4000-8000-000000000004', 'org-nf', 'NF C', 'nf-c@example.com', 'submitted');

-- ---------------- X: unrelated user ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n1', '0d0d0d0d-0000-4000-8000-000000000001', 'billing', 'Payment approved', 'forged')$$,
  '42501'::char(5), NULL::text, '[F-18][unrelated user] cannot create a notification for another user (was allowed)');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n2', '0d0d0d0d-0000-4000-8000-000000000004', 'application', 'Interview invite', 'forged')$$,
  '42501'::char(5), NULL::text, '[F-18][unrelated user] cannot notify a candidate either');
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message, action_url) values ('n3', '0d0d0d0d-0000-4000-8000-000000000003', 'system', 'Note to self', 'ok', '/billing')$$,
  '[F-18][any user] can still create a notification for themselves');
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n4', '0d0d0d0d-0000-4000-8000-000000000005', 'billing', 'Payment submitted', 'please review')$$,
  '[F-18][any user] can still notify a platform administrator (payment/verification hand-off)');
reset role;

-- ---------------- relationships that must keep working ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message, action_url) values ('n5', '0d0d0d0d-0000-4000-8000-000000000002', 'organization', 'Welcome', 'hi', '/recruiter')$$,
  '[F-18][org member -> org member] allowed');
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message, action_url) values ('n6', '0d0d0d0d-0000-4000-8000-000000000004', 'application', 'Status update', 'ok', '/candidate')$$,
  '[F-18][org member -> candidate who applied to that org] allowed');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message, action_url) values ('n7', '0d0d0d0d-0000-4000-8000-000000000002', 'organization', 'Login again', 'phish', 'https://evil.example/login')$$,
  '42501'::char(5), NULL::text, '[F-18][related recipient] an external action_url (phishing link) is rejected');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message, action_url) values ('n8', '0d0d0d0d-0000-4000-8000-000000000002', 'organization', 'Login again', 'phish', '//evil.example/login')$$,
  '42501'::char(5), NULL::text, '[F-18][related recipient] a protocol-relative action_url is rejected');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message, action_url) values ('n9', '0d0d0d0d-0000-4000-8000-000000000001', 'application', 'New application', 'ok', '/recruiter')$$,
  '[F-18][candidate -> member of the org they applied to] allowed');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n10', '0d0d0d0d-0000-4000-8000-000000000003', 'system', 'x', 'y')$$,
  '42501'::char(5), NULL::text, '[F-18][candidate -> a stranger] denied');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n11', '0d0d0d0d-0000-4000-8000-000000000003', 'billing', 'Payment approved', 'real')$$,
  '[F-18][platform admin -> any user] allowed (payment / verification decisions)');
reset role;

-- ---------------- suspended sender ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n12', '0d0d0d0d-0000-4000-8000-000000000002', 'organization', 'x', 'y')$$,
  '42501'::char(5), NULL::text, '[F-18][suspended org member] cannot notify even a colleague');
reset role;

-- ---------------- recipients still read only their own ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.notifications), 1::bigint, '[F-18][recipient] sees only notifications addressed to them');
reset role;

select line from test_log order by seq;
rollback;
