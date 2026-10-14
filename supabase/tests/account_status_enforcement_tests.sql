-- =====================================================================
-- F-16 regression tests: suspended / deactivated / restricted accounts
-- (migration 20261012150000_enforce_account_status.sql) and the
-- user-privilege pathways (direct INSERT, upsert, definer RPCs).
-- Positive controls (an ACTIVE user doing the same thing succeeds) are
-- included so a denial cannot be an artefact of a malformed statement.
-- Everything runs inside begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- ids: U1 active admin | S suspended owner | D deactivated admin | R posting_disabled admin
--      RX expired posting_disabled admin | T active job seeker | PA platform admin | SA suspended platform admin
--      S2 suspended + active full_suspension row (profile-deletion evasion)
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0a0a0a0a-0000-4000-8000-000000000001', 'as-u1@example.com', 'AS U1', '+231-770-400-001', 'employer',  'user', 'active'),
  ('0a0a0a0a-0000-4000-8000-000000000002', 'as-s@example.com',  'AS S',  '+231-770-400-002', 'employer',  'user', 'suspended'),
  ('0a0a0a0a-0000-4000-8000-000000000003', 'as-d@example.com',  'AS D',  '+231-770-400-003', 'employer',  'user', 'deactivated'),
  ('0a0a0a0a-0000-4000-8000-000000000004', 'as-r@example.com',  'AS R',  '+231-770-400-004', 'employer',  'user', 'active'),
  ('0a0a0a0a-0000-4000-8000-000000000005', 'as-rx@example.com', 'AS RX', '+231-770-400-005', 'employer',  'user', 'active'),
  ('0a0a0a0a-0000-4000-8000-000000000006', 'as-t@example.com',  'AS T',  '+231-770-400-006', 'job_seeker','user', 'active'),
  ('0a0a0a0a-0000-4000-8000-000000000007', 'as-pa@example.com', 'AS PA', '+231-770-400-007', 'platform_admin','platform_admin', 'active'),
  ('0a0a0a0a-0000-4000-8000-000000000008', 'as-sa@example.com', 'AS SA', '+231-770-400-008', 'platform_admin','platform_admin', 'suspended'),
  ('0a0a0a0a-0000-4000-8000-000000000009', 'as-s2@example.com', 'AS S2', '+231-770-400-009', 'job_seeker','user', 'suspended');
insert into public.organizations (id, slug, name, type, industry, county, city_district, description) values
  ('org-as', 'org-as', 'AS Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'fixture'),
  ('org-as-s', 'org-as-s', 'AS Suspended Owner Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions) values
  ('as-m-u1', 'org-as',   '0a0a0a0a-0000-4000-8000-000000000001', 'owner', 'active', '[]'::jsonb),
  ('as-m-d',  'org-as',   '0a0a0a0a-0000-4000-8000-000000000003', 'admin', 'active', '[]'::jsonb),
  ('as-m-r',  'org-as',   '0a0a0a0a-0000-4000-8000-000000000004', 'admin', 'active', '[]'::jsonb),
  ('as-m-rx', 'org-as',   '0a0a0a0a-0000-4000-8000-000000000005', 'admin', 'active', '[]'::jsonb),
  ('as-m-s',  'org-as-s', '0a0a0a0a-0000-4000-8000-000000000002', 'owner', 'active', '[]'::jsonb);
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status)
values ('opp-as-pub', 'org-as', '0a0a0a0a-0000-4000-8000-000000000001', 'AS Published', 'as-published', 'job', 'onsite', 'Montserrado', 'x', 'x', 'published');
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status) values
  ('as-r-post',  '0a0a0a0a-0000-4000-8000-000000000004', 'AS R',  'as-r@example.com',  'posting_disabled', 'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', null, 'active'),
  ('as-rx-post', '0a0a0a0a-0000-4000-8000-000000000005', 'AS RX', 'as-rx@example.com', 'posting_disabled', 'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', now() - interval '1 day', 'active'),
  ('as-s-full',  '0a0a0a0a-0000-4000-8000-000000000002', 'AS S',  'as-s@example.com',  'full_suspension',  'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', null, 'active'),
  ('as-s2-full', '0a0a0a0a-0000-4000-8000-000000000009', 'AS S2', 'as-s2@example.com', 'full_suspension',  'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', null, 'active');

-- =====================================================================
-- A. Suspended account S (owner of org-as-s)
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.users where id = '0a0a0a0a-0000-4000-8000-000000000002'), 1::bigint,
  '[suspended] CAN read their own users row (status display)');
insert into test_log(line) select * from extensions.is((select count(*) from public.account_restrictions where user_id = '0a0a0a0a-0000-4000-8000-000000000002'), 1::bigint,
  '[suspended] CAN read their own restriction record');
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations), 0::bigint,
  '[suspended][organizations] sees no rows at all (restrictive SELECT), not even their own org');
insert into test_log(line) select * from extensions.is((select count(*) from public.organization_memberships), 0::bigint,
  '[suspended][organization_memberships] cannot read their own membership');
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-as-s'])), 0::bigint,
  '[suspended][RPC get_organization_private_fields] gets nothing');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage) values ('app-as-s', 'opp-as-pub', '0a0a0a0a-0000-4000-8000-000000000002', 'org-as', 'AS S', 'as-s@example.com', 'submitted')$$,
  '42501'::char(5), NULL::text, '[suspended][applications][INSERT] denied');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-as-s', 'org-as-s', '0a0a0a0a-0000-4000-8000-000000000002', 'x', 'as-s-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$,
  '42501'::char(5), NULL::text, '[suspended][opportunities][INSERT] denied even for an organization they own');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.create_organization_with_owner('org-as-new-s', 'org-as-new-s', 'x', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$,
  '42501'::char(5), NULL::text, '[suspended][RPC create_organization_with_owner] denied');
insert into test_log(line) select * from extensions.throws_ok(
  $$select * from public.get_organization_member_profiles('org-as-s')$$,
  '42501'::char(5), NULL::text, '[suspended][RPC get_organization_member_profiles] denied');
insert into test_log(line) select * from extensions.throws_ok(
  $$select * from public.find_user_by_email('as-u1@example.com')$$,
  '42501'::char(5), NULL::text, '[suspended][RPC find_user_by_email] denied');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.submit_payment_reference('pay-none', 'TXN123456789', null)$$,
  '42501'::char(5), NULL::text, '[suspended][RPC submit_payment_reference] denied before any payment lookup');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.cancel_subscription('org-as-s', true)$$,
  '42501'::char(5), NULL::text, '[suspended][RPC cancel_subscription] denied');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.create_conversation_with_participants('conv-as-s', 'direct', 't', null, null, array['0a0a0a0a-0000-4000-8000-000000000002','0a0a0a0a-0000-4000-8000-000000000001'])$$,
  '42501'::char(5), NULL::text, '[suspended][RPC create_conversation_with_participants] denied');
update public.users set full_name = 'AS S edited' where id = '0a0a0a0a-0000-4000-8000-000000000002';
update public.users set account_status = 'active' where id = '0a0a0a0a-0000-4000-8000-000000000002';
delete from public.users where id = '0a0a0a0a-0000-4000-8000-000000000002';
reset role;
insert into test_log(line) select * from extensions.is((select full_name || '/' || account_status from public.users where id = '0a0a0a0a-0000-4000-8000-000000000002'), 'AS S/suspended',
  '[suspended][users] cannot edit their profile, self-reinstate, or delete their row (row unchanged and still present)');

-- =====================================================================
-- B. Deactivated account D (admin of org-as)
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.organization_memberships), 0::bigint,
  '[deactivated] sees no memberships (same denial as suspended)');
insert into test_log(line) select * from extensions.throws_ok(
  $$select * from public.get_organization_member_profiles('org-as')$$, '42501'::char(5), NULL::text,
  '[deactivated][RPC get_organization_member_profiles] denied');
reset role;

-- =====================================================================
-- C. Defence in depth: an ACTIVE full_suspension restriction suspends even if
--    users.account_status is (wrongly) 'active'. (Deleting the users row is
--    additionally blocked by the account_restrictions FK and the restrictive DELETE policy.)
-- =====================================================================
update public.users set account_status = 'active' where id = '0a0a0a0a-0000-4000-8000-000000000009';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000009',true);
insert into test_log(line) select * from extensions.is(public.current_account_suspended(), true,
  '[suspended][defence in depth] an ACTIVE full_suspension restriction suspends the account even when account_status says active');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage) values ('app-as-s2', 'opp-as-pub', '0a0a0a0a-0000-4000-8000-000000000009', 'org-as', 'AS S2', 'as-s2@example.com', 'submitted')$$,
  '42501'::char(5), NULL::text, '[suspended][defence in depth] writes are denied on the strength of the restriction row alone');
reset role;

-- =====================================================================
-- D. Active users: the same operations still work (positive controls)
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage) values ('app-as-t', 'opp-as-pub', '0a0a0a0a-0000-4000-8000-000000000006', 'org-as', 'AS T', 'as-t@example.com', 'submitted')$$,
  '[active][applications][INSERT] an active candidate CAN apply (positive control)');
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.create_conversation_with_participants('conv-as-t', 'direct', 't', null, null, array['0a0a0a0a-0000-4000-8000-000000000006','0a0a0a0a-0000-4000-8000-000000000001'])$$,
  '[active][RPC create_conversation_with_participants] an active user CAN start a conversation (positive control)');
insert into test_log(line) select * from extensions.ok((select count(*) from public.organizations) > 0,
  '[active][organizations] active user can still read organizations');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-as-u1', 'org-as', '0a0a0a0a-0000-4000-8000-000000000001', 'x', 'as-u1-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$,
  '[active][opportunities][INSERT] an active org admin CAN post (positive control)');
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-as'])), 1::bigint,
  '[active][RPC get_organization_private_fields] active owner still gets private fields');
reset role;

-- =====================================================================
-- E. Per-action restrictions
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-as-r', 'org-as', '0a0a0a0a-0000-4000-8000-000000000004', 'x', 'as-r-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$,
  '42501'::char(5), NULL::text, '[posting_disabled][opportunities][INSERT] denied for a user with an active posting_disabled restriction');
insert into test_log(line) select * from extensions.ok((select count(*) from public.organizations) > 0,
  '[posting_disabled] other access is unaffected (only posting is restricted; reads work)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-as-rx', 'org-as', '0a0a0a0a-0000-4000-8000-000000000005', 'x', 'as-rx-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$,
  '[posting_disabled][expired] an EXPIRED restriction no longer blocks posting');
reset role;
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status)
values ('as-t-app', '0a0a0a0a-0000-4000-8000-000000000006', 'AS T', 'as-t@example.com', 'applications_disabled', 'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', null, 'active'),
       ('as-t-msg', '0a0a0a0a-0000-4000-8000-000000000006', 'AS T', 'as-t@example.com', 'messaging_disabled',   'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', null, 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage) values ('app-as-t2', 'opp-as-pub', '0a0a0a0a-0000-4000-8000-000000000006', 'org-as', 'AS T', 'as-t@example.com', 'submitted')$$,
  '42501'::char(5), NULL::text, '[applications_disabled][applications][INSERT] denied');
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.create_conversation_with_participants('conv-as-t2', 'direct', 't', null, null, array['0a0a0a0a-0000-4000-8000-000000000006','0a0a0a0a-0000-4000-8000-000000000001'])$$,
  '42501'::char(5), NULL::text, '[messaging_disabled][RPC create_conversation_with_participants] denied');
reset role;

-- =====================================================================
-- F. Administrators: legitimate actions work; a suspended admin is denied
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000007',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.apply_account_restriction('as-new-full', '0a0a0a0a-0000-4000-8000-000000000001', 'full_suspension', 'abuse', null)$$,
  '[platform admin][RPC apply_account_restriction] can suspend an account');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-as-u1b', 'org-as', '0a0a0a0a-0000-4000-8000-000000000001', 'x', 'as-u1b-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$,
  '42501'::char(5), NULL::text, '[suspended via RPC] the freshly suspended user is immediately denied');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000007',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.lift_account_restriction('as-new-full')$$,
  '[platform admin][RPC lift_account_restriction] can lift the suspension');
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-as'])), 1::bigint,
  '[platform admin][RPC get_organization_private_fields] retains read access (platform administration)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-as-u1c', 'org-as', '0a0a0a0a-0000-4000-8000-000000000001', 'x', 'as-u1c-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$,
  '[reinstated] after lift_account_restriction the user can act again');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$select public.apply_account_restriction('as-bad', '0a0a0a0a-0000-4000-8000-000000000001', 'full_suspension', 'x', null)$$,
  '42501'::char(5), NULL::text, '[suspended platform admin][RPC apply_account_restriction] a suspended administrator cannot act');
reset role;

-- =====================================================================
-- G. Coverage: nothing added later can silently skip the account-status model
-- =====================================================================
insert into test_log(line) select * from extensions.is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('users', 'account_restrictions')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'restrict_suspended_accounts' and not p.polpermissive)),
  0::bigint, '[coverage] every RLS table (except users, account_restrictions) has the restrictive suspended-account policy');
insert into test_log(line) select * from extensions.is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prosecdef and l.lanname = 'plpgsql' and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.prosrc ~* 'auth\\.uid\\(\\)' and p.prosrc !~ 'assert_account_active'
      and p.proname not in ('assert_account_active', 'has_org_permission', 'is_org_admin', 'is_org_member',
                            'expire_payment_if_stale', 'get_business_listing_public', 'record_opportunity_view',
                            'handle_new_auth_user', 'handle_auth_user_email_confirmed')),
  0::bigint, '[coverage] every client-callable plpgsql SECURITY DEFINER RPC that uses auth.uid() carries the account-status guard (allow-list: RLS helpers and public-read functions)');

insert into test_log(line) select * from extensions.is(
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
  0::bigint, '[coverage] every SECURITY DEFINER function in public pins its search_path');
insert into test_log(line) select * from extensions.is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and not (c.relkind in ('r','p') and c.relrowsecurity)),
  0::bigint, '[coverage] every table in public has RLS enabled and there are no views / materialised views exposed');

-- =====================================================================
-- H. Privilege-assignment pathways: INSERT / upsert / definer RPCs
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-0000000000b1',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.users (id, email, full_name, primary_role, system_role, account_status) values ('0a0a0a0a-0000-4000-8000-0000000000b1', 'new-admin@example.com', 'x', 'platform_admin', 'platform_admin', 'active')$$,
  '42501'::char(5), NULL::text, '[users][authenticated][INSERT] a direct INSERT of an admin profile row is denied (no INSERT policy)');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.users (id, email, full_name, primary_role) values ('0a0a0a0a-0000-4000-8000-0000000000b1', 'plain@example.com', 'x', 'job_seeker')$$,
  '42501'::char(5), NULL::text, '[users][authenticated][INSERT] even a plain self-INSERT is denied (rows exist only via the auth sync trigger)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.users (id, email, full_name, primary_role, system_role) values ('0a0a0a0a-0000-4000-8000-000000000006', 'as-t@example.com', 'AS T', 'job_seeker', 'platform_admin') on conflict (id) do update set system_role = 'platform_admin'$$,
  NULL::char(5), NULL::text, '[users][authenticated][UPSERT] INSERT .. ON CONFLICT DO UPDATE cannot be used to set system_role');
reset role;
insert into test_log(line) select * from extensions.is((select system_role from public.users where id = '0a0a0a0a-0000-4000-8000-000000000006'), 'user',
  '[users] post-check: the upsert attempt changed nothing');
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.users (id, email, full_name, primary_role, system_role) values ('0a0a0a0a-0000-4000-8000-0000000000b2', 'anon@example.com', 'x', 'platform_admin', 'platform_admin')$$,
  NULL::char(5), NULL::text, '[users][anon][INSERT] denied');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.apply_account_restriction('x-1', '0a0a0a0a-0000-4000-8000-000000000001', 'full_suspension', 'x', null)$$, '42501'::char(5), NULL::text, '[ordinary user][RPC apply_account_restriction] denied');
insert into test_log(line) select * from extensions.throws_ok($$select public.lift_account_restriction('as-s-full')$$, '42501'::char(5), NULL::text, '[ordinary user][RPC lift_account_restriction] denied');
insert into test_log(line) select * from extensions.throws_ok($$select public.resolve_content_report('rep-none', 'dismissed', 'x')$$, '42501'::char(5), NULL::text, '[ordinary user][RPC resolve_content_report] denied');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_review_payment('pay-none', 'approved', 'x')$$, '42501'::char(5), NULL::text, '[ordinary user][RPC admin_review_payment] denied');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.get_platform_analytics()$$, '42501'::char(5), NULL::text, '[ordinary user][RPC get_platform_analytics] denied');
insert into test_log(line) select * from extensions.throws_ok($$select public.decide_verification_audit('aud-none', 'approved', 'x')$$, '42501'::char(5), NULL::text, '[ordinary user][RPC decide_verification_audit] denied');
reset role;


-- =====================================================================
-- I. F-22: enforcement status cannot be used to inspect other accounts
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);   -- T, an ordinary active user
insert into test_log(line) select * from extensions.throws_ok($$select public.is_account_suspended('0a0a0a0a-0000-4000-8000-000000000002')$$, '42501'::char(5), NULL::text,
  '[F-22][ordinary user] cannot ask whether ANOTHER account is suspended (parameterised helper not executable)');
insert into test_log(line) select * from extensions.throws_ok($$select public.has_active_restriction('0a0a0a0a-0000-4000-8000-000000000004', 'posting_disabled')$$, '42501'::char(5), NULL::text,
  '[F-22][ordinary user] cannot ask whether ANOTHER account has a restriction');
insert into test_log(line) select * from extensions.is((select count(*) from public.account_restrictions where user_id <> '0a0a0a0a-0000-4000-8000-000000000006'), 0::bigint,
  '[F-22][ordinary user] cannot read other users'' restriction rows');
insert into test_log(line) select * from extensions.is(public.current_account_suspended(), false, '[F-22][ordinary active user] current_account_suspended() answers about themselves only: false');
insert into test_log(line) select * from extensions.is(public.current_has_restriction('messaging_disabled'), true, '[F-22][T with an active messaging_disabled restriction] can see their OWN restriction through the wrapper');
insert into test_log(line) select * from extensions.is(public.current_has_restriction('posting_disabled'), false, '[F-22][T] ...and only their own (no posting restriction)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000002',true);   -- S, suspended
insert into test_log(line) select * from extensions.is(public.current_account_suspended(), true, '[F-22][suspended S] sees their own suspension');
insert into test_log(line) select * from extensions.throws_ok($$select public.assert_account_active()$$, '42501'::char(5), NULL::text, '[F-22][suspended S] assert_account_active() raises for themselves');
insert into test_log(line) select * from extensions.throws_ok($$select public.is_account_suspended('0a0a0a0a-0000-4000-8000-000000000006')$$, '42501'::char(5), NULL::text, '[F-22][suspended S] cannot probe other accounts either');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000007',true);   -- PA
insert into test_log(line) select * from extensions.ok((select count(*) from public.account_restrictions) >= 4, '[F-22][platform admin] can still read all restriction rows (enforcement tooling intact)');
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('as-f22', '0a0a0a0a-0000-4000-8000-000000000006', 'posting_disabled', 'abuse', null)$$, '[F-22][platform admin] can still apply restrictions');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.is(public.current_has_restriction('posting_disabled'), true, '[F-22][T] the restriction just applied is enforced via the self-only wrapper');
reset role;
-- coverage: no parameterised enforcement helper is executable by client roles
insert into test_log(line) select * from extensions.is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('is_account_suspended', 'has_active_restriction')
   and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint,
  '[F-22][coverage] the parameterised enforcement helpers are not executable by authenticated or anon');


-- =====================================================================
-- J. F-19: full suspension bans the auth user and revokes its sessions; lifting restores
-- =====================================================================
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at)
values ('0a0a0a0a-0000-4000-8000-0000000000c1', 'as-ban@example.com', '{"primaryRole":"employer"}'::jsonb, now(), now());
insert into auth.sessions (id, user_id) values ('0a0a0a0a-0000-4000-8000-0000000000d1', '0a0a0a0a-0000-4000-8000-0000000000c1');
insert into auth.refresh_tokens (user_id, session_id) values ('0a0a0a0a-0000-4000-8000-0000000000c1', '0a0a0a0a-0000-4000-8000-0000000000d1');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000007',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('as-ban-1', '0a0a0a0a-0000-4000-8000-0000000000c1', 'full_suspension', 'abuse', null)$$, '[F-19][platform admin] suspends an account');
reset role;
insert into test_log(line) select * from extensions.ok((select banned_until = 'infinity' from auth.users where id = '0a0a0a0a-0000-4000-8000-0000000000c1'), '[F-19] the auth user is banned (sign-in and token refresh refused)');
insert into test_log(line) select * from extensions.is((select count(*) from auth.sessions where user_id = '0a0a0a0a-0000-4000-8000-0000000000c1') + (select count(*) from auth.refresh_tokens where user_id = '0a0a0a0a-0000-4000-8000-0000000000c1'), 0::bigint, '[F-19] sessions and refresh tokens are revoked');
-- a still-valid access token is denied by the database
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-0000000000c1',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations), 0::bigint, '[F-19] an already-issued access token still gets no data (RLS)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000007',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.lift_account_restriction('as-ban-1')$$, '[F-19][platform admin] lifts the suspension');
reset role;
insert into test_log(line) select * from extensions.ok((select banned_until is null from auth.users where id = '0a0a0a0a-0000-4000-8000-0000000000c1'), '[F-19] lifting the last full suspension clears the ban');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.set_auth_ban('0a0a0a0a-0000-4000-8000-000000000006', true)$$, '42501'::char(5), NULL::text, '[F-19][ordinary user] set_auth_ban is not callable by client roles');
-- F-21: organizations only through the RPC
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organizations (id, slug, name, type, industry, county, city_district, description) values ('org-as-direct', 'org-as-direct', 'Ministry of Finance', 'government', 'x', 'Montserrado', 'Monrovia', 'd')$$,
  '42501'::char(5), NULL::text, '[F-21][authenticated] a direct INSERT into organizations is denied');
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.create_organization_with_owner('org-as-rpc', 'org-as-rpc', 'RPC Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$,
  '[F-21][authenticated] create_organization_with_owner still works');
reset role;


-- =====================================================================
-- K. F-24: previously APPROVED deal-room access is restricted too
-- =====================================================================
insert into public.business_listings (id, owner_user_id, title, slug, listing_type, industry, county, city_district, headline, description, status, is_confidential, asking_price_usd, annual_revenue_usd, exact_address, seller_name, seller_contact_email, seller_contact_phone)
values ('biz-as-conf', '0a0a0a0a-0000-4000-8000-000000000001', 'AS Confidential', 'as-conf', 'business', 'Retail', 'Montserrado', 'Sinkor', 'h', 'd', 'published', true, 1000, 777777, '1 Vault St', 'AS Seller', 'seller@example.com', '+231-1');
insert into public.business_access_requests (id, listing_id, buyer_user_id, buyer_full_name, buyer_email, status, nda_signed)
values ('bar-as-t', 'biz-as-conf', '0a0a0a0a-0000-4000-8000-000000000006', 'AS T', 'as-t@example.com', 'approved', true);
delete from public.account_restrictions where id in ('as-t-app', 'as-t-msg', 'as-f22');   -- T starts clean
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('biz-as-conf')->>'annual_revenue_usd')::numeric = 777777, '[F-24][approved buyer, active] sees the confidential figures (legitimate access, positive control)');
reset role;
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status)
values ('as-t-deal', '0a0a0a0a-0000-4000-8000-000000000006', 'AS T', 'as-t@example.com', 'deal_room_disabled', 'test', '0a0a0a0a-0000-4000-8000-000000000007', 'AS PA', null, 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('biz-as-conf') ? 'annual_revenue_usd') = false and (public.get_business_listing_public('biz-as-conf') ? 'seller_contact_email') = false,
  '[F-24][approved buyer + deal_room_disabled] confidential fields are withheld');
reset role;
update public.account_restrictions set status = 'lifted' where id = 'as-t-deal';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('biz-as-conf')->>'annual_revenue_usd')::numeric = 777777, '[F-24] lifting the restriction restores access automatically (approval/NDA untouched)');
reset role;
update public.users set account_status = 'suspended' where id = '0a0a0a0a-0000-4000-8000-000000000006';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('biz-as-conf') ? 'annual_revenue_usd') = false, '[F-24][approved buyer, SUSPENDED] confidential fields are withheld');
reset role;
update public.users set account_status = 'suspended' where id = '0a0a0a0a-0000-4000-8000-000000000001';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('biz-as-conf') ? 'exact_address') = false, '[F-24][listing OWNER, suspended] no longer receives the owner view through the RPC');
reset role;
update public.users set account_status = 'active' where id in ('0a0a0a0a-0000-4000-8000-000000000001', '0a0a0a0a-0000-4000-8000-000000000006');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is(public.get_business_listing_public('biz-as-conf')->>'exact_address', '1 Vault St', '[F-24][listing owner, reinstated] owner view restored');
reset role;

-- =====================================================================
-- L. F-20 coverage: only the intentionally public functions are executable by anon
-- =====================================================================
insert into test_log(line) select * from extensions.is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('get_business_listing_public', 'list_business_listings_public', 'record_opportunity_view',
                            'priority_organization_ids', 'org_effective_tier', 'tier_limits',
                            'normalize_momo_transaction_id', 'normalize_sender_phone')),
  NULL, '[F-20][coverage] no other public function is executable by anon (a new function must be revoked or allow-listed here)');
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.is_platform_admin('0a0a0a0a-0000-4000-8000-000000000007')$$, '42501'::char(5), NULL::text, '[F-20][anon] can no longer ask whether a user is a platform administrator');
insert into test_log(line) select * from extensions.throws_ok($$select public.candidate_has_applied_to_org('0a0a0a0a-0000-4000-8000-000000000006', 'org-as')$$, '42501'::char(5), NULL::text, '[F-20][anon] can no longer probe application relationships');
insert into test_log(line) select * from extensions.lives_ok($$select public.list_business_listings_public(null, null, null, 10, 0)$$, '[F-20][anon] public listings RPC still works');
insert into test_log(line) select * from extensions.lives_ok($$select public.priority_organization_ids()$$, '[F-20][anon] public priority-organization lookup still works');
reset role;

select line from test_log order by seq;
rollback;
