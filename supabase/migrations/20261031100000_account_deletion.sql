-- Self-service account deletion.
--
-- What "delete my account" means in LibRise:
--   DELETED  the person's profile and CV, the applications they submitted, saved items, notifications, business
--            listings they posted, team memberships (an organization's last owner row is kept, see below), their sign-in account (server step) and every file they uploaded
--            (server step: CVs, credentials, verification evidence, message attachments).
--   KEPT     records other people or the business depend on, with the person shown only as "Deleted user":
--            messages they sent, payment records, safety reports, verification and audit history. The users row stays
--            as an anonymised tombstone (no name, email, phone or photo) so those records keep working.
--
-- The database step is the point of no return: it anonymises the account and sets account_status = 'deactivated',
-- which the existing policies treat as "no data access" and which bans the sign-in account. The server then purges
-- files and deletes the sign-in account (see server/accountDeletion.ts).
--
-- Three functions, all callable only by the signed-in person about THEMSELVES:
--   account_deletion_blockers()      -> jsonb list of reasons deletion must wait (empty = allowed). Read-only.
--   account_deletion_storage_paths() -> jsonb of file paths the server must remove. Read-only; call BEFORE deleting.
--   delete_my_account()              -> performs the database part.
-- Idempotent.

alter table public.users add column if not exists deleted_at timestamptz;

create or replace function public.account_deletion_blockers()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying := auth.uid()::character varying;
  v_blockers jsonb := '[]'::jsonb;
  v_names text;
begin
  if v_uid is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  perform public.assert_account_active();

  -- 1. The last active platform administrator would leave the platform without one.
  if public.is_platform_admin(v_uid) and not exists (
       select 1 from public.users o
        where o.id <> v_uid and public.is_platform_admin(o.id)
          and coalesce(o.account_status, 'active') not in ('suspended', 'deactivated')
     ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'last_platform_admin',
      'message', 'You are the only active platform administrator. Make another person an administrator before deleting this account.'));
  end if;

  -- 2. Sole owner of an organization that still has other active team members.
  select string_agg(o.name, ', ' order by o.name) into v_names
    from public.organizations o
    join public.organization_memberships m
      on m.organization_id = o.id and m.user_id = v_uid and m.status = 'active' and m.org_role = 'owner'
   where exists (select 1 from public.organization_memberships x
                  where x.organization_id = o.id and x.user_id <> v_uid and x.status = 'active')
     and not exists (select 1 from public.organization_memberships y
                      where y.organization_id = o.id and y.user_id <> v_uid and y.status = 'active' and y.org_role = 'owner');
  if v_names is not null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'organization_owner',
      'message', format('You are the only owner of %s, which still has other team members. Make another member an owner, or remove the other members, then try again.', v_names)));
  end if;

  -- 3. A payment waiting for review: money may be owed either way, so it has to be settled first.
  if exists (select 1 from public.payments p where p.created_by_user_id = v_uid and p.status = 'payment_pending') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'payment_pending',
      'message', 'You have a payment that is still awaiting review. Wait for the result, or contact support, before deleting your account.'));
  end if;

  return v_blockers;
end;
$$;
revoke all on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;

create or replace function public.account_deletion_storage_paths()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying := auth.uid()::character varying;
begin
  if v_uid is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  perform public.assert_account_active();

  return jsonb_build_object(
    'applicationDocuments', (
      select coalesce(jsonb_agg(distinct d ->> 'path'), '[]'::jsonb)
        from public.applications a, jsonb_array_elements(coalesce(a.documents, '[]'::jsonb)) d
       where a.applicant_user_id = v_uid and coalesce(d ->> 'path', '') <> ''
    ),
    'verificationDocuments', (
      select coalesce(jsonb_agg(distinct d ->> 'path'), '[]'::jsonb)
        from public.verification_requests r, jsonb_array_elements(coalesce(r.evidence_documents, '[]'::jsonb)) d
       where r.submitter_user_id = v_uid and coalesce(d ->> 'path', '') <> ''
    ),
    'messageAttachments', (
      select coalesce(jsonb_agg(distinct d ->> 'path'), '[]'::jsonb)
        from public.direct_messages m, jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) d
       where m.sender_id = v_uid and coalesce(d ->> 'path', '') <> ''
    )
  );
end;
$$;
revoke all on function public.account_deletion_storage_paths() from public, anon;
grant execute on function public.account_deletion_storage_paths() to authenticated;

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
