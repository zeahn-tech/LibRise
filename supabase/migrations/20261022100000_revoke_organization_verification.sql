-- Platform-admin "Revoke Badges" for organizations.
--
-- Verification columns on public.organizations are not client-writable (guard_org_verification_columns),
-- and review_verification_request only ever GRANTS verification. The admin dashboard's revoke action
-- therefore had no legitimate server-side path. This SECURITY DEFINER function is that path: platform
-- admins only, audited, and it also marks the org's verified request as suspended so the queue and the
-- organization stay consistent. is_verified is recomputed by trg_sync_organization_verified_flag.
-- Idempotent.

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
  v_uid := auth.uid()::character varying;
  if v_uid is null or not public.is_platform_admin(v_uid) then
    raise exception 'Only platform administrators may revoke organization verification.' using errcode = '42501';
  end if;

  update public.organizations
     set verification_status = 'unverified',
         verification_badge = null
   where id = p_organization_id;
  if not found then
    raise exception 'Organization % not found.', p_organization_id using errcode = '02000';
  end if;

  update public.verification_requests
     set status = 'suspended',
         reviewer_user_id = v_uid,
         reviewer_notes = coalesce(p_reason, reviewer_notes),
         updated_at = now()
   where entity_type = 'organization'
     and entity_id = p_organization_id
     and status = 'verified';

  insert into public.audit_logs (id, user_id, organization_id, action, resource_type, resource_id, details)
  values (
    'auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    v_uid, p_organization_id, 'organization.verification_revoked', 'organization', p_organization_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

revoke all on function public.revoke_organization_verification(character varying, text) from public, anon;
grant execute on function public.revoke_organization_verification(character varying, text) to authenticated;
