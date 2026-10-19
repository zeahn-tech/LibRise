-- =====================================================================
-- F-19b regression tests (migration 20261012260000): Auth ban / session revocation
-- and reinstatement. Runs on a stand-in OR the real GoTrue auth schema.
-- These tests prove the DATABASE side only. Sign-in / token-refresh refusal is done
-- by the Auth service reading auth.users.banned_until and cannot be exercised here:
-- see docs/LAUNCH_AUDIT.md "Required staging validation".
-- begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- accounts created through auth.users (the signup trigger creates the public.users rows)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('0b1b1b1b-0000-4000-8000-000000000001', 'ab-v1@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- V1 plain victim
  ('0b1b1b1b-0000-4000-8000-000000000002', 'ab-v2@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- V2 failure injection
  ('0b1b1b1b-0000-4000-8000-000000000003', 'ab-v3@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- V3 posting_disabled + full_suspension
  ('0b1b1b1b-0000-4000-8000-000000000004', 'ab-v4@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- V4 two full suspensions (one appealed)
  ('0b1b1b1b-0000-4000-8000-000000000005', 'ab-v5@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- V5 suspended out-of-band
  ('0b1b1b1b-0000-4000-8000-000000000007', 'ab-v7@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- V7 deactivated
  ('0b1b1b1b-0000-4000-8000-000000000009', 'ab-u@example.com',  '{"primaryRole":"job_seeker"}'::jsonb, now()); -- U ordinary user
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0b1b1b1b-0000-4000-8000-000000000008', 'ab-pa@example.com', 'AB PA', '+231-770-800-008', 'platform_admin', 'platform_admin', 'active'),
  ('0b1b1b1b-0000-4000-8000-000000000006', 'ab-v6@example.com', 'AB V6 (no auth user)', '+231-770-800-006', 'employer', 'user', 'active');
insert into public.organizations (id, slug, name, type, industry, county, city_district, description) values ('org-ab', 'org-ab', 'AB Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values ('ab-m3', 'org-ab', '0b1b1b1b-0000-4000-8000-000000000003', 'admin', 'active');
-- live sessions + refresh tokens for the victims
insert into auth.sessions (id, user_id) select ('0b1b1b1b-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, ('0b1b1b1b-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 5) n;
insert into auth.refresh_tokens (user_id, session_id, token) select '0b1b1b1b-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'), ('0b1b1b1b-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'tok-ab-' || n from generate_series(1, 5) n;

-- =====================================================================
-- A. Authorization: only a platform administrator can suspend
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000009',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.apply_account_restriction('ab-bad', '0b1b1b1b-0000-4000-8000-000000000001', 'full_suspension', 'x', null)$$, '42501'::char(5), NULL::text, '[unauthorized] an ordinary user cannot suspend another account');
insert into test_log(line) select * from extensions.throws_ok($$select public.set_auth_ban('0b1b1b1b-0000-4000-8000-000000000001', true)$$, '42501'::char(5), NULL::text, '[unauthorized] set_auth_ban is not callable by client roles');
insert into test_log(line) select * from extensions.throws_ok($$select public.reapply_account_auth_ban('0b1b1b1b-0000-4000-8000-000000000001')$$, '42501'::char(5), NULL::text, '[unauthorized] an ordinary user cannot re-apply a ban');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.list_suspended_accounts_not_banned()$$, '42501'::char(5), NULL::text, '[unauthorized] an ordinary user cannot run the reconciliation report');
update public.users set account_status = 'suspended' where id = '0b1b1b1b-0000-4000-8000-000000000001';   -- RLS: not the caller's row -> 0 rows
insert into test_log(line) select * from extensions.is((select count(*) from public.account_auth_enforcement), 0::bigint, '[unauthorized] ordinary users cannot read the enforcement records');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status <> 'suspended' from public.users where id = '0b1b1b1b-0000-4000-8000-000000000001') and (select banned_until is null from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000001'), '[unauthorized] none of those attempts (incl. a direct UPDATE of the other account) suspended or banned the target');

-- =====================================================================
-- B. Authorized suspension bans the auth user and revokes sessions
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('ab-r1', '0b1b1b1b-0000-4000-8000-000000000001', 'full_suspension', 'abuse', null)$$, '[admin] suspends V1');
reset role;
insert into test_log(line) select * from extensions.is((select account_status from public.users where id = '0b1b1b1b-0000-4000-8000-000000000001'), 'suspended', '[V1] account_status is suspended');
insert into test_log(line) select * from extensions.ok((select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000001'), '[V1] auth.users.banned_until = infinity (GoTrue refuses sign-in and token refresh while this is set)');
insert into test_log(line) select * from extensions.is((select count(*) from auth.sessions where user_id = '0b1b1b1b-0000-4000-8000-000000000001') + (select count(*) from auth.refresh_tokens where user_id = '0b1b1b1b-0000-4000-8000-000000000001'), 0::bigint, '[V1] sessions and refresh tokens are gone');
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b1b1b1b-0000-4000-8000-000000000001'), 'applied', '[V1] enforcement record says applied');
-- a previously issued access token (still cryptographically valid) vs the database
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations), 0::bigint, '[V1 old access token] protected reads return nothing');
insert into test_log(line) select * from extensions.throws_ok($$select public.create_organization_with_owner('org-ab-v1', 'org-ab-v1', 'x', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$, '42501'::char(5), NULL::text, '[V1 old access token] prohibited write (RPC) is denied');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n-ab-v1', '0b1b1b1b-0000-4000-8000-000000000001', 'system', 't', 'm')$$, '42501'::char(5), NULL::text, '[V1 old access token] prohibited write (table INSERT) is denied');
reset role;

-- =====================================================================
-- C. A failure during session revocation is detectable and does NOT undo the ban
-- =====================================================================
create function pg_temp.ab_boom() returns trigger language plpgsql as $$ begin raise exception 'simulated failure: permission denied'; end $$;
create trigger ab_boom_tokens before delete on auth.refresh_tokens for each row execute function pg_temp.ab_boom();
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('ab-r2', '0b1b1b1b-0000-4000-8000-000000000002', 'full_suspension', 'abuse', null)$$, '[failure] the suspension itself still succeeds (database denial applies)');
reset role;
insert into test_log(line) select * from extensions.is((select account_status from public.users where id = '0b1b1b1b-0000-4000-8000-000000000002'), 'suspended', '[failure][V2] account_status is suspended');
insert into test_log(line) select * from extensions.ok((select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000002'), '[failure][V2] the ban PERSISTS even though session cleanup failed (was rolled back)');
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b1b1b1b-0000-4000-8000-000000000002'), 'failed', '[failure][V2] enforcement is recorded as FAILED, not applied');
insert into test_log(line) select * from extensions.ok((select detail like 'failed:%' from public.account_auth_enforcement where user_id = '0b1b1b1b-0000-4000-8000-000000000002'), '[failure][V2] the failure detail is stored');
insert into test_log(line) select * from extensions.is((select count(*) from public.audit_logs where action = 'user.auth_ban_failed' and resource_id = '0b1b1b1b-0000-4000-8000-000000000002'), 1::bigint, '[failure][V2] an audit_logs entry is written');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.ok((select count(*) from public.list_suspended_accounts_not_banned() where user_id = '0b1b1b1b-0000-4000-8000-000000000002') = 1, '[failure][V2] the reconciliation report lists the account (the last enforcement failed)');
reset role;
drop trigger ab_boom_tokens on auth.refresh_tokens;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.is(public.reapply_account_auth_ban('0b1b1b1b-0000-4000-8000-000000000002'), 'ok', '[failure][V2] after the cause is fixed an administrator can re-apply the ban');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_suspended_accounts_not_banned() where user_id = '0b1b1b1b-0000-4000-8000-000000000002'), 0::bigint, '[failure][V2] and the account leaves the report');
reset role;
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b1b1b1b-0000-4000-8000-000000000002'), 'applied', '[failure][V2] enforcement record now says applied');

-- =====================================================================
-- D. Reinstatement
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.lift_account_restriction('ab-r1')$$, '[admin] reinstates V1');
reset role;
insert into test_log(line) select * from extensions.is((select account_status from public.users where id = '0b1b1b1b-0000-4000-8000-000000000001'), 'active', '[V1] account_status is active again');
insert into test_log(line) select * from extensions.ok((select banned_until is null from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000001'), '[V1] the ban is cleared');
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b1b1b1b-0000-4000-8000-000000000001'), 'cleared', '[V1] enforcement record says cleared');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.ok((select count(*) from public.organizations) > 0, '[V1 reinstated] can read data again');
insert into test_log(line) select * from extensions.lives_ok($$select public.create_organization_with_owner('org-ab-v1', 'org-ab-v1', 'AB V1 Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$, '[V1 reinstated] can perform an authorized operation');
reset role;

-- reinstatement must not override unrelated restrictions / other suspensions
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status) values
  ('ab-r3-post', '0b1b1b1b-0000-4000-8000-000000000003', 'V3', 'ab-v3@example.com', 'posting_disabled', 'x', '0b1b1b1b-0000-4000-8000-000000000008', 'AB PA', null, 'active'),
  ('ab-r3-full', '0b1b1b1b-0000-4000-8000-000000000003', 'V3', 'ab-v3@example.com', 'full_suspension',  'x', '0b1b1b1b-0000-4000-8000-000000000008', 'AB PA', null, 'active'),
  ('ab-r4-a',    '0b1b1b1b-0000-4000-8000-000000000004', 'V4', 'ab-v4@example.com', 'full_suspension',  'x', '0b1b1b1b-0000-4000-8000-000000000008', 'AB PA', null, 'active'),
  ('ab-r4-b',    '0b1b1b1b-0000-4000-8000-000000000004', 'V4', 'ab-v4@example.com', 'full_suspension',  'x', '0b1b1b1b-0000-4000-8000-000000000008', 'AB PA', null, 'appealed');
update public.users set account_status = 'suspended' where id in ('0b1b1b1b-0000-4000-8000-000000000003', '0b1b1b1b-0000-4000-8000-000000000004');   -- the trigger bans both
insert into test_log(line) select * from extensions.ok((select count(*) = 2 from auth.users where id in ('0b1b1b1b-0000-4000-8000-000000000003', '0b1b1b1b-0000-4000-8000-000000000004') and banned_until = 'infinity'), '[V3,V4] suspension by direct status change (any pathway) also bans the auth users');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
select public.lift_account_restriction('ab-r3-post');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'suspended' from public.users where id = '0b1b1b1b-0000-4000-8000-000000000003') and (select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000003'), '[V3] lifting an UNRELATED restriction (posting_disabled) does not reinstate a suspended account');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
select public.lift_account_restriction('ab-r4-a');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'suspended' from public.users where id = '0b1b1b1b-0000-4000-8000-000000000004') and (select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000004'), '[V4] lifting one full_suspension while another (appealed) remains keeps the account suspended and banned');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
select public.lift_account_restriction('ab-r4-b');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'active' from public.users where id = '0b1b1b1b-0000-4000-8000-000000000004') and (select banned_until is null from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000004'), '[V4] lifting the last full_suspension reinstates and unbans');
-- V3 now has posting_disabled lifted; re-add one to prove it survives reinstatement of the suspension
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status)
values ('ab-r3-post2', '0b1b1b1b-0000-4000-8000-000000000003', 'V3', 'ab-v3@example.com', 'posting_disabled', 'x', '0b1b1b1b-0000-4000-8000-000000000008', 'AB PA', null, 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
select public.lift_account_restriction('ab-r3-full');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.ok(public.current_has_restriction('posting_disabled') and not public.current_account_suspended(), '[V3] after reinstatement the unrelated posting_disabled restriction is STILL in force and the account is active');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values ('opp-ab-v3', 'org-ab', '0b1b1b1b-0000-4000-8000-000000000003', 'x', 'ab-v3-opp', 'job', 'onsite', 'Montserrado', 'x', 'x', 'draft')$$, '42501'::char(5), NULL::text, '[V3] ...and posting is still denied');
reset role;

-- =====================================================================
-- E. Out-of-band suspension, deactivation, account without an auth user
-- =====================================================================
update public.users set account_status = 'suspended' where id = '0b1b1b1b-0000-4000-8000-000000000005';
insert into test_log(line) select * from extensions.ok((select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000005'), '[V5] a suspension made directly in the database (dashboard / service role) bans the auth user');
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status)
values ('ab-r5-post', '0b1b1b1b-0000-4000-8000-000000000005', 'V5', 'ab-v5@example.com', 'posting_disabled', 'x', '0b1b1b1b-0000-4000-8000-000000000008', 'AB PA', null, 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b1b1b1b-0000-4000-8000-000000000008',true);
select public.lift_account_restriction('ab-r5-post');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'suspended' from public.users where id = '0b1b1b1b-0000-4000-8000-000000000005') and (select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000005'), '[V5] lifting an unrelated restriction does not reinstate an out-of-band suspension (was: it did)');
update public.users set account_status = 'deactivated' where id = '0b1b1b1b-0000-4000-8000-000000000007';
insert into test_log(line) select * from extensions.ok((select banned_until = 'infinity' from auth.users where id = '0b1b1b1b-0000-4000-8000-000000000007'), '[V7] deactivation also bans the auth user');
update public.users set account_status = 'suspended' where id = '0b1b1b1b-0000-4000-8000-000000000006';
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b1b1b1b-0000-4000-8000-000000000006'), 'no_auth_user', '[V6] a public profile with no auth user is recorded as no_auth_user (not an error)');

select line from test_log order by seq;
rollback;
