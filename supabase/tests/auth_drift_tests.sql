-- =====================================================================
-- F-29 regression tests (migration 20261012290000): the enforcement drift report must
-- not treat lingering auth.sessions rows as drift for a validly banned account, while
-- still detecting missing/expired bans, failed enforcement and accounts to reinstate.
-- Also proves a suspended account holding a previously issued access token (modelled as a
-- JWT subject with live session rows) is denied by the DATABASE. Stand-in or real GoTrue
-- schema. These tests do NOT prove how a hosted Auth service treats an old access token.
-- begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon, service_role;
grant usage, select on test_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('0b5b5b5b-0000-4000-8000-000000000001', 'dr-n@example.com',  '{"primaryRole":"employer"}'::jsonb, now()),   -- N  suspended, ban lost (no effective ban)
  ('0b5b5b5b-0000-4000-8000-000000000002', 'dr-b1@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- B1 suspended, effective ban, no session rows
  ('0b5b5b5b-0000-4000-8000-000000000003', 'dr-b2@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- B2 suspended, effective ban, LINGERING session rows
  ('0b5b5b5b-0000-4000-8000-000000000004', 'dr-r@example.com',  '{"primaryRole":"employer"}'::jsonb, now()),   -- R  previously banned by LibRise, now to be reinstated
  ('0b5b5b5b-0000-4000-8000-000000000005', 'dr-f1@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- F1 suspended, effective ban, last enforcement FAILED
  ('0b5b5b5b-0000-4000-8000-000000000006', 'dr-f2@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- F2 suspended, ban EXPIRED
  ('0b5b5b5b-0000-4000-8000-000000000007', 'dr-f3@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- F3 active, ban still in effect after a FAILED unban
  ('0b5b5b5b-0000-4000-8000-000000000008', 'dr-op@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- OP active, operator's manual ban
  ('0b5b5b5b-0000-4000-8000-000000000009', 'dr-u@example.com',  '{"primaryRole":"job_seeker"}'::jsonb, now()); -- U  ordinary user
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values ('0b5b5b5b-0000-4000-8000-0000000000aa', 'dr-pa@example.com', 'DR PA', '+231-770-960-001', 'platform_admin', 'platform_admin', 'active');
update public.users set account_status = 'active' where id like '0b5b5b5b-%' and account_status = 'pending_verification';
insert into public.organizations (id, slug, name, type, industry, county, city_district, description, tax_id_number) values ('org-dr', 'org-dr', 'DR Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'f', 'TIN-DR');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values ('dr-m-b2', 'org-dr', '0b5b5b5b-0000-4000-8000-000000000003', 'owner', 'active');

-- suspend N, B1, B2, F1, F2 through the normal path (the trigger bans and, on this path, also clears sessions)
update public.users set account_status = 'suspended' where id in
  ('0b5b5b5b-0000-4000-8000-000000000001', '0b5b5b5b-0000-4000-8000-000000000002', '0b5b5b5b-0000-4000-8000-000000000003',
   '0b5b5b5b-0000-4000-8000-000000000005', '0b5b5b5b-0000-4000-8000-000000000006');
insert into test_log(line) select * from extensions.is((select count(*) from auth.users where banned_until = 'infinity' and id::text like '0b5b5b5b-%'), 5::bigint, '(setup) five accounts suspended and banned by the trigger');

-- N: the ban is lost
update auth.users set banned_until = null where id = '0b5b5b5b-0000-4000-8000-000000000001';
-- B2: the Admin-API path only sets banned_until and leaves sessions + refresh tokens behind: re-create them
insert into auth.sessions (id, user_id) values ('0b5b5b5b-0000-4000-8000-0000000001b2', '0b5b5b5b-0000-4000-8000-000000000003');
insert into auth.refresh_tokens (user_id, session_id, token) values ('0b5b5b5b-0000-4000-8000-000000000003', '0b5b5b5b-0000-4000-8000-0000000001b2', 'tok-dr-b2');
-- F1: ban effective, but the last enforcement attempt failed
insert into public.account_auth_enforcement (user_id, status, detail) values ('0b5b5b5b-0000-4000-8000-000000000005', 'failed', 'admin api: upstream 500')
  on conflict (user_id) do update set status = 'failed', detail = 'admin api: upstream 500';
insert into auth.sessions (id, user_id) values ('0b5b5b5b-0000-4000-8000-0000000001f1', '0b5b5b5b-0000-4000-8000-000000000005');
-- F2: the ban expired
update auth.users set banned_until = now() - interval '1 day' where id = '0b5b5b5b-0000-4000-8000-000000000006';
-- R: banned by LibRise earlier, account is active now
insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until) values ('0b5b5b5b-0000-4000-8000-000000000004', 'applied', 'ok', 'infinity');   -- LibRise owns this ban
update auth.users set banned_until = 'infinity' where id = '0b5b5b5b-0000-4000-8000-000000000004';
-- F3: unban failed
insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until) values ('0b5b5b5b-0000-4000-8000-000000000007', 'cleared_failed', 'admin api: upstream 500', 'infinity');   -- LibRise owns this ban
update auth.users set banned_until = 'infinity' where id = '0b5b5b5b-0000-4000-8000-000000000007';
-- OP: an operator's manual ban of an active account
update auth.users set banned_until = now() + interval '30 days' where id = '0b5b5b5b-0000-4000-8000-000000000008';

insert into test_log(line) select * from extensions.ok((select count(*) from auth.sessions where user_id = '0b5b5b5b-0000-4000-8000-000000000003') >= 1 and (select banned_until = 'infinity' from auth.users where id = '0b5b5b5b-0000-4000-8000-000000000003'), '(setup) B2 has an effective ban AND lingering session rows, as after an Admin-API ban');

-- =====================================================================
-- the drift report
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b5b5b5b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000001'), 'ban', '[1] suspended account with NO effective ban is listed (desired=ban)');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000002'), 0::bigint, '[2] suspended + effective ban + no session rows is NOT listed');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000003'), 0::bigint, '[3] suspended + effective ban + LINGERING session rows is NOT listed (was: listed forever)');
insert into test_log(line) select * from extensions.ok((select live_sessions from public.list_suspended_accounts_not_banned() where user_id = '0b5b5b5b-0000-4000-8000-000000000001') = 0, '[3] (the older report still exposes live_sessions as information)');
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000004'), 'unban', '[4] a previously banned account that should be reinstated is listed (desired=unban)');
insert into test_log(line) select * from extensions.is((select desired || '/' || enforcement_status from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000005'), 'ban/failed', '[5] a FAILED ban stays listed for retry even though the ban is in effect and sessions linger');
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000006'), 'ban', '[5] an EXPIRED ban is listed');
insert into test_log(line) select * from extensions.is((select desired || '/' || enforcement_status from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000007'), 'unban/cleared_failed', '[5] a FAILED unban stays listed');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000008'), 0::bigint, '[4] an operator''s manual ban of an active account is never listed for auto-unban');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_suspended_accounts_not_banned() where user_id in ('0b5b5b5b-0000-4000-8000-000000000002', '0b5b5b5b-0000-4000-8000-000000000003')), 0::bigint, '[3] the older reconciliation report agrees: effective bans are not "not banned"');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_suspended_accounts_not_banned() where user_id in ('0b5b5b5b-0000-4000-8000-000000000001', '0b5b5b5b-0000-4000-8000-000000000005', '0b5b5b5b-0000-4000-8000-000000000006')), 3::bigint, '[1,5] ...and still lists missing, failed and expired');
reset role;

-- a successful retry (what the server records after an Admin-API call) converges: the account leaves the report although sessions remain
select set_config('role','service_role',true);
select public.record_auth_enforcement('0b5b5b5b-0000-4000-8000-000000000005', 'applied', 'ban applied via admin api');
select public.record_auth_enforcement('0b5b5b5b-0000-4000-8000-000000000007', 'failed', 'x');
reset role;
update auth.users set banned_until = null where id = '0b5b5b5b-0000-4000-8000-000000000007';
select set_config('role','service_role',true);
select public.record_auth_enforcement('0b5b5b5b-0000-4000-8000-000000000007', 'cleared', 'ban cleared via admin api');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b5b5b5b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000005'), 0::bigint, '[5] after a successful retry is recorded, the account leaves the report even though session rows remain');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = '0b5b5b5b-0000-4000-8000-000000000007'), 0::bigint, '[5] after a successful unban is recorded, the account leaves the report');
reset role;

-- =====================================================================
-- the database is still the authority: B2 holds live session rows and an effective ban,
-- and presents a previously issued access token (a JWT whose subject is B2)
-- =====================================================================
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b5b5b5b-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.ok(public.current_account_suspended(), '[6] B2 is suspended for the database');
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations), 0::bigint, '[6] old access token: protected table reads return nothing');
insert into test_log(line) select * from extensions.is((select count(*) from public.organization_memberships), 0::bigint, '[6] old access token: B2 cannot even read their own membership');
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-dr'])), 0::bigint, '[6] old access token: private organization data is not returned');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n-dr-b2', '0b5b5b5b-0000-4000-8000-000000000003', 'system', 't', 'm')$$, '42501'::char(5), NULL::text, '[6] old access token: a prohibited table write is denied');
insert into test_log(line) select * from extensions.throws_ok($$select public.create_organization_with_owner('org-dr-new', 'org-dr-new', 'x', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$, '42501'::char(5), NULL::text, '[6] old access token: a prohibited RPC is denied');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.list_auth_enforcement_drift()$$, '42501'::char(5), NULL::text, '[6] old access token: even the enforcement report is refused');
reset role;
-- an ordinary user can never choose accounts: the report and the recorder are closed to them
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b5b5b5b-0000-4000-8000-000000000009',true);
insert into test_log(line) select * from extensions.throws_ok($$select * from public.list_auth_enforcement_drift()$$, '42501'::char(5), NULL::text, '[auth] an ordinary user cannot read the drift report');
insert into test_log(line) select * from extensions.throws_ok($$select public.record_auth_enforcement('0b5b5b5b-0000-4000-8000-000000000003', 'cleared', 'forged')$$, '42501'::char(5), NULL::text, '[auth] an ordinary user cannot record or forge an enforcement result');
reset role;

select line from test_log order by seq;
rollback;
