-- =====================================================================
-- Regression tests for 20261012100000_guard_privileged_columns.sql
--   F-09: a signed-in user must not be able to grant themselves
--         platform_admin / change account_status via direct UPDATE.
--   F-10: an org admin must not be able to self-verify an organization.
-- Same conventions as rls_security_test_matrix.sql: everything runs
-- inside begin/rollback, so no data is left behind.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values ('0f0f0f0f-0000-4000-8000-000000000001', 'pcg-user@example.com', 'PCG User', '+231-770-200-001', 'job_seeker', 'user', 'active');

insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_status)
values ('org-pcg-a', 'org-pcg-a', 'PCG Org A', 'employer', 'services', 'Montserrado', 'Monrovia', 'pcg fixture', 'unverified');

insert into public.organization_memberships (id, organization_id, user_id, org_role, status)
values ('mem-pcg-a-owner', 'org-pcg-a', '0f0f0f0f-0000-4000-8000-000000000001', 'owner', 'active');

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000001',true);

insert into test_log(line) select * from extensions.throws_ok(
  $$update public.users set system_role = 'platform_admin' where id = '0f0f0f0f-0000-4000-8000-000000000001'$$,
  '42501'::char(5), NULL::text,
  '[users][self][UPDATE] cannot grant self system_role = platform_admin');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.users set primary_role = 'platform_admin' where id = '0f0f0f0f-0000-4000-8000-000000000001'$$,
  '42501'::char(5), NULL::text,
  '[users][self][UPDATE] cannot elevate primary_role to platform_admin');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.users set account_status = 'suspended' where id = '0f0f0f0f-0000-4000-8000-000000000001'$$,
  '42501'::char(5), NULL::text,
  '[users][self][UPDATE] cannot change own account_status directly');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.users set full_name = 'PCG Renamed' where id = '0f0f0f0f-0000-4000-8000-000000000001'$$,
  '[users][self][UPDATE] ordinary profile edits still work');

insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organizations set verification_status = 'verified' where id = 'org-pcg-a'$$,
  '42501'::char(5), NULL::text,
  '[organizations][org owner][UPDATE] cannot self-verify via direct UPDATE');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organizations set verification_badge = 'official' where id = 'org-pcg-a'$$,
  '42501'::char(5), NULL::text,
  '[organizations][org owner][UPDATE] cannot self-assign a verification badge');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organizations set description = 'pcg edited' where id = 'org-pcg-a'$$,
  '[organizations][org owner][UPDATE] ordinary org edits still work');
reset role;

-- ---------------------------------------------------------------------
-- F-12: signup metadata cannot grant an admin role
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  ('0f0f0f0f-0000-4000-8000-0000000000a1', 'pcg-evil@example.com', '{"primaryRole":"platform_admin"}'::jsonb, now()),
  ('0f0f0f0f-0000-4000-8000-0000000000a2', 'pcg-ok@example.com',   '{"primaryRole":"recruiter"}'::jsonb, now()),
  ('0f0f0f0f-0000-4000-8000-0000000000a3', 'pcg-vo@example.com',   '{"primaryRole":"verification_officer"}'::jsonb, now());
insert into test_log(line) select * from extensions.is(
  (select primary_role from public.users where id = '0f0f0f0f-0000-4000-8000-0000000000a1'), 'job_seeker',
  '[signup] primaryRole=platform_admin in signup metadata is NOT honoured');
insert into test_log(line) select * from extensions.is(
  (select system_role from public.users where id = '0f0f0f0f-0000-4000-8000-0000000000a1'), 'user',
  '[signup] system_role is always user');
insert into test_log(line) select * from extensions.is(
  (select primary_role from public.users where id = '0f0f0f0f-0000-4000-8000-0000000000a3'), 'job_seeker',
  '[signup] primaryRole=verification_officer in signup metadata is NOT honoured');
insert into test_log(line) select * from extensions.is(
  (select primary_role from public.users where id = '0f0f0f0f-0000-4000-8000-0000000000a2'), 'recruiter',
  '[signup] a legitimate self-selectable role (recruiter) is still honoured');

-- ---------------------------------------------------------------------
-- F-08: private organization columns
-- ---------------------------------------------------------------------
update public.organizations set tax_id_number = 'TIN-PCG', contact_email = 'pcg-org@example.com' where id = 'org-pcg-a';
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0f0f0f0f-0000-4000-8000-000000000002', 'pcg-outsider@example.com', 'PCG Outsider', '+231-770-200-002', 'job_seeker', 'user', 'active'),
  ('0f0f0f0f-0000-4000-8000-000000000003', 'pcg-admin@example.com', 'PCG Platform Admin', '+231-770-200-003', 'platform_admin', 'platform_admin', 'active'),
  ('0f0f0f0f-0000-4000-8000-000000000004', 'pcg-member@example.com', 'PCG Member', '+231-770-200-004', 'recruiter', 'user', 'active');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status)
values ('mem-pcg-a-member', 'org-pcg-a', '0f0f0f0f-0000-4000-8000-000000000004', 'member', 'active');

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is(
  (select tax_id_number from public.get_organization_private_fields(array['org-pcg-a'])), 'TIN-PCG',
  '[organizations][active owner][RPC] can read private fields of own org');
insert into test_log(line) select * from extensions.throws_ok(
  $$select tax_id_number from public.organizations where id = 'org-pcg-a'$$,
  '42501'::char(5), NULL::text,
  '[organizations][active owner][SELECT] private columns are not readable directly, even by the owner (RPC only)');
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.get_organization_private_fields(array['org-pcg-a'])), 0::bigint,
  '[organizations][authenticated non-member][RPC] sees no private fields');
insert into test_log(line) select * from extensions.throws_ok(
  $$select tax_id_number from public.organizations$$,
  '42501'::char(5), NULL::text,
  '[organizations][authenticated non-member][SELECT] cannot read private columns directly');
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.get_organization_private_fields(array['org-pcg-a'])), 1::bigint,
  '[organizations][platform admin][RPC] can read private fields (verification review)');
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.get_organization_private_fields(array['org-pcg-a'])), 1::bigint,
  '[organizations][active member][RPC] can read private fields');
reset role;

update public.organization_memberships set status = 'suspended' where id = 'mem-pcg-a-member';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.get_organization_private_fields(array['org-pcg-a'])), 0::bigint,
  '[organizations][suspended/removed member][RPC] loses access immediately');
reset role;

select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$select * from public.get_organization_private_fields(array['org-pcg-a'])$$,
  '42501'::char(5), NULL::text,
  '[organizations][anon][RPC] get_organization_private_fields is not executable by anon');
reset role;

-- ---------------------------------------------------------------------
-- F-13: users.email / verified flags are not client-writable (invitation takeover)
-- ---------------------------------------------------------------------
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0f0f0f0f-0000-4000-8000-000000000005', 'invitee-pcg@example.com', 'PCG Invitee', '+231-770-200-005', 'recruiter', 'user', 'active'),
  ('0f0f0f0f-0000-4000-8000-000000000006', 'pcg-creator@example.com', 'PCG Creator', '+231-770-200-006', 'employer', 'user', 'active');
insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at)
values ('inv-pcg-1', 'org-pcg-a', '0f0f0f0f-0000-4000-8000-000000000001', 'invitee-pcg@example.com', 'admin', 'PCG-SECRET-TOKEN', now() + interval '7 days');

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.users set email = 'invitee-pcg@example.com' where id = '0f0f0f0f-0000-4000-8000-000000000002'$$,
  '42501'::char(5), NULL::text,
  '[users][self][UPDATE] cannot change own email (invitation takeover, F-13)');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.users set is_email_verified = true where id = '0f0f0f0f-0000-4000-8000-000000000002'$$,
  '42501'::char(5), NULL::text,
  '[users][self][UPDATE] cannot self-assert is_email_verified');
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.organization_invitations), 0::bigint,
  '[organization_invitations][non-invitee] sees no invitations addressed to someone else');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.accept_organization_invitation('PCG-SECRET-TOKEN')$$,
  '42501'::char(5), NULL::text,
  '[organization_invitations][non-invitee] cannot accept an invitation issued to a different email');
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.organization_invitations), 1::bigint,
  '[organization_invitations][real invitee] still sees their own invitation');
insert into test_log(line) select * from extensions.is(
  (select org_role from public.accept_organization_invitation('PCG-SECRET-TOKEN')), 'admin',
  '[organization_invitations][real invitee] can still accept their invitation (legitimate flow intact)');
reset role;

-- trusted auth-sync path still maintains the verified flag
update auth.users set email_confirmed_at = now() where id = '0f0f0f0f-0000-4000-8000-0000000000a2';
insert into test_log(line) select * from extensions.is(
  (select is_email_verified from public.users where id = '0f0f0f0f-0000-4000-8000-0000000000a2'), true,
  '[auth sync] email confirmation still sets is_email_verified via the trusted trigger');

-- ---------------------------------------------------------------------
-- Organization verification integrity (INSERT + trusted workflow)
-- ---------------------------------------------------------------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.organizations (id, slug, name, type, industry, county, city_district, description, is_verified)
    values ('org-pcg-iv', 'org-pcg-iv', 'PCG IV', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', true)$$,
  '[organizations][authenticated][INSERT] is_verified=true in the payload does not error...');
insert into test_log(line) select * from extensions.is(
  (select is_verified from public.organizations where id = 'org-pcg-iv'), false,
  '[organizations][authenticated][INSERT] ...but the stored is_verified is false (sync trigger recomputes on INSERT)');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_status)
    values ('org-pcg-sv', 'org-pcg-sv', 'PCG SV', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', 'verified')$$,
  '42501'::char(5), NULL::text,
  '[organizations][authenticated][INSERT] cannot insert an already-verified organization');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organizations (id, slug, name, type, industry, county, city_district, description, verification_badge)
    values ('org-pcg-bd', 'org-pcg-bd', 'PCG BD', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', 'official')$$,
  '42501'::char(5), NULL::text,
  '[organizations][authenticated][INSERT] cannot insert an organization with a badge');
insert into test_log(line) select * from extensions.is(
  (select verification_status from public.create_organization_with_owner(
     'org-pcg-rpc', 'org-pcg-rpc', 'PCG RPC Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd',
     null, null, null, null, null)), 'unverified',
  '[organizations][RPC] legitimate registration via create_organization_with_owner still works and starts unverified');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organizations set is_verified = true where id = 'org-pcg-rpc'$$,
  '42501'::char(5), NULL::text,
  '[organizations][authenticated][UPDATE] org owner cannot flip is_verified directly');
insert into public.verification_audits (id, organization_id, requested_by_user_id, requested_badge, documents_submitted, status)
values ('aud-pcg-1', 'org-pcg-rpc', '0f0f0f0f-0000-4000-8000-000000000006', 'verified_business', '["reg.pdf"]'::jsonb, 'pending');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.decide_verification_audit('aud-pcg-1', 'approved', 'self-approve')$$,
  '42501'::char(5), NULL::text,
  '[verification][requester] cannot approve their own verification request');
reset role;

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.is(
  (select status from public.decide_verification_audit('aud-pcg-1', 'approved', 'ok')), 'approved',
  '[verification][platform admin] can approve through the trusted RPC');
reset role;
insert into test_log(line) select * from extensions.ok(
  (select verification_status = 'verified' and is_verified and verification_badge = 'verified_business'
     from public.organizations where id = 'org-pcg-rpc'),
  '[verification][platform admin] approval sets status, badge and is_verified despite the client guard');

-- ---------------------------------------------------------------------
-- Membership role escalation (locks current behaviour)
-- ---------------------------------------------------------------------
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values ('0f0f0f0f-0000-4000-8000-000000000007', 'pcg-plain@example.com', 'PCG Plain', '+231-770-200-007', 'recruiter', 'user', 'active');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status)
values ('mem-pcg-m2', 'org-pcg-a', '0f0f0f0f-0000-4000-8000-000000000007', 'member', 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000007',true);
update public.organization_memberships set org_role = 'admin' where id = 'mem-pcg-m2';
reset role;
insert into test_log(line) select * from extensions.is(
  (select org_role from public.organization_memberships where id = 'mem-pcg-m2'), 'member',
  '[organization_memberships][plain member] cannot promote themselves to admin (update is filtered by RLS)');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organization_memberships (id, organization_id, user_id, org_role, status)
    values ('mem-pcg-x', 'org-pcg-a', '0f0f0f0f-0000-4000-8000-000000000003', 'admin', 'active')$$,
  '42501'::char(5), NULL::text,
  '[organization_memberships][non-member] cannot add themselves to an organization as admin');
reset role;

-- ---------------------------------------------------------------------
-- get_organization_private_fields: account-level suspension + public listing intact
-- ---------------------------------------------------------------------
update public.users set account_status = 'suspended' where id = '0f0f0f0f-0000-4000-8000-000000000001';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.get_organization_private_fields(array['org-pcg-a'])), 0::bigint,
  '[organizations][platform-suspended account with active membership][RPC] gets no private fields');
reset role;
update public.users set account_status = 'active' where id = '0f0f0f0f-0000-4000-8000-000000000001';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is(
  (select count(*) from public.get_organization_private_fields(array['org-pcg-a'])), 1::bigint,
  '[organizations][reinstated owner][RPC] access returns once the account is active again');
reset role;

-- the exact public column list the client uses (src/services/orgColumns.ts) stays readable
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select id,slug,name,type,industry,county,city_district,website_url,logo_url,cover_image_url,description,employee_count_range,verification_status,verification_badge,created_at,updated_at,is_verified,website,logo_text,address,established_year from public.organizations$$,
  '[organizations][anon][SELECT] the full public column list used by public listings is still readable');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f0f0f0f-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select id,slug,name,type,industry,county,city_district,website_url,logo_url,cover_image_url,description,employee_count_range,verification_status,verification_badge,created_at,updated_at,is_verified,website,logo_text,address,established_year from public.organizations$$,
  '[organizations][authenticated][SELECT] the full public column list is readable');
reset role;

select line from test_log order by seq;
rollback;
