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

select line from test_log order by seq;
rollback;
