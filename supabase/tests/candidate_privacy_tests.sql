-- =====================================================================
-- F-17 regression tests: candidate profile visibility / anon access
-- (migration 20261012170000_candidate_profile_privacy.sql). begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- users: C-pub/C-priv/C-hid/C-reg/C-ver/C-bogus candidates; V recruiter in VERIFIED org; U recruiter in UNVERIFIED org;
--        J plain job seeker; PA platform admin; C-applied is 'private' but applied to org-cp-ver
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0c0c0c0c-0000-4000-8000-000000000001', 'cp-pub@example.com',  'CP Public',  '+231-770-500-001', 'job_seeker', 'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-000000000002', 'cp-priv@example.com', 'CP Private', '+231-770-500-002', 'job_seeker', 'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-000000000003', 'cp-hid@example.com',  'CP Hidden',  '+231-770-500-003', 'job_seeker', 'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-000000000004', 'cp-reg@example.com',  'CP Registered','+231-770-500-004','job_seeker','user', 'active'),
  ('0c0c0c0c-0000-4000-8000-000000000005', 'cp-ver@example.com',  'CP VerEmp',  '+231-770-500-005', 'job_seeker', 'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-000000000006', 'cp-bogus@example.com','CP Bogus',   '+231-770-500-006', 'job_seeker', 'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-000000000007', 'cp-applied@example.com','CP Applied','+231-770-500-007','job_seeker','user', 'active'),
  ('0c0c0c0c-0000-4000-8000-0000000000a1', 'cp-v@example.com',    'CP V',       '+231-770-500-011', 'recruiter',  'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-0000000000a2', 'cp-u@example.com',    'CP U',       '+231-770-500-012', 'recruiter',  'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-0000000000a3', 'cp-j@example.com',    'CP J',       '+231-770-500-013', 'job_seeker', 'user', 'active'),
  ('0c0c0c0c-0000-4000-8000-0000000000a4', 'cp-pa@example.com',   'CP PA',      '+231-770-500-014', 'platform_admin','platform_admin', 'active');
insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_status) values
  ('org-cp-ver',   'org-cp-ver',   'CP Verified Org',   'private_company', 'services', 'Montserrado', 'Monrovia', 'f', 'verified'),
  ('org-cp-unver', 'org-cp-unver', 'CP Unverified Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'f', 'unverified');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values
  ('cp-m-v', 'org-cp-ver',   '0c0c0c0c-0000-4000-8000-0000000000a1', 'owner', 'active'),
  ('cp-m-u', 'org-cp-unver', '0c0c0c0c-0000-4000-8000-0000000000a2', 'owner', 'active');
insert into public.candidate_profiles (user_id, headline, cv_raw_text, cv_file_url, cv_data_json, privacy_settings) values
  ('0c0c0c0c-0000-4000-8000-000000000001', 'public headline',  'raw cv text 1', 'https://x/cv1.pdf', '{"fileDataUrl":"data:application/pdf;base64,AAA","name":"cv1"}'::jsonb, '{"profileVisibility":"public","contactVisibility":"public","cvDownloadPermission":"all_employers"}'::jsonb),
  ('0c0c0c0c-0000-4000-8000-000000000002', 'private headline', 'raw cv text 2', 'https://x/cv2.pdf', '{"fileDataUrl":"data:application/pdf;base64,BBB"}'::jsonb, '{"profileVisibility":"private","contactVisibility":"hidden","cvDownloadPermission":"permission_required"}'::jsonb),
  ('0c0c0c0c-0000-4000-8000-000000000003', 'hidden headline',  'raw cv text 3', null, null, '{"profileVisibility":"hidden","contactVisibility":"public","cvDownloadPermission":"all_employers"}'::jsonb),
  ('0c0c0c0c-0000-4000-8000-000000000004', 'registered headline','raw cv text 4', null, null, '{"profileVisibility":"registered_only","contactVisibility":"public","cvDownloadPermission":"all_employers"}'::jsonb),
  ('0c0c0c0c-0000-4000-8000-000000000005', 'verified-only headline','raw cv text 5', null, null, '{"profileVisibility":"verified_employers_only","contactVisibility":"public","cvDownloadPermission":"all_employers"}'::jsonb),
  ('0c0c0c0c-0000-4000-8000-000000000006', 'bogus headline',   'raw cv text 6', null, null, '{"profileVisibility":"something_new","contactVisibility":"public","cvDownloadPermission":"all_employers"}'::jsonb),
  ('0c0c0c0c-0000-4000-8000-000000000007', 'applied headline', 'raw cv text 7', 'https://x/cv7.pdf', '{"fileDataUrl":"data:application/pdf;base64,CCC"}'::jsonb, '{"profileVisibility":"private","contactVisibility":"on_application_only","cvDownloadPermission":"applied_jobs_only"}'::jsonb);
update public.candidate_profiles set email = 'cp-pub@example.com' where user_id = '0c0c0c0c-0000-4000-8000-000000000001';
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status)
values ('opp-cp-ver', 'org-cp-ver', '0c0c0c0c-0000-4000-8000-0000000000a1', 'CP Job', 'cp-job', 'job', 'onsite', 'Montserrado', 'x', 'x', 'published');
insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage)
values ('app-cp-1', 'opp-cp-ver', '0c0c0c0c-0000-4000-8000-000000000007', 'org-cp-ver', 'CP Applied', 'cp-applied@example.com', 'submitted');

-- ---------------------------- anonymous ----------------------------
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000001')$$, '42501'::char(5), NULL::text,
  '[anon][RPC get_public_candidate_profile] permission denied, even for a PUBLIC profile');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.search_candidate_profiles()$$, '42501'::char(5), NULL::text,
  '[anon][RPC search_candidate_profiles] permission denied');
reset role;

-- ---------------------------- plain job seeker J ----------------------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-0000000000a3',true);
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000001')->>'headline', 'public headline', '[signed-in user][public profile] visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002'), NULL::jsonb, '[signed-in user][private profile] NOT visible (the default setting is now enforced)');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000003'), NULL::jsonb, '[signed-in user][hidden profile] NOT visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000006'), NULL::jsonb, '[signed-in user][unrecognised visibility value] fails closed');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000004')->>'headline', 'registered headline', '[signed-in user][registered_only] visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000005'), NULL::jsonb, '[signed-in non-employer][verified_employers_only] NOT visible');
insert into test_log(line) select * from extensions.is((select count(*) from public.search_candidate_profiles()), 2::bigint, '[signed-in user][search] returns only the visible profiles (public + registered_only)');
reset role;

-- ---------------------------- recruiter in UNVERIFIED org U ----------------------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-0000000000a2',true);
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000005'), NULL::jsonb, '[recruiter in UNVERIFIED org][verified_employers_only] NOT visible');
reset role;

-- ---------------------------- recruiter in VERIFIED org V ----------------------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-0000000000a1',true);
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000005')->>'headline', 'verified-only headline', '[recruiter in VERIFIED org][verified_employers_only] visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000007')->>'headline', 'applied headline', '[recruiter][private profile whose candidate APPLIED to their org] visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000007')->>'cv_file_url', 'https://x/cv7.pdf', '[recruiter][applied candidate] CV file visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000007')->>'cv_raw_text', 'raw cv text 7', '[recruiter][applied candidate] CV text visible');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000001')->'cv_data_json'->>'fileDataUrl', 'data:application/pdf;base64,AAA', '[recruiter][cvDownloadPermission=all_employers] CV file data available');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000001')->>'email', 'cp-pub@example.com', '[recruiter][contactVisibility=public] contact available (legitimate sharing still works)');
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002'), NULL::jsonb, '[recruiter][private profile, no application] NOT visible');
reset role;

-- ---------------------------- self & platform admin ----------------------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002')->'cv_data_json'->>'fileDataUrl', 'data:application/pdf;base64,BBB', '[candidate][own private profile] full access to own data');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-0000000000a4',true);
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002')->>'headline', 'private headline', '[platform admin][private profile] full access retained');
reset role;

-- permission_required CV data is stripped for a non-applied viewer when the profile IS visible
update public.candidate_profiles set privacy_settings = '{"profileVisibility":"public","contactVisibility":"public","cvDownloadPermission":"permission_required"}'::jsonb where user_id = '0c0c0c0c-0000-4000-8000-000000000002';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-0000000000a1',true);
insert into test_log(line) select * from extensions.ok((public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002')->'cv_data_json') ? 'fileDataUrl' = false and (public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002')->>'cv_file_url') is null,
  '[recruiter][cvDownloadPermission=permission_required] CV file data and URL are withheld (was leaked)');
reset role;
update public.candidate_profiles set privacy_settings = '{"profileVisibility":"public","contactVisibility":"on_application_only","cvDownloadPermission":"all_employers"}'::jsonb where user_id = '0c0c0c0c-0000-4000-8000-000000000002';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0c0c0c0c-0000-4000-8000-0000000000a1',true);
insert into test_log(line) select * from extensions.is(public.get_public_candidate_profile('0c0c0c0c-0000-4000-8000-000000000002')->>'cv_raw_text', NULL, '[recruiter][contact not public, not applied] cv_raw_text (embeds contact details) is withheld');
reset role;

select line from test_log order by seq;
rollback;
