-- =====================================================================
-- F-14 regression tests: organization ownership / role-grant boundaries
-- (migration 20261012160000_membership_ownership_guard.sql).
-- Everything runs inside begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- fixtures: owner O, admin A, plain members M1 (invite permission) and M2, outsider X
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status) values
  ('0e0e0e0e-0000-4000-8000-000000000001', 'own-o@example.com', 'Own O', '+231-770-300-001', 'employer',  'user', 'active'),
  ('0e0e0e0e-0000-4000-8000-000000000002', 'own-a@example.com', 'Own A', '+231-770-300-002', 'recruiter', 'user', 'active'),
  ('0e0e0e0e-0000-4000-8000-000000000003', 'own-m1@example.com','Own M1','+231-770-300-003', 'recruiter', 'user', 'active'),
  ('0e0e0e0e-0000-4000-8000-000000000004', 'own-m2@example.com','Own M2','+231-770-300-004', 'recruiter', 'user', 'active'),
  ('0e0e0e0e-0000-4000-8000-000000000005', 'own-x@example.com', 'Own X', '+231-770-300-005', 'job_seeker','user', 'active');
insert into public.organizations (id, slug, name, type, industry, county, city_district, description)
values ('org-own-1', 'org-own-1', 'Ownership Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'fixture');
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions) values
  ('mo', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000001', 'owner',  'active', '[]'::jsonb),
  ('ma', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'admin',  'active', '[]'::jsonb),
  ('m1', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000003', 'member', 'active', '["members.invite"]'::jsonb),
  ('m2', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000004', 'member', 'active', '[]'::jsonb);

-- ------------------------- ATTACKS by the ADMIN -------------------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set org_role = 'owner' where id = 'ma'$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot promote THEMSELVES to owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set org_role = 'owner' where id = 'm2'$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot promote another member to owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set status = 'suspended' where id = 'mo'$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot suspend the owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set org_role = 'member' where id = 'mo'$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot demote the owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$delete from public.organization_memberships where id = 'mo'$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot remove the owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organization_memberships (id, organization_id, user_id, org_role, status) values ('mx', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000005', 'owner', 'active')$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot add anyone as owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set user_id = '0e0e0e0e-0000-4000-8000-000000000005' where id = 'm2'$$, '42501'::char(5), NULL::text,
  '[memberships][admin] cannot re-point a membership row to a different user');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-own-o', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'evil@example.com', 'owner', 'tok-own-o', now() + interval '7 days')$$, '42501'::char(5), NULL::text,
  '[invitations][admin] cannot invite someone as owner');
reset role;
insert into test_log(line) select * from extensions.is(
  (select string_agg(id || ':' || org_role || ':' || status, ',' order by id) from public.organization_memberships where organization_id = 'org-own-1'),
  'm1:member:active,m2:member:active,ma:admin:active,mo:owner:active',
  '[memberships] after all admin attacks the membership table is unchanged');

-- ----------------- LEGITIMATE admin administration -----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organization_memberships set org_role = 'admin', permissions = '["all"]'::jsonb where id = 'm2'$$,
  '[memberships][admin] CAN promote a member to admin and set permissions');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organization_memberships set org_role = 'member', permissions = '[]'::jsonb where id = 'm2'$$,
  '[memberships][admin] CAN demote another admin/member to member');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organization_memberships set status = 'suspended' where id = 'm2'$$,
  '[memberships][admin] CAN suspend a plain member');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organization_memberships set status = 'active' where id = 'm2'$$,
  '[memberships][admin] CAN reactivate a plain member');
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-own-a', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'newadmin@example.com', 'admin', 'tok-own-a', now() + interval '7 days')$$,
  '[invitations][admin] CAN invite an admin');
insert into test_log(line) select * from extensions.lives_ok(
  $$delete from public.organization_memberships where id = 'm2'$$,
  '[memberships][admin] CAN remove a plain member');
reset role;

-- ----------------- member with members.invite -----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-own-m1a', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000003', 'sneaky-admin@example.com', 'admin', 'tok-own-m1a', now() + interval '7 days')$$, '42501'::char(5), NULL::text,
  '[invitations][plain member with members.invite] cannot invite an admin');
insert into test_log(line) select * from extensions.throws_ok(
  $$insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-own-m1o', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000003', 'sneaky-owner@example.com', 'owner', 'tok-own-m1o', now() + interval '7 days')$$, '42501'::char(5), NULL::text,
  '[invitations][plain member with members.invite] cannot invite an owner');
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-own-m1m', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000003', 'colleague@example.com', 'member', 'tok-own-m1m', now() + interval '7 days')$$,
  '[invitations][plain member with members.invite] CAN still invite a normal member');
reset role;

-- ----------------- OWNER operations -----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.lives_ok(
  $$insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-own-oo', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000001', 'coowner@example.com', 'owner', 'tok-own-oo', now() + interval '7 days')$$,
  '[invitations][owner] CAN invite a co-owner');
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set status = 'suspended' where id = 'mo'$$, '23514'::char(5), NULL::text,
  '[memberships][sole owner] cannot suspend themselves (last-owner invariant)');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organization_memberships set org_role = 'owner' where id = 'ma'$$,
  '[memberships][owner] CAN promote an admin to owner (explicit ownership grant)');
insert into test_log(line) select * from extensions.lives_ok(
  $$update public.organization_memberships set org_role = 'admin' where id = 'mo'$$,
  '[memberships][owner] CAN hand over ownership: demote self once another owner exists');
reset role;
-- the former admin is now the owner and the former owner an admin
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$update public.organization_memberships set org_role = 'owner' where id = 'mo'$$, '42501'::char(5), NULL::text,
  '[memberships][former owner, now admin] can no longer re-grant themselves ownership');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.throws_ok(
  $$delete from public.organization_memberships where id = 'ma'$$, '23514'::char(5), NULL::text,
  '[memberships][sole (new) owner] cannot remove themselves (last-owner invariant)');
reset role;

-- ----------------- trusted definer paths unaffected -----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.is(
  (select org_role from public.organization_memberships where organization_id = 'org-own-new' and user_id = '0e0e0e0e-0000-4000-8000-000000000005'), NULL,
  '[memberships] (control) outsider has no membership in a not-yet-created org');
insert into test_log(line) select * from extensions.lives_ok(
  $$select public.create_organization_with_owner('org-own-new', 'org-own-new', 'New Org', 'private_company', 'services', 'Montserrado', 'Monrovia', 'd', null, null, null, null, null)$$,
  '[memberships][RPC] create_organization_with_owner still makes the caller the owner');
insert into test_log(line) select * from extensions.is(
  (select org_role from public.organization_memberships where organization_id = 'org-own-new' and user_id = '0e0e0e0e-0000-4000-8000-000000000005'), 'owner',
  '[memberships][RPC] ...and the caller really is the owner of the new org');
reset role;
-- an owner-issued owner invitation is honoured by the trusted accept path
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
values ('0e0e0e0e-0000-4000-8000-000000000006', 'coowner@example.com', 'Co Owner', '+231-770-300-006', 'employer', 'user', 'active');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.is(
  (select org_role from public.accept_organization_invitation('tok-own-oo')), 'owner',
  '[invitations][RPC] invitee can accept an owner invitation issued by an owner');
reset role;

select line from test_log order by seq;
rollback;
