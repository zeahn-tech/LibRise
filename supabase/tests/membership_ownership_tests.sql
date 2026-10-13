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
-- =====================================================================
-- Invitation acceptance (F-23): the inviter's authority is re-checked at ACCEPT time
-- At this point: A (user 02) is the sole owner; O (user 01) was demoted to admin.
-- =====================================================================
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status, is_email_verified) values
  ('0e0e0e0e-0000-4000-8000-000000000006', 'coowner@example.com',  'Co Owner',   '+231-770-300-006', 'employer', 'user', 'active', true),
  ('0e0e0e0e-0000-4000-8000-000000000007', 'legacy-x@example.com', 'Legacy X',   '+231-770-300-007', 'employer', 'user', 'active', true),
  ('0e0e0e0e-0000-4000-8000-000000000008', 'unverified@example.com','Unverified','+231-770-300-008', 'employer', 'user', 'active', false),
  ('0e0e0e0e-0000-4000-8000-000000000009', 'suspmember@example.com','SuspMember','+231-770-300-009', 'recruiter','user', 'active', true);
update public.users set is_email_verified = true where id in ('0e0e0e0e-0000-4000-8000-000000000001','0e0e0e0e-0000-4000-8000-000000000002','0e0e0e0e-0000-4000-8000-000000000005');
-- legacy / stale pending invitations, inserted as a trusted role (simulating rows that pre-date the guard)
insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values
  ('inv-leg-own-by-admin',  'org-own-1', '0e0e0e0e-0000-4000-8000-000000000001', 'legacy-x@example.com', 'owner', 'tok-leg-own',  now() + interval '7 days'),   -- inviter O is only an admin now
  ('inv-leg-adm-by-member', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000003', 'unverified@example.com','admin', 'tok-leg-adm',  now() + interval '7 days'),   -- inviter M1 is a plain member
  ('inv-leg-gone-inviter',  'org-own-1', '0e0e0e0e-0000-4000-8000-000000000004', 'coowner@example.com',   'member','tok-leg-gone', now() + interval '7 days'),   -- inviter M2 was removed (no membership)
  ('inv-ok-owner',          'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'coowner@example.com',   'owner', 'tok-ok-owner', now() + interval '7 days'),   -- issued by the real owner A
  ('inv-ok-admin',          'org-own-1', '0e0e0e0e-0000-4000-8000-000000000001', 'unverified@example.com','admin', 'tok-ok-admin', now() + interval '7 days'),   -- issued by admin O: fine for admin
  ('inv-susp',              'org-own-1', '0e0e0e0e-0000-4000-8000-000000000001', 'suspmember@example.com', 'member','tok-susp',     now() + interval '7 days'),
  ('inv-owner-lower',       'org-own-1', '0e0e0e0e-0000-4000-8000-000000000001', 'own-a@example.com',     'member','tok-lower',    now() + interval '7 days');   -- invitation to the current OWNER's own address
insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions)
values ('m-susp', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000009', 'member', 'suspended', '[]'::jsonb);
delete from public.organization_memberships where id = 'm2';

select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000007',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-leg-own')$$, '42501'::char(5), NULL::text,
  '[F-23][pre-existing owner invitation whose inviter is no longer an owner] cannot be accepted (account takeover blocked)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-leg-adm')$$, '42501'::char(5), NULL::text,
  '[F-23][admin invitation issued by a plain member] cannot be accepted');
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-ok-admin')$$, '42501'::char(5), NULL::text,
  '[F-23][valid invitation, UNVERIFIED email] cannot be accepted until the email is verified');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000006',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-leg-gone')$$, '42501'::char(5), NULL::text,
  '[F-23][invitation whose inviter was removed from the organization] cannot be accepted');
insert into test_log(line) select * from extensions.is((select org_role from public.accept_organization_invitation('tok-ok-owner')), 'owner',
  '[F-23][owner invitation issued by the CURRENT owner] is accepted (authorised ownership transfer still works)');
reset role;
update public.users set is_email_verified = true where id = '0e0e0e0e-0000-4000-8000-000000000008';
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000008',true);
insert into test_log(line) select * from extensions.is((select org_role from public.accept_organization_invitation('tok-ok-admin')), 'admin',
  '[F-23][admin invitation from an admin, verified email] is accepted (legitimate admin onboarding)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000009',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-susp')$$, '42501'::char(5), NULL::text,
  '[F-23][suspended member] cannot reactivate themselves by accepting an invitation');
reset role;
insert into test_log(line) select * from extensions.is((select status from public.organization_memberships where id = 'm-susp'), 'suspended',
  '[F-23] ...and the membership is still suspended');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.is((select org_role from public.accept_organization_invitation('tok-lower')), 'owner',
  '[F-23][existing owner accepts a lower-role invitation] is NOT demoted');
reset role;
-- another user cannot use someone else's token (email binding)
insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values ('inv-bound', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'bound@example.com', 'member', 'tok-bound', now() + interval '7 days');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-bound')$$, '42501'::char(5), NULL::text,
  '[F-23][token holder with a different email] cannot accept (invitation bound to the intended recipient)');
reset role;

-- =====================================================================
-- F-15: confirmed auth email changes are mirrored; invitations follow the current address
-- =====================================================================
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at)
values ('0e0e0e0e-0000-4000-8000-0000000000c1', 'before@example.com', '{"primaryRole":"recruiter"}'::jsonb, now(), now());
insert into test_log(line) select * from extensions.is((select email from public.users where id = '0e0e0e0e-0000-4000-8000-0000000000c1'), 'before@example.com', '[F-15] (setup) signup created the profile row with the signup email');
update auth.users set email = 'after@example.com' where id = '0e0e0e0e-0000-4000-8000-0000000000c1';
insert into test_log(line) select * from extensions.is((select email from public.users where id = '0e0e0e0e-0000-4000-8000-0000000000c1'), 'after@example.com', '[F-15] a confirmed auth email change is mirrored to public.users.email');
insert into public.organization_invitations (id, organization_id, inviter_user_id, invitee_email, org_role, token, expires_at) values
  ('inv-old-email', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'before@example.com', 'member', 'tok-old-email', now() + interval '7 days'),
  ('inv-new-email', 'org-own-1', '0e0e0e0e-0000-4000-8000-000000000002', 'after@example.com',  'member', 'tok-new-email', now() + interval '7 days');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-0000000000c1',true);
insert into test_log(line) select * from extensions.throws_ok($$select public.accept_organization_invitation('tok-old-email')$$, '42501'::char(5), NULL::text, '[F-15] an invitation to the address the account NO LONGER owns cannot be accepted');
insert into test_log(line) select * from extensions.is((select org_role from public.accept_organization_invitation('tok-new-email')), 'member', '[F-15] an invitation to the current address can be accepted');
reset role;

-- initial-owner creation is unaffected (definer path)
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0e0e0e0e-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.is(
  (select org_role from public.organization_memberships where organization_id = 'org-own-new' and user_id = '0e0e0e0e-0000-4000-8000-000000000005'), 'owner',
  '[memberships][RPC] (re-check) the creator of a new organization is its owner');
reset role;

select line from test_log order by seq;
rollback;
