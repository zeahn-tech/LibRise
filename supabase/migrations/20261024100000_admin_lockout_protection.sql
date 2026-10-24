-- Admin lockout protection (audit follow-up).
-- Before: a platform administrator could suspend their own account, or suspend every administrator
-- in turn, leaving nobody able to administer the platform.
-- After: self-restriction is refused, and the last active platform administrator cannot be suspended.
-- Idempotent (create or replace); grants unchanged.

CREATE OR REPLACE FUNCTION public.apply_account_restriction(p_id character varying, p_target_user_id character varying, p_restriction_type character varying, p_reason text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS account_restrictions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_restriction public.account_restrictions;
  v_uid character varying;
  v_issuer_name character varying;
  v_target_name character varying;
  v_target_email character varying;
begin
  perform public.assert_account_active();
  v_uid := auth.uid()::character varying;
  if v_uid is null or not public.is_platform_admin(v_uid) then
    raise exception 'Only platform administrators may restrict an account.' using errcode = '42501';
  end if;

  -- Lockout protection: an administrator may not restrict their own account, and the last
  -- active platform administrator can never be suspended.
  if p_target_user_id = v_uid then
    raise exception 'You cannot restrict your own account.' using errcode = '42501';
  end if;
  if p_restriction_type = 'full_suspension' and exists (
       select 1 from public.users t
       where t.id = p_target_user_id
         and (t.system_role = 'platform_admin' or t.primary_role = 'platform_admin')
     )
     and not exists (
       select 1 from public.users o
       where o.id <> p_target_user_id
         and (o.system_role = 'platform_admin' or o.primary_role = 'platform_admin')
         and coalesce(o.account_status, 'active') = 'active'
     ) then
    raise exception 'Cannot suspend the last active platform administrator.' using errcode = '42501';
  end if;

  select full_name, email into v_target_name, v_target_email from public.users where id = p_target_user_id;
  if v_target_name is null then
    raise exception 'User % not found.', p_target_user_id using errcode = '02000';
  end if;
  select full_name into v_issuer_name from public.users where id = v_uid;

  insert into public.account_restrictions (
    id, user_id, user_name, user_email, restriction_type, reason,
    issued_by_user_id, issued_by_name, expires_at, status
  ) values (
    p_id, p_target_user_id, v_target_name, v_target_email, p_restriction_type, p_reason,
    v_uid, coalesce(v_issuer_name, 'Platform Administrator'), p_expires_at, 'active'
  )
  returning * into v_restriction;

  if p_restriction_type = 'full_suspension' then
    update public.users set account_status = 'suspended' where id = p_target_user_id;
  end if;

  insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
  values (
    'auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    v_uid, 'user.restrict', 'user', p_target_user_id,
    jsonb_build_object('restrictionType', p_restriction_type, 'reason', p_reason)
  );

  return v_restriction;
end;
$function$;
revoke all on function public.apply_account_restriction(character varying, character varying, character varying, text, timestamp with time zone) from public, anon;
grant execute on function public.apply_account_restriction(character varying, character varying, character varying, text, timestamp with time zone) to authenticated;
