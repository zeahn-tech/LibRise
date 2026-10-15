-- =====================================================================
-- F-28 regression tests (migration 20261012280000): account status, restriction
-- records and the Auth ban cannot become inconsistent. Runs on a stand-in OR the
-- real GoTrue auth schema. begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon, service_role;
grant usage, select on test_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('0b3b3b3b-0000-4000-8000-000000000001', 'cs-a@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- A: single active full suspension
  ('0b3b3b3b-0000-4000-8000-000000000002', 'cs-b@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- B: appealed full suspension
  ('0b3b3b3b-0000-4000-8000-000000000003', 'cs-c@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- C: two qualifying suspensions + unrelated restriction
  ('0b3b3b3b-0000-4000-8000-000000000004', 'cs-d@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- D: legacy inconsistent state (status active, restriction active)
  ('0b3b3b3b-0000-4000-8000-000000000005', 'cs-e@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- E: restriction row inserted directly
  ('0b3b3b3b-0000-4000-8000-000000000006', 'cs-f@example.com', '{"primaryRole":"employer"}'::jsonb, null),    -- F: unconfirmed email + suspension
  ('0b3b3b3b-0000-4000-8000-000000000007', 'cs-g@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- G: banned by an operator, never by LibRise
  ('0b3b3b3b-0000-4000-8000-000000000008', 'cs-h@example.com', '{"primaryRole":"employer"}'::jsonb, now()),   -- H: LibRise-banned, then status reset (drift)
  ('0b3b3b3b-0000-4000-8000-000000000009', 'cs-u@example.com', '{"primaryRole":"job_seeker"}'::jsonb, now()); -- U: ordinary user
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values ('0b3b3b3b-0000-4000-8000-0000000000aa', 'cs-pa@example.com', 'CS PA', '+231-770-950-001', 'platform_admin', 'platform_admin', 'active');
update public.users set account_status = 'active' where account_status = 'pending_verification' and id like '0b3b3b3b-%' and id <> '0b3b3b3b-0000-4000-8000-000000000006';
insert into public.organizations (id, slug, name, type, industry, county, city_district, description, tax_id_number) values ('org-cs', 'org-cs', 'CS Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'f', 'TIN-CS');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values
  ('cs-m-a', 'org-cs', '0b3b3b3b-0000-4000-8000-000000000001', 'owner', 'active'),
  ('cs-m-d', 'org-cs', '0b3b3b3b-0000-4000-8000-000000000004', 'admin', 'active');
create or replace function pg_temp.cs_r(p_id text, p_user text, p_type text, p_status text, p_exp timestamptz default null) returns void language sql as $$
  insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status)
  values (p_id, p_user, 'x', 'x@example.com', p_type, 't', '0b3b3b3b-0000-4000-8000-0000000000aa', 'CS PA', p_exp, p_status) $$;

-- ===== 1. A: a direct administrative status update cannot reinstate an account with an ACTIVE full suspension
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
select public.apply_account_restriction('cs-r-a', '0b3b3b3b-0000-4000-8000-000000000001', 'full_suspension', 'abuse', null);
reset role;
insert into test_log(line) select * from extensions.throws_ok($$update public.users set account_status = 'active' where id = '0b3b3b3b-0000-4000-8000-000000000001'$$, '23514'::char(5), NULL::text,
  '[1] a direct (administrative / service-role) status update to active is REFUSED while a full suspension is active');
insert into test_log(line) select * from extensions.throws_ok($$update public.users set account_status = 'pending_verification' where id = '0b3b3b3b-0000-4000-8000-000000000001'$$, '23514'::char(5), NULL::text,
  '[1] ...and so is any other non-suspended status');
insert into test_log(line) select * from extensions.ok((select account_status = 'suspended' from public.users where id = '0b3b3b3b-0000-4000-8000-000000000001') and (select banned_until = 'infinity' from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000001'), '[1] the account stays suspended and banned');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-cs'])), 0::bigint, '[1] private organization data stays unavailable');
reset role;
-- the legitimate workflow: lifting the final qualifying suspension
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.lift_account_restriction('cs-r-a')$$, '[4] lifting the FINAL qualifying suspension still works');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'active' from public.users where id = '0b3b3b3b-0000-4000-8000-000000000001') and (select banned_until is null from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000001'), '[4] ...the account is active and the ban is cleared');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-cs'])), 1::bigint, '[4] ...and the owner gets private organization data again');
reset role;

-- ===== 2. B: an APPEALED, unexpired full suspension still counts
select pg_temp.cs_r('cs-r-b', '0b3b3b3b-0000-4000-8000-000000000002', 'full_suspension', 'appealed');
insert into test_log(line) select * from extensions.is((select account_status from public.users where id = '0b3b3b3b-0000-4000-8000-000000000002'), 'suspended', '[2] inserting an appealed full suspension directly moves the account to suspended (restriction/status sync)');
insert into test_log(line) select * from extensions.ok((select banned_until = 'infinity' from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000002'), '[2] ...and bans the auth user');
insert into test_log(line) select * from extensions.throws_ok($$update public.users set account_status = 'active' where id = '0b3b3b3b-0000-4000-8000-000000000002'$$, '23514'::char(5), NULL::text, '[2] an appealed suspension cannot be bypassed by a status update');
-- an EXPIRED suspension no longer blocks a deliberate reinstatement
update public.account_restrictions set expires_at = now() - interval '1 hour' where id = 'cs-r-b';
insert into test_log(line) select * from extensions.lives_ok($$update public.users set account_status = 'active' where id = '0b3b3b3b-0000-4000-8000-000000000002'$$, '[2] once the suspension has EXPIRED an administrator can reinstate the account');
insert into test_log(line) select * from extensions.ok((select banned_until is null from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000002'), '[2] ...which clears the ban');

-- ===== 3/4. C: several suspensions + an unrelated restriction
select pg_temp.cs_r('cs-r-c1', '0b3b3b3b-0000-4000-8000-000000000003', 'full_suspension', 'active');
select pg_temp.cs_r('cs-r-c2', '0b3b3b3b-0000-4000-8000-000000000003', 'full_suspension', 'appealed');
select pg_temp.cs_r('cs-r-c3', '0b3b3b3b-0000-4000-8000-000000000003', 'posting_disabled', 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
select public.lift_account_restriction('cs-r-c1');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'suspended' from public.users where id = '0b3b3b3b-0000-4000-8000-000000000003') and (select banned_until = 'infinity' from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000003'), '[3] lifting ONE of two qualifying suspensions does not restore access');
insert into test_log(line) select * from extensions.throws_ok($$update public.users set account_status = 'active' where id = '0b3b3b3b-0000-4000-8000-000000000003'$$, '23514'::char(5), NULL::text, '[3] ...and a direct status update is still refused');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.ok(public.current_account_suspended(), '[3] the account is still suspended for RLS');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
select public.lift_account_restriction('cs-r-c2');
reset role;
insert into test_log(line) select * from extensions.ok((select account_status = 'active' from public.users where id = '0b3b3b3b-0000-4000-8000-000000000003') and (select banned_until is null from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000003'), '[4] lifting the LAST qualifying suspension reinstates and unbans');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.ok(public.current_has_restriction('posting_disabled') and not public.current_account_suspended(), '[5] the unrelated posting_disabled restriction is STILL in force after reinstatement');
reset role;

-- ===== 6. D: legacy rows whose status and restriction record disagree
alter table public.users disable trigger trg_00_guard_account_status_consistency;     -- simulate rows created BEFORE this migration:
alter table public.users disable trigger trg_enforce_account_auth_ban;                 -- none of the three triggers existed then
alter table public.account_restrictions disable trigger trg_sync_status_on_full_suspension;
select pg_temp.cs_r('cs-r-d', '0b3b3b3b-0000-4000-8000-000000000004', 'full_suspension', 'active');
update public.users set account_status = 'active' where id = '0b3b3b3b-0000-4000-8000-000000000004';
alter table public.users enable trigger trg_00_guard_account_status_consistency;
alter table public.users enable trigger trg_enforce_account_auth_ban;
alter table public.account_restrictions enable trigger trg_sync_status_on_full_suspension;
insert into test_log(line) select * from extensions.ok((select account_status = 'active' from public.users where id = '0b3b3b3b-0000-4000-8000-000000000004'), '[6] (setup) legacy account: status says active, a full suspension is still active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.is((select count(*) from public.get_organization_private_fields(array['org-cs'])), 0::bigint, '[6] get_organization_private_fields returns NOTHING (it now honours the restriction record, not only the status)');
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations), 0::bigint, '[6] RLS also returns nothing');
insert into test_log(line) select * from extensions.throws_ok($$select public.create_organization_with_owner('org-cs-d', 'org-cs-d', 'x', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$, '42501'::char(5), NULL::text, '[6] RPCs refuse the account');
reset role;

-- the documented review query for LEGACY inconsistent rows (docs/LAUNCH_AUDIT.md) must find D (and only legacy-style rows)
insert into test_log(line) select * from extensions.is(
  (select string_agg(u.id, ',' order by u.id) from public.users u
   where u.id like '0b3b3b3b-%' and u.account_status not in ('suspended', 'deactivated')
     and exists (select 1 from public.account_restrictions r
                 where r.user_id = u.id and r.restriction_type = 'full_suspension'
                   and r.status in ('active', 'appealed') and (r.expires_at is null or r.expires_at > now()))),
  '0b3b3b3b-0000-4000-8000-000000000004',
  '[legacy review query] lists exactly the account whose status disagrees with an active full suspension');
-- ===== E: a restriction inserted directly (no RPC) suspends and bans
select pg_temp.cs_r('cs-r-e', '0b3b3b3b-0000-4000-8000-000000000005', 'full_suspension', 'active');
insert into test_log(line) select * from extensions.ok((select account_status = 'suspended' from public.users where id = '0b3b3b3b-0000-4000-8000-000000000005') and (select banned_until = 'infinity' from auth.users where id = '0b3b3b3b-0000-4000-8000-000000000005'), '[E] a full_suspension row inserted by any path suspends the account and bans the auth user');
-- ===== F: confirming an email cannot reinstate a suspended account
select pg_temp.cs_r('cs-r-f', '0b3b3b3b-0000-4000-8000-000000000006', 'full_suspension', 'active');
update auth.users set email_confirmed_at = now() where id = '0b3b3b3b-0000-4000-8000-000000000006';
insert into test_log(line) select * from extensions.is((select account_status from public.users where id = '0b3b3b3b-0000-4000-8000-000000000006'), 'suspended', '[F] email confirmation does not turn a suspended account into an active one (and does not fail)');

-- ===== 7/8. drift report, supported-API recording, authorization
update auth.users set banned_until = now() + interval '30 days' where id = '0b3b3b3b-0000-4000-8000-000000000007';   -- G: operator ban, no LibRise record
insert into public.account_auth_enforcement (user_id, status, detail) values ('0b3b3b3b-0000-4000-8000-000000000008', 'applied', 'ok');
update auth.users set banned_until = 'infinity' where id = '0b3b3b3b-0000-4000-8000-000000000008';                   -- H: banned by LibRise earlier, account is active now
update auth.users set banned_until = null where id = '0b3b3b3b-0000-4000-8000-000000000005';                          -- E: ban lost (simulated) -> needs re-ban
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.ok((select desired from public.list_auth_enforcement_drift() where user_id = '0b3b3b3b-0000-4000-8000-000000000005') = 'ban', '[7] drift report: a suspended account whose ban is missing is listed with desired=ban');
insert into test_log(line) select * from extensions.ok((select desired from public.list_auth_enforcement_drift() where user_id = '0b3b3b3b-0000-4000-8000-000000000008') = 'unban', '[7] drift report: an active account still banned by LibRise is listed with desired=unban');
insert into test_log(line) select * from extensions.is((select count(*) from public.list_auth_enforcement_drift() where user_id = '0b3b3b3b-0000-4000-8000-000000000007'), 0::bigint, '[7] drift report never lists an operator''s manual ban for auto-unban');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-000000000009',true);
insert into test_log(line) select * from extensions.throws_ok($$select * from public.list_auth_enforcement_drift()$$, '42501'::char(5), NULL::text, '[8] an ordinary user cannot run the drift report');
insert into test_log(line) select * from extensions.throws_ok($$select public.record_auth_enforcement('0b3b3b3b-0000-4000-8000-000000000001', 'applied', 'forged')$$, '42501'::char(5), NULL::text, '[8] an ordinary user cannot record enforcement results');
insert into test_log(line) select * from extensions.throws_ok($$select public.reapply_account_auth_ban('0b3b3b3b-0000-4000-8000-000000000001')$$, '42501'::char(5), NULL::text, '[8] an ordinary user cannot retry a ban');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.record_auth_enforcement('0b3b3b3b-0000-4000-8000-000000000001', 'applied', 'forged')$$, '42501'::char(5), NULL::text, '[8] even a platform administrator token cannot call record_auth_enforcement (service role only)');
reset role;
select set_config('role','service_role',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.record_auth_enforcement('0b3b3b3b-0000-4000-8000-000000000005', 'failed', 'admin api: 500 from upstream')$$, '[7] the server (service role) can record a FAILED enforcement');
insert into test_log(line) select * from extensions.throws_ok($$select public.record_auth_enforcement('0b3b3b3b-0000-4000-8000-000000000005', 'success', 'x')$$, '22023'::char(5), NULL::text, '[7] unknown status values are rejected');
reset role;
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b3b3b3b-0000-4000-8000-000000000005'), 'failed', '[7] the failure is recorded');
insert into test_log(line) select * from extensions.ok((select count(*) from public.audit_logs where action = 'user.auth_ban_failed' and resource_id = '0b3b3b3b-0000-4000-8000-000000000005') >= 1, '[7] ...and audited');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b3b3b3b-0000-4000-8000-0000000000aa',true);
insert into test_log(line) select * from extensions.ok((select enforcement_status from public.list_auth_enforcement_drift() where user_id = '0b3b3b3b-0000-4000-8000-000000000005') = 'failed', '[7] an administrator can see the failed enforcement and its desired state, ready for retry');
reset role;
select set_config('role','service_role',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.record_auth_enforcement('0b3b3b3b-0000-4000-8000-000000000005', 'applied', 'retry via admin api ok')$$, '[7] a successful retry overwrites the failed record');
reset role;
insert into test_log(line) select * from extensions.is((select status from public.account_auth_enforcement where user_id = '0b3b3b3b-0000-4000-8000-000000000005'), 'applied', '[7] ...the record says applied');

select line from test_log order by seq;
rollback;
