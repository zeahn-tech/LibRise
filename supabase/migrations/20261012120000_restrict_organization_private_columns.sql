-- =====================================================================
-- F-08 (P1): organization private data was publicly readable.
--
-- "Allow public read access to verified organizations" is
-- `FOR SELECT USING (true)` and anon/authenticated hold table-wide SELECT,
-- so ANY visitor could read tax_id_number, registration_number,
-- contact_email, contact_phone and settings (which includes
-- candidateAlertEmail) of EVERY organization, verified or not.
--
-- Fix (column-level, no data moved):
--   * revoke table-level SELECT on organizations from anon/authenticated
--   * grant SELECT only on the public profile columns
--   * private columns are read through get_organization_private_fields(),
--     a SECURITY DEFINER RPC restricted to ACTIVE members of the org and
--     platform admins (so removed members lose access immediately)
-- Any column added to organizations in future is private by default.
-- Trusted SECURITY DEFINER code (verification review, analytics) is
-- unaffected. Writes are unaffected (UPDATE grant/RLS unchanged).
--
-- Client contract: `select('*')` / embedded `organizations(*)` is now
-- rejected; use ORG_PUBLIC_COLUMNS (src/services/orgColumns.ts) and keep
-- it in sync with the GRANT below.
--
-- ROLLBACK: grant select on public.organizations to anon, authenticated;
-- drop function public.get_organization_private_fields(varchar[]);
-- =====================================================================
revoke select on public.organizations from anon, authenticated;

grant select (
  id, slug, name, type, industry, county, city_district, website_url,
  logo_url, cover_image_url, description, employee_count_range,
  verification_status, verification_badge, created_at, updated_at,
  is_verified, website, logo_text, address, established_year
) on public.organizations to anon, authenticated;

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
