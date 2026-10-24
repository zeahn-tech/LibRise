-- Regression tests for 20261024100000_admin_lockout_protection.sql
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values
 ('0a0a0a0a-0000-4000-8000-000000000001','al-admin1@example.com','AL Admin One','+231-770-400-001','platform_admin','platform_admin','active',true),
 ('0a0a0a0a-0000-4000-8000-000000000002','al-admin2@example.com','AL Admin Two','+231-770-400-002','platform_admin','platform_admin','active',true),
 ('0a0a0a0a-0000-4000-8000-000000000003','al-user@example.com','AL User','+231-770-400-003','job_seeker','user','active',true);

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.apply_account_restriction('al-r1','0a0a0a0a-0000-4000-8000-000000000001','full_suspension','self',null)$$, '42501'::char(5), NULL::text, '[admin] cannot suspend own account');
insert into test_log(line) select * from extensions.throws_ok($$select public.apply_account_restriction('al-r1b','0a0a0a0a-0000-4000-8000-000000000001','posting_disabled','self',null)$$, '42501'::char(5), NULL::text, '[admin] cannot restrict own account (any type)');
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('al-r2','0a0a0a0a-0000-4000-8000-000000000003','full_suspension','ok',null)$$, '[admin] can suspend a normal user');
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('al-r3','0a0a0a0a-0000-4000-8000-000000000002','full_suspension','other admin',null)$$, '[admin] can suspend another admin while a third admin remains');
reset role;
insert into test_log(line) select * from extensions.is((select account_status from public.users where id='0a0a0a0a-0000-4000-8000-000000000001'), 'active', '[admin] own account still active');
insert into test_log(line) select * from extensions.is((select account_status from public.users where id='0a0a0a0a-0000-4000-8000-000000000002'), 'suspended', '[admin] other admin was suspended');

-- A suspended admin cannot act, so a sequence of suspensions can never leave zero active admins:
-- the acting admin must stay active and cannot target themselves.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0a0a0a0a-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.apply_account_restriction('al-r4','0a0a0a0a-0000-4000-8000-000000000001','full_suspension','retaliate',null)$$, NULL::char(5), NULL::text, '[suspended admin] cannot suspend the remaining admin');
reset role;
insert into test_log(line) select * from extensions.is((select count(*)::int from public.users where system_role='platform_admin' and account_status='active'), 1, 'at least one active platform admin remains');

select line from test_log order by seq;
rollback;
