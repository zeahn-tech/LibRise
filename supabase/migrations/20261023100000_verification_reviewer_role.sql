-- Least-privilege verification review (audit finding #3).
--
-- Before: only a full platform administrator could review verification requests, so a reviewer
-- necessarily also held every other admin power (role changes, payment approval, ...). A user with
-- system_role = 'verification_officer' could do nothing.
--
-- After: a 'verification_officer' (or legacy 'verifier') can see the review queue and decide requests,
-- and NOTHING else. They still cannot call any admin_* RPC, edit organizations directly, approve
-- payments or change roles. Conflict-of-interest guard: a reviewer cannot decide a request they
-- submitted or for an organization they belong to, so they cannot grant themselves a badge.
-- Idempotent.

create or replace function public.current_user_is_verification_reviewer()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()::character varying
      and u.system_role in ('verification_officer', 'verifier')
      and coalesce(u.account_status, 'active') = 'active'
  );
$$;
revoke all on function public.current_user_is_verification_reviewer() from public, anon;
grant execute on function public.current_user_is_verification_reviewer() to authenticated;

drop policy if exists "Verification reviewers can view verification requests" on public.verification_requests;
create policy "Verification reviewers can view verification requests"
  on public.verification_requests for select
  to authenticated
  using (public.current_user_is_verification_reviewer());

create or replace function public.review_verification_request(
  p_request_id character varying,
  p_decision character varying,
  p_reviewer_notes text default null,
  p_rejection_reason text default null
)
returns public.verification_requests
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_req public.verification_requests;
  v_uid character varying;
  v_reviewer_name character varying;
  v_is_admin boolean;
begin
  perform public.assert_account_active();
  v_uid := auth.uid()::character varying;
  v_is_admin := v_uid is not null and public.is_platform_admin(v_uid);
  if v_uid is null or not (v_is_admin or public.current_user_is_verification_reviewer()) then
    raise exception 'Only platform administrators or verification officers may review verification requests.' using errcode = '42501';
  end if;
  if p_decision not in ('verified', 'rejected', 'suspended') then
    raise exception 'Decision must be verified, rejected or suspended.' using errcode = '22023';
  end if;
  if p_decision = 'suspended' and not v_is_admin then
    raise exception 'Only platform administrators may suspend a verification.' using errcode = '42501';
  end if;

  select * into v_req from public.verification_requests where id = p_request_id;
  if not found then
    raise exception 'Verification request % not found.', p_request_id using errcode = '02000';
  end if;

  -- Conflict of interest applies to non-admin reviewers: no self-review, no reviewing own organization.
  if not v_is_admin then
    if v_req.submitter_user_id = v_uid
       or (v_req.entity_type = 'organization' and exists (
             select 1 from public.organization_memberships m
             where m.organization_id = v_req.entity_id and m.user_id = v_uid and m.status = 'active'))
       or (v_req.entity_type = 'business' and exists (
             select 1 from public.business_listings b
             where b.id = v_req.entity_id and b.owner_user_id = v_uid)) then
      raise exception 'You cannot review a verification request for your own organization or listing.' using errcode = '42501';
    end if;
  end if;

  select full_name into v_reviewer_name from public.users where id = v_uid;

  update public.verification_requests
  set status = p_decision,
      reviewer_user_id = v_uid,
      reviewer_name = coalesce(v_reviewer_name, 'Verification Officer'),
      reviewer_notes = p_reviewer_notes,
      rejection_reason = p_rejection_reason,
      reviewed_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_req;

  if p_decision = 'verified' then
    if v_req.entity_type = 'organization' then
      update public.organizations
      set verification_status = 'verified',
          verification_badge = v_req.badge_requested,
          registration_number = coalesce(v_req.registration_number, registration_number),
          tax_id_number = coalesce(v_req.tax_id_number, tax_id_number)
      where id = v_req.entity_id;
    elsif v_req.entity_type = 'business' then
      update public.business_listings
      set is_verified = true,
          moderation_status = 'published'
      where id = v_req.entity_id;
    end if;
  end if;

  insert into public.audit_logs (id, user_id, action, resource_type, resource_id, details)
  values (
    'auditlog-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    v_uid, 'verification.decide', v_req.entity_type, v_req.id,
    jsonb_build_object('decision', p_decision, 'reviewerNotes', p_reviewer_notes,
                       'reviewerRole', case when v_is_admin then 'platform_admin' else 'verification_officer' end)
  );

  return v_req;
end;
$$;
revoke all on function public.review_verification_request(character varying, character varying, text, text) from public, anon;
grant execute on function public.review_verification_request(character varying, character varying, text, text) to authenticated;
