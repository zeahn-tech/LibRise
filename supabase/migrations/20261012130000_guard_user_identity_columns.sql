-- =====================================================================
-- F-13 (P0): invitation takeover via self-editable users.email.
--
-- accept_organization_invitation() and the invitation RLS policies
-- ("Invitees can view invitations addressed to their email") identify the
-- invitee by public.users.email. Migration 20261012100000 guarded the role
-- columns but left email (and the *_verified flags) writable through the
-- self-UPDATE policy, so any signed-in user could:
--   1. UPDATE public.users SET email = '<invitee address>' on their own row,
--   2. read the pending invitation (including its secret token) through the
--      invitee SELECT policy, and
--   3. call accept_organization_invitation(token) and join the organization
--      with the invited role (including 'admin').
-- Reproduced on the schema produced by migrations up to ...120000.
--
-- Fix: extend the same guard so a client role (authenticated/anon) cannot
-- change email, is_email_verified or is_phone_verified. The application never
-- writes these columns from the client (only reads public.users); trusted
-- SECURITY DEFINER code (auth sync triggers) is unaffected because
-- current_user is the function owner there.
--
-- This is a NEW migration (CREATE OR REPLACE) rather than an edit of
-- 20261012100000 so it is correct whether or not that file was already applied.
--
-- ROLLBACK: re-apply the function body from 20261012100000_guard_privileged_columns.sql.
-- =====================================================================
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
    -- Identity / verification columns: email is the key organization
    -- invitations are matched on, and the *_verified flags are set only by
    -- the auth sync triggers.
    if new.email is distinct from old.email then
      raise exception 'email cannot be changed directly.'
        using errcode = '42501';
    end if;
    if new.is_email_verified is distinct from old.is_email_verified
       or new.is_phone_verified is distinct from old.is_phone_verified then
      raise exception 'Verification flags cannot be changed directly.'
        using errcode = '42501';
    end if;
    -- Other primary_role changes are left as-is (self-selectable roles grant no
    -- database authority); only elevation to an admin role is blocked.
    if new.primary_role is distinct from old.primary_role
       and new.primary_role in ('platform_admin', 'verification_officer') then
      raise exception 'primary_role cannot be elevated directly.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
