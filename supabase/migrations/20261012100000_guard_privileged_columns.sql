-- =====================================================================
-- Guard privileged columns against direct client writes.
--
-- Defects (found in the pre-launch audit, see docs/LAUNCH_AUDIT.md):
--
--  F-09  public.users has an UPDATE policy "id = auth.uid()" with no
--        WITH CHECK and no column restriction, and `authenticated`
--        holds UPDATE on every column. Any signed-in user could
--        PATCH their own row with system_role / primary_role =
--        'platform_admin' (or flip account_status), and
--        public.is_platform_admin() -- which reads exactly those
--        columns -- would then authorise every admin-only RPC/policy.
--
--  F-10  public.organizations allows INSERT (WITH CHECK true) and
--        UPDATE by org admins on every column, so an org admin could
--        set verification_status = 'verified' / verification_badge
--        directly, bypassing the verification review workflow.
--
-- Fix: BEFORE triggers that reject changes to those columns when the
-- statement runs as a PostgREST client role (authenticated / anon).
-- The trusted SECURITY DEFINER RPCs (review_verification_request,
-- decide_verification_audit, apply/lift_account_restriction,
-- create_organization_with_owner, the auth.users sync trigger) run as
-- the function owner, so current_user is not a client role and they
-- are unaffected. service_role / postgres / migrations are likewise
-- unaffected. No existing data is modified.
--
-- ROLLBACK: drop trigger trg_guard_user_privileged_columns on
-- public.users; drop trigger trg_guard_org_verification_columns on
-- public.organizations; drop the two functions; and recreate the
-- "Users can update their own profile" policy without WITH CHECK.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. users: privileged columns are not client-writable
-- ---------------------------------------------------------------------
create or replace function public.guard_user_privileged_columns()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.system_role is distinct from old.system_role then
      raise exception 'system_role cannot be changed directly.'
        using errcode = '42501';
    end if;
    if new.account_status is distinct from old.account_status then
      raise exception 'account_status cannot be changed directly.'
        using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'id cannot be changed.' using errcode = '42501';
    end if;
    -- Other primary_role changes are left as-is (existing behaviour);
    -- only elevation to an admin role is blocked.
    if new.primary_role is distinct from old.primary_role
       and new.primary_role in ('platform_admin', 'verification_officer') then
      raise exception 'primary_role cannot be elevated directly.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_user_privileged_columns on public.users;
create trigger trg_guard_user_privileged_columns
  before update on public.users
  for each row execute function public.guard_user_privileged_columns();

-- Belt and braces: the row must still be the caller's own after update.
drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile" on public.users
  for update to authenticated
  using (id = auth.uid()::varchar)
  with check (id = auth.uid()::varchar);

-- ---------------------------------------------------------------------
-- 2. organizations: verification state is not client-writable
-- ---------------------------------------------------------------------
create or replace function public.guard_org_verification_columns()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(new.verification_status, 'unverified') <> 'unverified'
         or new.verification_badge is not null then
        raise exception 'New organizations must start unverified.'
          using errcode = '42501';
      end if;
    else
      if new.verification_status is distinct from old.verification_status
         or new.verification_badge is distinct from old.verification_badge
         or new.is_verified is distinct from old.is_verified then
        raise exception 'Verification state can only be changed through the verification review workflow.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Must fire BEFORE trg_sync_organization_verified_flag recomputes
-- is_verified (triggers fire alphabetically: "trg_guard..." < "trg_sync...").
drop trigger if exists trg_guard_org_verification_columns on public.organizations;
create trigger trg_guard_org_verification_columns
  before insert or update on public.organizations
  for each row execute function public.guard_org_verification_columns();
