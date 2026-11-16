-- Account deletion: also scrub verification submissions.
--
-- Before: deleting an account removed the verification FILES (server step) but left the verification_requests row
-- pointing at them, together with the submitter's name and email, the TIN, the licence number and the applicant's notes.
-- Now delete_my_account() also clears, for requests the person submitted: the document references, the notes, the TIN,
-- the licence number, and replaces the submitter's name and email with the same placeholders used on the users row.
-- KEPT as the decision record: organization name, registration number, badge requested, county, status, reviewer,
-- reviewer notes and dates. The organization's current badge is not changed by this.
-- Also clears verification_audits.documents_submitted for the person's submissions.
-- Idempotent (create or replace).

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying := auth.uid()::character varying;
  v_blockers jsonb;
  v_old_email character varying;
  v_orphaned_orgs character varying[];
begin
  if v_uid is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  perform public.assert_account_active();

  v_blockers := public.account_deletion_blockers();
  if jsonb_array_length(v_blockers) > 0 then
    raise exception '%', v_blockers -> 0 ->> 'message' using errcode = '22023', detail = v_blockers::text;
  end if;

  select email into v_old_email from public.users where id = v_uid for update;
  if not found then
    raise exception 'Account not found.' using errcode = '02000';
  end if;

  -- Organizations that will have nobody left: stop their vacancies being listed (the organization itself and its
  -- history stay, as other people's records depend on them).
  select array_agg(m.organization_id) into v_orphaned_orgs
    from public.organization_memberships m
   where m.user_id = v_uid and m.status = 'active'
     and not exists (select 1 from public.organization_memberships x
                      where x.organization_id = m.organization_id and x.user_id <> v_uid and x.status = 'active');
  if v_orphaned_orgs is not null then
    update public.opportunities set status = 'closed', updated_at = now()
     where organization_id = any (v_orphaned_orgs) and status = 'published';
  end if;

  -- Personal data: removed.
  delete from public.applications where applicant_user_id = v_uid;
  delete from public.candidate_profiles where user_id = v_uid;
  delete from public.business_access_requests where buyer_user_id = v_uid;
  delete from public.business_saved_listings where user_id = v_uid;
  delete from public.business_inquiries where sender_user_id = v_uid;
  delete from public.business_listings where owner_user_id = v_uid;
  delete from public.notifications where recipient_user_id = v_uid;
  delete from public.conversation_participants where user_id = v_uid;
  delete from public.user_blocks where blocking_user_id = v_uid or blocked_user_id = v_uid;
  delete from public.organization_invitations where lower(invitee_email) = lower(v_old_email);

  -- Verification submissions this person made. The files themselves are removed from storage by the server step (it reads
  -- the paths BEFORE this function runs and also sweeps the person's own folders); here the references, notes and personal
  -- details go too. Only the decision record stays (organization name, registration number, outcome, reviewer, dates) so
  -- the audit trail and the organization's badge history still make sense.
  update public.verification_requests
     set evidence_documents = '[]'::jsonb,
         evidence_notes = null,
         tax_id_number = null,
         license_number = null,
         submitter_name = 'Deleted user',
         submitter_email = format('deleted-%s@deleted.invalid', v_uid),
         updated_at = now()
   where submitter_user_id = v_uid;
  update public.verification_audits
     set documents_submitted = '[]'::jsonb
   where requested_by_user_id = v_uid;
  -- Memberships are removed, EXCEPT where this person is the organization's only active owner (which is the case when they
  -- are its only member, since the blockers above reject owners of teams with others): the database rule
  -- enforce_owner_invariant requires every organization to keep an active owner, so that row stays, attached to the
  -- now-deactivated account. The organization and its history are preserved and its vacancies were closed above.
  delete from public.organization_memberships m
   where m.user_id = v_uid
     and not (
       m.org_role = 'owner' and m.status = 'active'
       and not exists (select 1 from public.organization_memberships o
                        where o.organization_id = m.organization_id and o.id <> m.id
                          and o.org_role = 'owner' and o.status = 'active')
     );

  -- The account itself: anonymised, deactivated (the trigger on account_status bans the sign-in account), and stripped
  -- of any elevated role. The row is kept so messages, payments and audit history keep a valid reference.
  update public.users
     set full_name = 'Deleted user',
         email = format('deleted-%s@deleted.invalid', id),
         phone_number = null,
         avatar_url = null,
         primary_county = null,
         is_email_verified = false,
         is_phone_verified = false,
         last_login_at = null,
         system_role = 'user',
         primary_role = case when primary_role in ('platform_admin', 'verification_officer') then 'job_seeker' else primary_role end,
         account_status = 'deactivated',
         deleted_at = now()
   where id = v_uid;

  perform public.admin_write_audit(v_uid, 'account.deleted', 'user', v_uid, '{}'::jsonb);

  return jsonb_build_object('userId', v_uid, 'deletedAt', now());
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
