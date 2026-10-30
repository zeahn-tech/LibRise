-- Maximum job expiry (20261030100000_max_job_expiry.sql): setting validation, enforcement, and what must NOT be blocked.
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values
 ('0b0b0b0b-0000-4000-8000-0000000000a1','ex-admin@example.com','EX Admin','+231-770-600-001','platform_admin','platform_admin','active',true),
 ('0b0b0b0b-0000-4000-8000-0000000000a2','ex-owner@example.com','EX Owner','+231-770-600-002','employer','user','active',true),
 ('0b0b0b0b-0000-4000-8000-0000000000a3','ex-user@example.com','EX User','+231-770-600-003','job_seeker','user','active',true);
insert into public.organizations (id, slug, name, type, industry, county, city_district, description) values ('org-ex','org-ex','EX Org','private_company','services','Montserrado','Monrovia','fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions) values ('ex-m-owner','org-ex','0b0b0b0b-0000-4000-8000-0000000000a2','owner','active','[]'::jsonb);

-- A vacancy that predates the cap: far deadline, created with the rule switched off (as old data would be).
alter table public.opportunities disable trigger trg_enforce_max_job_expiry;
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status, application_deadline) values ('ex-legacy','org-ex','0b0b0b0b-0000-4000-8000-0000000000a2','Expiry ex-legacy','ex-legacy','job','onsite','Montserrado','x','x','published', now() + interval '400 days');
alter table public.opportunities enable trigger trg_enforce_max_job_expiry;

insert into test_log(line) select * from extensions.is(public.platform_max_job_days(), 90, 'the default limit is 90 days when no setting exists');

-- 1. Setting validation (admin only, whole days 7..365).
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-0000000000a3',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb(30))$$, '42501'::char(5), NULL::text, '[user] cannot change the limit');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-0000000000a1',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb(6))$$, '22023'::char(5), NULL::text, '[admin] rejects below 7 days');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb(366))$$, '22023'::char(5), NULL::text, '[admin] rejects above 365 days');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb(45.5))$$, '22023'::char(5), NULL::text, '[admin] rejects a fractional number of days');
insert into test_log(line) select * from extensions.throws_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb('ninety'::text))$$, '22023'::char(5), NULL::text, '[admin] rejects text instead of a number');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb(60))$$, '[admin] can set the limit to 60 days');
reset role;
insert into test_log(line) select * from extensions.is(public.platform_max_job_days(), 60, 'the setting replaces the default');

-- 2. Enforcement for an employer.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-0000000000a2',true);
insert into test_log(line) select * from extensions.lives_ok($$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status, application_deadline) values ('ex-ok','org-ex','0b0b0b0b-0000-4000-8000-0000000000a2','Expiry ex-ok','ex-ok','job','onsite','Montserrado','x','x','draft', now() + interval '50 days')$$, '[owner] can create a vacancy with a deadline inside the limit');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status, application_deadline) values ('ex-far','org-ex','0b0b0b0b-0000-4000-8000-0000000000a2','Expiry ex-far','ex-far','job','onsite','Montserrado','x','x','draft', now() + interval '100 days')$$, '22023'::char(5), NULL::text, '[owner] cannot create a vacancy with a deadline beyond the limit');
insert into test_log(line) select * from extensions.throws_ok($$update public.opportunities set application_deadline = now() + interval '100 days' where id = 'ex-ok'$$, '22023'::char(5), NULL::text, '[owner] cannot push an existing deadline beyond the limit');
insert into test_log(line) select * from extensions.lives_ok($$update public.opportunities set application_deadline = now() + interval '20 days' where id = 'ex-ok'$$, '[owner] can move a deadline to a date inside the limit');
-- Unrelated edits to a vacancy that predates the cap are never blocked.
insert into test_log(line) select * from extensions.lives_ok($$update public.opportunities set title = 'Renamed legacy vacancy' where id = 'ex-legacy'$$, '[owner] can edit an older vacancy whose deadline is beyond the limit');

-- 3. Moderators can quarantine and restore an older vacancy; the cap does not get in the way.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-0000000000a1',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_moderate_opportunity('ex-legacy','quarantined','Asks applicants to pay a fee')$$, '[admin] can quarantine the older vacancy');
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_moderate_opportunity('ex-legacy','published')$$, '[admin] can restore the older vacancy despite its far deadline');
reset role;
insert into test_log(line) select * from extensions.is((select status from public.opportunities where id='ex-legacy'), 'published', 'the restored vacancy is live again');

-- 4. Raising the limit takes effect immediately.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-0000000000a1',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.admin_set_platform_setting('max_job_days', to_jsonb(365))$$, '[admin] can raise the limit to 365 days');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0b0b0b0b-0000-4000-8000-0000000000a2',true);
insert into test_log(line) select * from extensions.lives_ok($$insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status, application_deadline) values ('ex-long','org-ex','0b0b0b0b-0000-4000-8000-0000000000a2','Expiry ex-long','ex-long','job','onsite','Montserrado','x','x','draft', now() + interval '300 days')$$, '[owner] can now use a 300-day deadline');
reset role;

select line from test_log order by seq;
rollback;
