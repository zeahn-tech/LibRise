/**
 * Columns of public.organizations that any visitor (anon or signed-in) may
 * read. The remaining columns -- settings, registration_number,
 * tax_id_number, contact_email, contact_phone -- are private: column-level
 * SELECT is revoked from anon/authenticated (migration
 * 20261012120000_restrict_organization_private_columns.sql), so
 * `select('*')` on organizations (or an embedded `organizations(*)`) is
 * rejected by Postgres. Members and platform admins read the private
 * columns through the get_organization_private_fields RPC.
 *
 * Keep in sync with the GRANT in that migration.
 */
export const ORG_PUBLIC_COLUMNS =
  'id,slug,name,type,industry,county,city_district,website_url,logo_url,cover_image_url,description,employee_count_range,verification_status,verification_badge,created_at,updated_at,is_verified,website,logo_text,address,established_year' as const;

export interface OrganizationPrivateRow {
  id: string;
  settings: Record<string, unknown> | null;
  registration_number: string | null;
  tax_id_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}
