-- =====================================================================
-- F-14 (High): an organization ADMIN could take over an organization.
--
-- The policy "Org admins can manage memberships" is FOR ALL with
-- is_org_admin() = role in (admin, owner), and the only trigger
-- (enforce_owner_invariant) merely keeps >= 1 active owner. So an admin
-- could (1) promote themselves to owner, then (2) suspend/demote/delete the
-- real owner (the invariant is satisfied because the admin is now an owner).
-- Reproduced on the schema produced by migrations up to ...150000. The same
-- hole existed through invitations: anyone with members.invite could create an
-- invitation with org_role = 'owner' (or 'admin') for an address they control.
--
-- Policy implemented (default secure model; no document specifies another):
--   * Only an ACTIVE OWNER may grant the owner role (INSERT or UPDATE), and
--     only an active owner may modify (role / status / permissions) or delete
--     an owner's membership row. Admins keep full administration of
--     non-owner members (promote to admin, permissions, suspend, remove).
--   * Ownership transfer is therefore an explicit act of an existing owner:
--     the owner promotes the new owner, then (optionally) demotes themselves;
--     enforce_owner_invariant keeps at least one active owner at all times.
--   * Invitations: only an owner may invite someone as 'owner'; only an
--     owner/admin may invite someone as 'admin'.
--   * user_id of an existing membership row cannot be re-pointed by clients.
-- Applies to client roles (authenticated/anon) only. SECURITY DEFINER code
-- (create_organization_with_owner, accept_organization_invitation, ...) and
-- service_role are unaffected. Existing rows are NOT modified; review pending
-- owner/admin invitations created before this migration (see
-- docs/LAUNCH_AUDIT.md for the query).
--
-- ROLLBACK: drop trigger trg_00_guard_membership_ownership on
-- public.organization_memberships; drop trigger trg_00_guard_invitation_roles
-- on public.organization_invitations; drop both guard functions and
-- public.is_org_owner(varchar).
-- =====================================================================

create or replace function public.is_org_owner(org_id varchar)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = org_id
      and user_id = auth.uid()::varchar
      and org_role = 'owner'
      and status = 'active'
  );
$$;
revoke all on function public.is_org_owner(varchar) from public, anon;
grant execute on function public.is_org_owner(varchar) to authenticated;

create or replace function public.guard_membership_ownership()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.org_role = 'owner' and not public.is_org_owner(new.organization_id) then
      raise exception 'Only an organization owner can grant the owner role.' using errcode = '42501';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A membership cannot be reassigned to a different user.' using errcode = '42501';
    end if;
    if new.org_role = 'owner' and old.org_role is distinct from 'owner'
       and not public.is_org_owner(old.organization_id) then
      raise exception 'Only an organization owner can grant the owner role.' using errcode = '42501';
    end if;
    if old.org_role = 'owner'
       and (new.org_role is distinct from old.org_role
            or new.status is distinct from old.status
            or new.permissions is distinct from old.permissions)
       and not public.is_org_owner(old.organization_id) then
      raise exception 'Only an organization owner can change or suspend an owner.' using errcode = '42501';
    end if;
    return new;
  else -- DELETE
    if old.org_role = 'owner' and not public.is_org_owner(old.organization_id) then
      raise exception 'Only an organization owner can remove an owner.' using errcode = '42501';
    end if;
    return old;
  end if;
end;
$$;

-- "00" so this fires before enforce_owner_invariant: unauthorized attempts always
-- report 42501 rather than the invariant's 23514.
drop trigger if exists trg_00_guard_membership_ownership on public.organization_memberships;
create trigger trg_00_guard_membership_ownership
  before insert or update or delete on public.organization_memberships
  for each row execute function public.guard_membership_ownership();

create or replace function public.guard_invitation_roles()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' or new.org_role is distinct from old.org_role then
    if new.org_role = 'owner' and not public.is_org_owner(new.organization_id) then
      raise exception 'Only an organization owner can invite someone as owner.' using errcode = '42501';
    end if;
    if new.org_role = 'admin' and not public.is_org_admin(new.organization_id) then
      raise exception 'Only an organization admin or owner can invite someone as admin.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_00_guard_invitation_roles on public.organization_invitations;
create trigger trg_00_guard_invitation_roles
  before insert or update on public.organization_invitations
  for each row execute function public.guard_invitation_roles();
