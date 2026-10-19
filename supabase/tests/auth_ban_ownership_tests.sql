-- =====================================================================
-- F-30 regression tests (migration 20261012300000): LibRise only ever clears a ban it
-- imposed, identified by the exact banned_until value it recorded. Stand-in or real GoTrue
-- schema. These tests prove the DATABASE logic only; they do not prove how a hosted Auth
-- service reports or stores banned_until. begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon, service_role;
grant usage, select on test_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select ('0b6b6b6b-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'ow-' || n || '@example.com', '{"primaryRole":"employer"}'::jsonb, now()
from generate_series(1, 12) n;
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values ('0b6b6b6b-0000-4000-8000-0000000000aa', 'ow-pa@example.com', 'OW PA', '+231-770-970-001', 'platform_admin', 'platform_admin', 'active');
update public.users set account_status = 'active' where id like '0b6b6b6b-%' and account_status = 'pending_verification';
insert into public.organizations (id, slug, name, type, industry, county, city_district, description, tax_id_number) values ('org-ow', 'org-ow', 'OW Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'f', 'TIN-OW');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values ('ow-m-10', 'org-ow', '0b6b6b6b-0000-4000-8000-000000000010', 'owner', 'active');
create or replace function pg_temp.u(n int) returns text language sql as $$ select '0b6b6b6b-0000-4000-8000-0000000000' || lpad(n::text, 2, '0') $$;
create or replace function pg_temp.banned(n int) returns timestamptz language sql as $$ select banned_until from auth.users where id = pg_temp.u(n)::uuid $$;

-- ===== 1. operator-imposed manual ban + a 'failed' enforcement record on an ACTIVE account  -> never auto-unbanned
update auth.users set banned_until = now() + interval '30 days' where id = pg_temp.u(1)::uuid;
insert into public.account_auth_enforcement (user_id, status, detail) values (pg_temp.u(1), 'failed', 'an earlier LibRise ban attempt failed');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(1)), 0::bigint, '[1] operator ban + status=failed on an active account is NOT selected for automatic unban (was: selected)');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_manual_review() where user_id = pg_temp.u(1)), 1::bigint, '[1] ...it is shown for manual review instead');
reset role;
-- the same for each status value: a record alone is never enough
update public.account_auth_enforcement set status = 'applied' where user_id = pg_temp.u(1);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(1)), 0::bigint, '[1] status=applied without an ownership value is not enough either');
reset role;
update public.account_auth_enforcement set status = 'cleared_failed' where user_id = pg_temp.u(1);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(1)), 0::bigint, '[1] nor is status=cleared_failed');
reset role;

-- ===== 1b. LibRise banned it, but the ban was later changed by an operator -> no longer LibRise's
update auth.users set banned_until = 'infinity' where id = pg_temp.u(2)::uuid;
insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until) values (pg_temp.u(2), 'applied', 'ok', 'infinity');
update auth.users set banned_until = now() + interval '90 days' where id = pg_temp.u(2)::uuid;   -- operator re-banned with a different value
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(2)), 0::bigint, '[1b] a ban whose value no longer equals the one LibRise wrote is treated as the operator''s: not auto-unbanned');
reset role;

-- ===== 2. previously banned by LibRise -> can still be reinstated when appropriate
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
select public.apply_account_restriction('ow-r3', pg_temp.u(3), 'full_suspension', 'abuse', null);
reset role;
insert into test_log(line) select * from extensions.ok((select imposed_banned_until = 'infinity' and banned_until = 'infinity' from public.account_auth_enforcement e join auth.users a on a.id::text = e.user_id where e.user_id = pg_temp.u(3)), '[2] suspending an un-banned account: LibRise imposes the ban and records ownership of that exact value');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
select public.lift_account_restriction('ow-r3');
reset role;
insert into test_log(line) select * from extensions.ok(pg_temp.banned(3) is null and (select status = 'cleared' and imposed_banned_until is null from public.account_auth_enforcement where user_id = pg_temp.u(3)), '[2] lifting the suspension clears LibRise''s own ban and releases ownership');
-- and through the report (Admin-API path): LibRise-owned ban on an account that is active again
update auth.users set banned_until = '9999-12-31T00:00:00Z' where id = pg_temp.u(4)::uuid;
insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until) values (pg_temp.u(4), 'applied', 'ban applied via admin api', '9999-12-31T00:00:00Z');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = pg_temp.u(4)), 'unban', '[2] a ban LibRise owns on an active account is listed for unban');
reset role;

-- ===== 3. a failed unban remains eligible for retry (ownership is kept)
update auth.users set banned_until = 'infinity' where id = pg_temp.u(5)::uuid;
insert into public.account_auth_enforcement (user_id, status, detail, imposed_banned_until) values (pg_temp.u(5), 'cleared_failed', 'admin api: 500', 'infinity');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select desired || '/' || enforcement_status from public.list_auth_enforcement_drift() where user_id = pg_temp.u(5)), 'unban/cleared_failed', '[3] a failed unban stays eligible for retry');
reset role;
select set_config('role','service_role',true);
select public.record_auth_enforcement(pg_temp.u(5), 'cleared_failed', 'retry 1 failed');
reset role;
insert into test_log(line) select * from extensions.ok((select imposed_banned_until = 'infinity' from public.account_auth_enforcement where user_id = pg_temp.u(5)), '[3] a repeated failure does not forget that the ban is LibRise''s');
select set_config('role','service_role',true);
select public.record_auth_enforcement(pg_temp.u(5), 'cleared', 'ban cleared via admin api');
reset role;
update auth.users set banned_until = null where id = pg_temp.u(5)::uuid;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(5)), 0::bigint, '[3] after a successful unban is recorded the account leaves the report');
reset role;

-- ===== 4. suspended + effective ban + lingering session rows -> not repeatedly selected
update public.users set account_status = 'suspended' where id = pg_temp.u(6);
insert into auth.sessions (id, user_id) values ('0b6b6b6b-0000-4000-8000-0000000001a6', pg_temp.u(6)::uuid);
insert into auth.refresh_tokens (user_id, session_id, token) values (pg_temp.u(6), '0b6b6b6b-0000-4000-8000-0000000001a6', 'tok-ow-6');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(6)), 0::bigint, '[4] suspended + LibRise ban in effect + lingering session rows is not selected');
insert into test_log(line) select * from extensions.ok((select live_sessions from public.list_suspended_accounts_not_banned() where user_id = pg_temp.u(6)) is null, '[4] (nor is it in the not-banned report)');
reset role;

-- ===== 5. suspended with a missing or expired ban -> eligible
update public.users set account_status = 'suspended' where id in (pg_temp.u(7), pg_temp.u(8));
update auth.users set banned_until = null where id = pg_temp.u(7)::uuid;
update auth.users set banned_until = now() - interval '1 day' where id = pg_temp.u(8)::uuid;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = pg_temp.u(7)), 'ban', '[5] suspended with a MISSING ban is eligible');
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = pg_temp.u(8)), 'ban', '[5] suspended with an EXPIRED ban is eligible');
reset role;

-- ===== 6. an operator's ban is never overwritten, and never removed on reinstatement
update auth.users set banned_until = now() + interval '60 days' where id = pg_temp.u(9)::uuid;   -- manual ban of an active account
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
select public.apply_account_restriction('ow-r9', pg_temp.u(9), 'full_suspension', 'abuse', null);
reset role;
insert into test_log(line) select * from extensions.ok(pg_temp.banned(9) < 'infinity' and pg_temp.banned(9) > now(), '[6] suspending an already-banned account does NOT overwrite the operator''s ban');
insert into test_log(line) select * from extensions.ok((select imposed_banned_until is null and status = 'applied' from public.account_auth_enforcement where user_id = pg_temp.u(9)), '[6] ...and LibRise claims no ownership of it');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = pg_temp.u(9)), 0::bigint, '[6] the suspended account is satisfied by the operator''s ban (no repeated sync)');
select public.lift_account_restriction('ow-r9');
reset role;
insert into test_log(line) select * from extensions.ok(pg_temp.banned(9) > now(), '[6] reinstating the account leaves the operator''s manual ban in place (was: removed)');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_manual_review() where user_id = pg_temp.u(9)), 1::bigint, '[6] ...and it is surfaced in the manual-review report');
reset role;

-- ownership survives a JSON round trip that drops sub-millisecond precision, but not a different value
insert into test_log(line) select * from extensions.ok(public.same_ban_instant('2200-01-01 00:00:00.123456+00', '2200-01-01 00:00:00.123999+00'), '[precision] values equal to the millisecond are the same ban');
insert into test_log(line) select * from extensions.ok(not public.same_ban_instant('2200-01-01 00:00:00.123+00', '2200-01-01 00:00:00.124+00'), '[precision] values a millisecond apart are different bans');
insert into test_log(line) select * from extensions.ok(public.same_ban_instant('infinity', 'infinity') and not public.same_ban_instant('infinity', null) and not public.same_ban_instant(null, null), '[precision] infinity matches only infinity; NULL never matches');

-- the operator ban expires while the account is still suspended -> drift -> LibRise imposes (and owns) its own
update public.users set account_status = 'suspended' where id = pg_temp.u(11);
update auth.users set banned_until = now() + interval '1 hour' where id = pg_temp.u(11)::uuid;   -- (u11 got a LibRise ban from the trigger; model an operator one instead)
update public.account_auth_enforcement set imposed_banned_until = null where user_id = pg_temp.u(11);
update auth.users set banned_until = now() - interval '1 minute' where id = pg_temp.u(11)::uuid;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b6b6b6b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.is((select desired from public.list_auth_enforcement_drift() where user_id = pg_temp.u(11)), 'ban', '[6] an operator ban that expires while the account is suspended is detected as drift');
insert into test_log(line) select * from extensions.is(public.reapply_account_auth_ban(pg_temp.u(11)), 'ok', '[6] an administrator can re-apply: LibRise now imposes its own ban');
reset role;
insert into test_log(line) select * from extensions.ok((select imposed_banned_until = 'infinity' from public.account_auth_enforcement where user_id = pg_temp.u(11)), '[6] ...and owns that new ban');

-- ===== 7. database authorization for a suspended account is unchanged
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub', pg_temp.u(6), true);
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations), 0::bigint, '[7] suspended account (ban + lingering sessions): protected reads return nothing');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.notifications (id, recipient_user_id, category, title, message) values ('n-ow6', '0b6b6b6b-0000-4000-8000-000000000006', 'system', 't', 'm')$$, '42501'::char(5), NULL::text, '[7] ...a prohibited write is denied');
insert into test_log(line) select * from extensions.throws_ok($$select public.create_organization_with_owner('org-ow-x', 'org-ow-x', 'x', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$, '42501'::char(5), NULL::text, '[7] ...a prohibited RPC is denied');
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-ow'])), 0::bigint, '[7] ...and private organization data is not returned');
reset role;
-- authorization of the tooling
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub', pg_temp.u(12), true);
insert into test_log(line) select * from extensions.throws_ok($$select * from public.list_auth_manual_review()$$, '42501'::char(5), NULL::text, '[auth] an ordinary user cannot read the manual-review report');
insert into test_log(line) select * from extensions.throws_ok($$select * from public.list_auth_enforcement_drift()$$, '42501'::char(5), NULL::text, '[auth] ...nor the drift report');
insert into test_log(line) select * from extensions.throws_ok($$select public.record_auth_enforcement('0b6b6b6b-0000-4000-8000-000000000001', 'applied', 'forged', 'infinity')$$, '42501'::char(5), NULL::text, '[auth] ...nor forge an ownership record');
insert into test_log(line) select * from extensions.throws_ok($$select public.clear_account_auth_ban('0b6b6b6b-0000-4000-8000-000000000001')$$, '42501'::char(5), NULL::text, '[auth] ...nor call the internal unban helper');
insert into test_log(line) select * from extensions.throws_ok($$select public.apply_account_auth_ban('0b6b6b6b-0000-4000-8000-000000000001')$$, '42501'::char(5), NULL::text, '[auth] ...nor the internal ban helper');
reset role;

select line from test_log order by seq;
rollback;
