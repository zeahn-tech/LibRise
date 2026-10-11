-- =====================================================================
-- Tighten get_organization_private_fields(): a platform-suspended or
-- deactivated ACCOUNT must not read private organization data even if its
-- organization membership row is still 'active'. apply_account_restriction()
-- full_suspension only sets users.account_status; it does not touch
-- memberships, so the RPC has to check the account status itself.
-- (Table-level RLS elsewhere does not yet consider account_status -- that is
-- the pre-existing documented gap, outside this change.)
--
-- CREATE OR REPLACE with an identical signature: grants are preserved, and
-- they are re-asserted below for safety. Safe whether or not 20261012120000
-- was already applied.
--
-- ROLLBACK: re-apply the function body from
-- 20261012120000_restrict_organization_private_columns.sql.
-- =====================================================================
create or replace function public.get_organization_private_fields(p_org_ids varchar[])
returns table (
  id varchar,
  settings jsonb,
  registration_number varchar,
  tax_id_number varchar,
  contact_email varchar,
  contact_phone varchar
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select o.id, o.settings, o.registration_number, o.tax_id_number,
         o.contact_email, o.contact_phone
  from public.organizations o
  where o.id = any (p_org_ids)
    and auth.uid() is not null
    and not exists (
      select 1 from public.users u
      where u.id = auth.uid()::varchar
        and u.account_status in ('suspended', 'deactivated')
    )
    and (
      public.is_platform_admin(auth.uid()::varchar)
      or exists (
        select 1 from public.organization_memberships m
        where m.organization_id = o.id
          and m.user_id = auth.uid()::varchar
          and m.status = 'active'
      )
    );
$$;

revoke all on function public.get_organization_private_fields(varchar[]) from public, anon;
grant execute on function public.get_organization_private_fields(varchar[]) to authenticated;
