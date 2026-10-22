-- =====================================================================
-- Platform-admin dashboard backend (ONE migration -- run it once).
--
-- The admin dashboard (TrustSafetyAdminCenter) read users, organizations, job opportunities,
-- business listings, the audit trail and anomalies from the browser's local demo store, which is
-- empty in production. This adds the server side those tabs need:
--
--   * admin_list_users / admin_set_user_system_role      -- User Roles & Management tab
--   * revoke_organization_verification                   -- Organizations tab (Revoke Badges)
--   * admin_list_opportunities / admin_moderate_opportunity -- Job Moderation tab
--   * admin_list_business_listings / admin_moderate_business -- Business Listings tab
--   * admin_list_audit_logs                              -- Audit Log Trail tab
--
-- Every function is SECURITY DEFINER, refuses anyone who is not a platform admin
-- (public.is_platform_admin(auth.uid())), writes an audit_logs row for each change, and is callable
-- only by `authenticated`. Suspending/reactivating accounts keeps using the existing
-- apply_account_restriction / lift_account_restriction RPCs (they also enforce the Auth ban).
-- Anomalies are read directly: "Platform admins can view suspicious activity" already exists.
--
-- Also: public business-listing visibility now honours moderation_status, so a suspended/rejected
-- listing actually disappears from the marketplace (previously only `status` was checked).
--
-- This file includes revoke_organization_verification from 20261022100000; if you already ran that
-- one, re-running this is harmless (everything is create-or-replace / idempotent).
-- =====================================================================

-- Internal guard (not callable by clients).
create or replace function public.assert_platform_admin()
returns character varying
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying := auth.uid()::character varying;
begin
  if v_uid is null or not public.is_platform_admin(v_uid) then
    raise exception 'Only platform administrators may perform this action.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function public.assert_platform_admin() from public, anon, authenticated;

create or replace function public.admin_write_audit(
  p_actor character varying, p_action character varying, p_resource_type character varying,
  p_resource_id character varying, p_details jsonb, p_org character varying default null
) returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.audit_logs (id, user_id, organization_id, action, resource_type, resource_id, details)
  values ('auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          p_actor, p_org, p_action, p_resource_type, p_resource_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function public.admin_write_audit(character varying, character varying, character varying, character varying, jsonb, character varying) from public, anon, authenticated;

-- 1. Users ------------------------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id character varying, email character varying, full_name character varying, phone_number character varying,
  primary_role character varying, system_role character varying, account_status character varying,
  avatar_url character varying, primary_county character varying,
  is_email_verified boolean, is_phone_verified boolean,
  created_at timestamp with time zone, last_login_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.assert_platform_admin();
  return query
    select u.id, u.email, u.full_name, u.phone_number, u.primary_role, u.system_role, u.account_status,
           u.avatar_url, u.primary_county, u.is_email_verified, u.is_phone_verified, u.created_at, u.last_login_at
    from public.users u
    order by u.created_at desc nulls last
    limit 5000;
end;
$$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_set_user_system_role(p_user_id character varying, p_role character varying)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
  v_old character varying;
begin
  v_uid := public.assert_platform_admin();
  if p_role not in ('user','platform_admin','verification_officer','moderation_officer','verifier','moderator','finance_admin') then
    raise exception 'Unknown role %.', p_role using errcode = '22023';
  end if;
  if p_user_id = v_uid and p_role <> 'platform_admin' then
    raise exception 'You cannot remove your own platform administrator role.' using errcode = '42501';
  end if;
  select system_role into v_old from public.users where id = p_user_id;
  if not found then
    raise exception 'User % not found.', p_user_id using errcode = '02000';
  end if;
  update public.users set system_role = p_role where id = p_user_id;
  perform public.admin_write_audit(v_uid, 'user.role_change', 'user', p_user_id,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;
revoke all on function public.admin_set_user_system_role(character varying, character varying) from public, anon;
grant execute on function public.admin_set_user_system_role(character varying, character varying) to authenticated;

-- 2. Organizations: revoke verification ------------------------------------------------------------------
create or replace function public.revoke_organization_verification(
  p_organization_id character varying,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
begin
  v_uid := public.assert_platform_admin();

  update public.organizations
     set verification_status = 'unverified',
         verification_badge = null
   where id = p_organization_id;
  if not found then
    raise exception 'Organization % not found.', p_organization_id using errcode = '02000';
  end if;

  update public.verification_requests
     set status = 'suspended', reviewer_user_id = v_uid,
         reviewer_notes = coalesce(p_reason, reviewer_notes), updated_at = now()
   where entity_type = 'organization' and entity_id = p_organization_id and status = 'verified';

  perform public.admin_write_audit(v_uid, 'organization.verification_revoked', 'organization',
    p_organization_id, jsonb_build_object('reason', p_reason), p_organization_id);
end;
$$;
revoke all on function public.revoke_organization_verification(character varying, text) from public, anon;
grant execute on function public.revoke_organization_verification(character varying, text) to authenticated;

-- 3. Job opportunities ---------------------------------------------------------------------------------------
create or replace function public.admin_list_opportunities()
returns setof public.opportunities
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.assert_platform_admin();
  return query select o.* from public.opportunities o order by o.created_at desc limit 5000;
end;
$$;
revoke all on function public.admin_list_opportunities() from public, anon;
grant execute on function public.admin_list_opportunities() to authenticated;

create or replace function public.admin_moderate_opportunity(p_id character varying, p_status character varying)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
  v_org character varying;
begin
  v_uid := public.assert_platform_admin();
  if p_status not in ('published','pending_review','flagged','quarantined','rejected') then
    raise exception 'Unknown moderation status %.', p_status using errcode = '22023';
  end if;

  update public.opportunities
     set moderation_status = p_status,
         status = case
                    when p_status = 'published' then 'published'
                    when p_status in ('quarantined','rejected') then 'archived'
                    else status
                  end,
         updated_at = now()
   where id = p_id
   returning organization_id into v_org;
  if not found then
    raise exception 'Opportunity % not found.', p_id using errcode = '02000';
  end if;

  perform public.admin_write_audit(v_uid, 'opportunity.moderate', 'opportunity', p_id,
    jsonb_build_object('nextStatus', p_status), v_org);
end;
$$;
revoke all on function public.admin_moderate_opportunity(character varying, character varying) from public, anon;
grant execute on function public.admin_moderate_opportunity(character varying, character varying) to authenticated;

-- 4. Business listings -----------------------------------------------------------------------------------------
create or replace function public.admin_list_business_listings()
returns setof public.business_listings
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.assert_platform_admin();
  return query select b.* from public.business_listings b order by b.created_at desc limit 5000;
end;
$$;
revoke all on function public.admin_list_business_listings() from public, anon;
grant execute on function public.admin_list_business_listings() to authenticated;

create or replace function public.admin_moderate_business(p_id character varying, p_status character varying)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
begin
  v_uid := public.assert_platform_admin();
  if p_status not in ('pending_review','published','rejected','suspended') then
    raise exception 'Unknown moderation status %.', p_status using errcode = '22023';
  end if;

  update public.business_listings
     set moderation_status = p_status, updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Business listing % not found.', p_id using errcode = '02000';
  end if;

  perform public.admin_write_audit(v_uid, 'business.moderate', 'business_listing', p_id,
    jsonb_build_object('nextStatus', p_status));
end;
$$;
revoke all on function public.admin_moderate_business(character varying, character varying) from public, anon;
grant execute on function public.admin_moderate_business(character varying, character varying) to authenticated;

-- Suspended / rejected / pending listings must not be publicly visible.
drop policy if exists "Anyone can view public business listings" on public.business_listings;
create policy "Anyone can view public business listings" on public.business_listings
  for select using (status = 'published' and is_confidential = false and moderation_status = 'published');

-- 5. Audit trail -------------------------------------------------------------------------------------------------
create or replace function public.admin_list_audit_logs(p_limit integer default 300)
returns table (
  id character varying, user_id character varying, actor_name character varying,
  organization_id character varying, action character varying, resource_type character varying,
  resource_id character varying, details jsonb, ip_address character varying,
  created_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.assert_platform_admin();
  return query
    select a.id, a.user_id, u.full_name, a.organization_id, a.action, a.resource_type,
           a.resource_id, a.details, a.ip_address, a.created_at
    from public.audit_logs a
    left join public.users u on u.id = a.user_id
    order by a.created_at desc nulls last
    limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end;
$$;
revoke all on function public.admin_list_audit_logs(integer) from public, anon;
grant execute on function public.admin_list_audit_logs(integer) to authenticated;
