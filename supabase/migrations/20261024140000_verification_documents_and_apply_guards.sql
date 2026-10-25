-- 1. Verification evidence: private Storage so platform admins / verification officers can actually open it.
-- 2. Applications: database-level guards (no applying to your own organization's posting; no duplicate active application).
--
-- Why:
--  * Verification evidence was kept as browser blob: URLs that die with the tab, so reviewers only ever saw file
--    names (the admin "preview" was a static placeholder). Files now live in a PRIVATE bucket; verification_requests
--    .evidence_documents keeps metadata + the object path.
--  * Nothing stopped a member of the posting organization from applying to its own vacancy, or applying twice.
--
-- Object path: <submitter_user_id>/<verification_request_id>/<document_id>-<file_name>
-- Idempotent. Additive only. No dependency on earlier unreleased migrations.

-- 1. Bucket --------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents', 'verification-documents', false, 10485760,
  array['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage policies ----------------------------------------------------------------------------------
drop policy if exists "Submitters can upload verification documents" on storage.objects;
create policy "Submitters can upload verification documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Orphan cleanup only: once a request row exists for the folder, its evidence is immutable.
drop policy if exists "Submitters can remove unsubmitted verification documents" on storage.objects;
create policy "Submitters can remove unsubmitted verification documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.verification_requests r
      where r.id = (storage.foldername(name))[2]
    )
  );

drop policy if exists "Submitter, platform admins and verification officers can read verification documents" on storage.objects;
create policy "Submitter, platform admins and verification officers can read verification documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_platform_admin(auth.uid()::character varying)
      or exists (
        select 1 from public.users u
        where u.id = auth.uid()::character varying
          and u.system_role in ('verification_officer', 'verifier')
          and coalesce(u.account_status, 'active') = 'active'
      )
    )
  );

-- 3. Application guards ---------------------------------------------------------------------------------
create or replace function public.guard_application_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org character varying;
  v_creator character varying;
begin
  select o.organization_id, o.created_by_user_id
    into v_org, v_creator
    from public.opportunities o
   where o.id = new.opportunity_id;

  if found then
    if v_creator = new.applicant_user_id
       or exists (
         select 1 from public.organization_memberships m
          where m.organization_id = v_org
            and m.user_id = new.applicant_user_id
            and m.status = 'active'
       ) then
      raise exception 'You cannot apply to an opportunity posted by your own organization.' using errcode = '42501';
    end if;
  end if;

  if exists (
    select 1 from public.applications a
     where a.opportunity_id = new.opportunity_id
       and a.applicant_user_id = new.applicant_user_id
       and a.id <> new.id
       and a.stage is distinct from 'withdrawn'
  ) then
    raise exception 'You have already applied to this opportunity.' using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_application_insert() from public, anon, authenticated;

-- AFTER INSERT (not BEFORE) on purpose: Postgres evaluates RLS WITH CHECK before AFTER triggers, so an account that
-- is not allowed to apply at all (suspended, applications_disabled, ...) still gets the standard 42501 permission
-- denial rather than a misleading "already applied" error. Raising here rolls the insert back.
drop trigger if exists trg_guard_application_insert on public.applications;
create trigger trg_guard_application_insert
  after insert on public.applications
  for each row execute function public.guard_application_insert();
