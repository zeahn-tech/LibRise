-- Account deletion (20261031100000_account_deletion.sql): blockers, what is removed, what is kept, lock-out afterwards.
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values
 ('0d0d0d0d-0000-4000-8000-000000000001','ad-del@example.com','AD Del','+231-770-700-001','job_seeker','user','active',true),
 ('0d0d0d0d-0000-4000-8000-000000000002','ad-owner@example.com','AD Owner','+231-770-700-002','employer','user','active',true),
 ('0d0d0d0d-0000-4000-8000-000000000003','ad-member@example.com','AD Member','+231-770-700-003','recruiter','user','active',true),
 ('0d0d0d0d-0000-4000-8000-000000000004','ad-solo@example.com','AD Solo','+231-770-700-004','employer','user','active',true),
 ('0d0d0d0d-0000-4000-8000-000000000005','ad-admin@example.com','AD Admin','+231-770-700-005','platform_admin','platform_admin','active',true);
insert into public.organizations (id, slug, name, type, industry, county, city_district, description) values
 ('org-ad-team','org-ad-team','AD Team Org','private_company','services','Montserrado','Monrovia','fixture'),
 ('org-ad-solo','org-ad-solo','AD Solo Org','private_company','services','Montserrado','Monrovia','fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions) values
 ('ad-m1','org-ad-team','0d0d0d0d-0000-4000-8000-000000000002','owner','active','[]'::jsonb),
 ('ad-m2','org-ad-team','0d0d0d0d-0000-4000-8000-000000000003','admin','active','[]'::jsonb),
 ('ad-m3','org-ad-solo','0d0d0d0d-0000-4000-8000-000000000004','owner','active','[]'::jsonb);
insert into public.opportunities (id, organization_id, created_by_user_id, title, slug, opportunity_type, workplace_model, county, location_details, description, status) values
 ('opp-ad-team','org-ad-team','0d0d0d0d-0000-4000-8000-000000000002','AD Team Vacancy','ad-team-vacancy','job','onsite','Montserrado','x','x','published'),
 ('opp-ad-solo','org-ad-solo','0d0d0d0d-0000-4000-8000-000000000004','AD Solo Vacancy','ad-solo-vacancy','job','onsite','Montserrado','x','x','published');
insert into public.applications (id, opportunity_id, applicant_user_id, organization_id, applicant_full_name, applicant_email, stage, documents) values
 ('app-ad-1','opp-ad-team','0d0d0d0d-0000-4000-8000-000000000001','org-ad-team','AD Del','ad-del@example.com','submitted','[{"id":"d1","path":"0d0d0d0d-0000-4000-8000-000000000001/app-ad-1/cv.pdf"}]'::jsonb);
insert into public.candidate_profiles (user_id, headline, cv_raw_text, cv_file_url, cv_data_json, privacy_settings) values
 ('0d0d0d0d-0000-4000-8000-000000000001','AD headline','cv text',null,'{}'::jsonb,'{}'::jsonb);
insert into public.notifications (id, recipient_user_id, category, title, message) values
 ('ntf-ad-1','0d0d0d0d-0000-4000-8000-000000000001','system_alert','hello','fixture');

-- 1. Nobody can run these without signing in.
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.account_deletion_blockers()$$, '42501'::char(5), NULL::text, '[anon] cannot call account_deletion_blockers()');
insert into test_log(line) select * from extensions.throws_ok($$select public.account_deletion_storage_paths()$$, '42501'::char(5), NULL::text, '[anon] cannot call account_deletion_storage_paths()');
insert into test_log(line) select * from extensions.throws_ok($$select public.delete_my_account()$$, '42501'::char(5), NULL::text, '[anon] cannot call delete_my_account()');
reset role;

-- 2. A person with nothing in the way: no blockers, and the exact files to remove are reported.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.is((select public.account_deletion_blockers()), '[]'::jsonb, '[person] has no blockers');
insert into test_log(line) select * from extensions.is((select public.account_deletion_storage_paths() -> 'applicationDocuments'), '["0d0d0d0d-0000-4000-8000-000000000001/app-ad-1/cv.pdf"]'::jsonb, 'the application document path is reported for removal');
reset role;

-- 3. Blockers.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.is((select public.account_deletion_blockers() -> 0 ->> 'code')::text, 'organization_owner'::text, '[only owner of a team with members] is blocked');
insert into test_log(line) select * from extensions.throws_ok($$select public.delete_my_account()$$, '22023'::char(5), NULL::text, '[only owner of a team with members] cannot delete yet');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.is((select public.account_deletion_blockers() -> 0 ->> 'code')::text, 'last_platform_admin'::text, '[only platform administrator] is blocked');
insert into test_log(line) select * from extensions.throws_ok($$select public.delete_my_account()$$, '22023'::char(5), NULL::text, '[only platform administrator] cannot delete');
reset role;
insert into test_log(line) select * from extensions.is((select count(*) from public.users where id in ('0d0d0d0d-0000-4000-8000-000000000002','0d0d0d0d-0000-4000-8000-000000000005') and account_status = 'active'), 2::bigint, 'blocked people are untouched');

-- 4. Deleting: personal data removed, account anonymised and locked, records others rely on kept.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.delete_my_account()$$, '[person] can delete their account');
reset role;
insert into test_log(line) select * from extensions.is((select count(*) from public.candidate_profiles where user_id = '0d0d0d0d-0000-4000-8000-000000000001'), 0::bigint, 'the profile and CV are gone');
insert into test_log(line) select * from extensions.is((select count(*) from public.applications where applicant_user_id = '0d0d0d0d-0000-4000-8000-000000000001'), 0::bigint, 'the applications are gone');
insert into test_log(line) select * from extensions.is((select count(*) from public.notifications where recipient_user_id = '0d0d0d0d-0000-4000-8000-000000000001'), 0::bigint, 'the notifications are gone');
insert into test_log(line) select * from extensions.is((select full_name || '|' || (email like 'deleted-%@deleted.invalid')::text || '|' || coalesce(phone_number,'none') || '|' || account_status || '|' || (deleted_at is not null)::text from public.users where id = '0d0d0d0d-0000-4000-8000-000000000001')::text, 'Deleted user|true|none|deactivated|true'::text, 'the account is anonymised, deactivated and marked deleted (row kept for references)');
insert into test_log(line) select * from extensions.ok(exists(select 1 from public.audit_logs where action = 'account.deleted' and resource_id = '0d0d0d0d-0000-4000-8000-000000000001'), 'deletion is recorded in the audit trail');
insert into test_log(line) select * from extensions.is((select count(*) from public.audit_logs where action = 'account.deleted' and details::text like '%@%'), 0::bigint, 'the audit entry holds no personal data');

-- 5. The deleted account is locked out immediately.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.account_deletion_blockers()$$, '42501'::char(5), NULL::text, '[deleted account] can no longer use the database');
insert into test_log(line) select * from extensions.throws_ok($$select public.delete_my_account()$$, '42501'::char(5), NULL::text, '[deleted account] cannot delete twice');
reset role;

-- 6. A sole member leaves: the organization stays, its vacancies stop being listed, the membership is removed.
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.delete_my_account()$$, '[sole owner of a one-person organization] can delete');
reset role;
insert into test_log(line) select * from extensions.is((select status from public.opportunities where id = 'opp-ad-solo')::text, 'closed'::text, 'the vacancy of the orphaned organization is closed');
insert into test_log(line) select * from extensions.is((select count(*) from public.organizations where id = 'org-ad-solo'), 1::bigint, 'the organization itself is kept');
insert into test_log(line) select * from extensions.is((select count(*) from public.organization_memberships where user_id = '0d0d0d0d-0000-4000-8000-000000000004'), 1::bigint, 'the last owner row is kept so the organization still has an owner (the closed account)');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.lives_ok($$select public.delete_my_account()$$, '[non-owner team member] can delete');
reset role;
insert into test_log(line) select * from extensions.is((select count(*) from public.organization_memberships where user_id = '0d0d0d0d-0000-4000-8000-000000000003'), 0::bigint, 'a non-owner membership is removed');
insert into test_log(line) select * from extensions.is((select count(*) from public.organization_memberships where organization_id = 'org-ad-team' and user_id = '0d0d0d0d-0000-4000-8000-000000000002'), 1::bigint, 'the rest of the team is untouched');
insert into test_log(line) select * from extensions.is((select status from public.opportunities where id = 'opp-ad-team')::text, 'published'::text, 'vacancies of other organizations are untouched');

-- 7. Two administrators: the first may delete once another remains.
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values ('0d0d0d0d-0000-4000-8000-000000000006','ad-admin2@example.com','AD Admin2','+231-770-700-006','platform_admin','platform_admin','active',true);
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0d0d0d0d-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.is((select public.account_deletion_blockers()), '[]'::jsonb, '[administrator with a colleague] has no blockers');
reset role;

select line from test_log order by seq;
rollback;
