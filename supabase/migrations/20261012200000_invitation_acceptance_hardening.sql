-- =====================================================================
-- F-23 (High): invitation acceptance bypassed the ownership rules, and
-- F-15 (Low): public.users.email was not kept in sync with auth.users.
--
-- 20261012160000 stops NEW owner/admin invitations from being created by
-- unauthorised people, but accept_organization_invitation() trusted every
-- already-stored pending invitation: a pending 'owner'/'admin' invitation
-- created earlier by an admin or by a member holding members.invite (or by
-- someone who has since been demoted or removed) was still honoured, so an
-- attacker controlling the invitee address could take over an organization.
-- The function also (a) reactivated a SUSPENDED member simply by accepting an
-- invitation (undoing an administrator's suspension), and (b) overwrote an
-- existing member's role, so an owner accepting a 'member' invitation was
-- demoted. Reproduced.
--
-- New acceptance rules (all checked at ACCEPT time, in the same transaction):
--   * the INVITER must still be an ACTIVE member with enough authority:
--       owner invitation  -> inviter is an owner
--       admin invitation  -> inviter is an owner or admin
--       other roles       -> inviter is owner/admin or holds members.invite / all
--     otherwise: 42501 "The inviter no longer has the authority ..."
--   * the accepting account's email must be VERIFIED (public.users.is_email_verified,
--     set by the auth sync trigger; auto-confirm projects set it at signup)
--     and must equal the invitee address (unchanged rule);
--   * an existing SUSPENDED membership is never reactivated by an invitation;
--   * an existing ACTIVE membership is only ever upgraded (owner > admin >
--     other), never downgraded;
--   * new memberships are created exactly as before.
-- Pending invitations are NOT modified or deleted; see docs/LAUNCH_AUDIT.md
-- for the review/cleanup procedure.
--
-- F-15: a trigger copies a changed auth.users.email to public.users.email
-- (GoTrue changes it only after the new address is confirmed), so invitation
-- matching follows the account's current confirmed address. The trigger never
-- fails the auth update (errors become warnings).
--
-- ROLLBACK: re-apply the function body from 20261012150000's injected version
-- (original in 20260909130000 + assert_account_active()); drop trigger
-- trg_sync_auth_user_email on auth.users and function public.sync_auth_user_email().
-- =====================================================================
create or replace function public.accept_organization_invitation(p_token character varying)
returns public.organization_memberships
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_inv public.organization_invitations;
  v_uid character varying;
  v_user_email character varying;
  v_user_verified boolean;
  v_membership public.organization_memberships;
  v_inviter_role text;
  v_inviter_perms jsonb;
  v_authorized boolean;
  v_new_role text;
  v_new_perms jsonb;
begin
  perform public.assert_account_active();
  v_uid := auth.uid()::character varying;
  if v_uid is null then
    raise exception 'Authentication required to accept an invitation.' using errcode = '28000';
  end if;

  select * into v_inv from public.organization_invitations where token = p_token;
  if not found then
    raise exception 'Invitation not found.' using errcode = '02000';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'This invitation has already been %.', v_inv.status using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    update public.organization_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'This organization invitation has expired.' using errcode = '22023';
  end if;

  select email, is_email_verified into v_user_email, v_user_verified from public.users where id = v_uid;
  if lower(coalesce(v_user_email, '')) <> lower(v_inv.invitee_email) then
    raise exception 'This organization invitation was issued to a different email address.' using errcode = '42501';
  end if;
  if not coalesce(v_user_verified, false) then
    raise exception 'Verify your email address before accepting an organization invitation.' using errcode = '42501';
  end if;

  -- The inviter must STILL hold the authority to grant this role.
  select m.org_role, m.permissions into v_inviter_role, v_inviter_perms
  from public.organization_memberships m
  where m.organization_id = v_inv.organization_id and m.user_id = v_inv.inviter_user_id and m.status = 'active';
  v_authorized := case
    when v_inviter_role is null then false
    when v_inv.org_role = 'owner' then v_inviter_role = 'owner'
    when v_inv.org_role = 'admin' then v_inviter_role in ('owner', 'admin')
    else v_inviter_role in ('owner', 'admin')
         or coalesce(v_inviter_perms, '[]'::jsonb) @> '["members.invite"]'::jsonb
         or coalesce(v_inviter_perms, '[]'::jsonb) @> '["all"]'::jsonb
  end;
  if not v_authorized then
    raise exception 'The inviter no longer has the authority to grant this role.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.organization_memberships
  where organization_id = v_inv.organization_id and user_id = v_uid;

  if found then
    if v_membership.status <> 'active' then
      raise exception 'Your membership in this organization is suspended; ask an administrator to reactivate it.' using errcode = '42501';
    end if;
    -- Existing active member: upgrade only, never downgrade.
    if v_inv.org_role = 'owner'
       or (v_inv.org_role = 'admin' and v_membership.org_role not in ('owner', 'admin')) then
      v_new_role := v_inv.org_role;
      v_new_perms := v_inv.permissions;
    else
      v_new_role := v_membership.org_role;
      v_new_perms := v_membership.permissions;
    end if;
    update public.organization_memberships
    set org_role = v_new_role, permissions = v_new_perms, updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
  else
    insert into public.organization_memberships (id, organization_id, user_id, org_role, status, permissions)
    values (
      'mem-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
      v_inv.organization_id, v_uid, v_inv.org_role, 'active', v_inv.permissions
    )
    returning * into v_membership;
  end if;

  update public.organization_invitations
  set status = 'accepted', responded_at = now()
  where id = v_inv.id;

  return v_membership;
end;
$$;
revoke all on function public.accept_organization_invitation(character varying) from public, anon;
grant execute on function public.accept_organization_invitation(character varying) to authenticated;

-- ---------------------------------------------------------------------
-- F-15: keep public.users.email in step with a confirmed auth.users email change
-- ---------------------------------------------------------------------
create or replace function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    begin
      update public.users
      set email = new.email,
          is_email_verified = (new.email_confirmed_at is not null)
      where id = new.id::varchar;
    exception when others then
      raise warning 'sync_auth_user_email: could not mirror email for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_auth_user_email on auth.users;
create trigger trg_sync_auth_user_email
  after update of email on auth.users
  for each row execute function public.sync_auth_user_email();
