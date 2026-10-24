-- Application documents: real CV / credential uploads, stored privately, viewable by the hiring team.
--
-- Why:
--  The apply form showed a static "Auto-generated CV" label with no way to attach anything. The only file
--  path was a base64 data URL copied from the candidate profile into applications.resume_url (varchar), which
--  cannot hold a file and was never rendered anywhere for employers.
--
-- What:
--  1. applications.documents jsonb: metadata for each file (id, kind, fileName, fileType, fileSize, path).
--  2. PRIVATE Storage bucket 'application-documents' (10 MB cap, allow-listed types).
--     Object path convention: <applicant_user_id>/<application_id>/<document_id>-<file_name>
--  3. Storage RLS:
--       * applicants may upload only into their own <uid>/ folder, and may delete objects that are not yet
--         attached to a submitted application (orphan cleanup after a failed submit);
--       * the applicant and members of the application's organization may read.
--     No update policy: documents are immutable once submitted.
--  4. The applicant self-edit boundary trigger now also protects applications.documents.
--
-- Idempotent. Additive only: legacy rows (resume_data_url / resume_url) keep working.

alter table public.applications
  add column if not exists documents jsonb not null default '[]'::jsonb;

-- 1. Private bucket ---------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-documents', 'application-documents', false, 10485760,
  array['application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/rtf', 'text/rtf', 'text/plain',
        'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage policies -------------------------------------------------------------------------------
drop policy if exists "Applicants can upload application documents" on storage.objects;
create policy "Applicants can upload application documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Applicants can remove unsubmitted application documents" on storage.objects;
create policy "Applicants can remove unsubmitted application documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.applications a
      where a.id = (storage.foldername(name))[2]
    )
  );

drop policy if exists "Applicant and hiring team can read application documents" on storage.objects;
create policy "Applicant and hiring team can read application documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'application-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.applications a
        where a.id = (storage.foldername(name))[2]
          and public.is_org_member(a.organization_id)
      )
    )
  );

-- 3. Applicants cannot rewrite their submitted documents -------------------------------------------
create or replace function public.enforce_application_candidate_update_boundary()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.is_org_member(old.organization_id) then
    return new;
  end if;

  if new.stage is distinct from old.stage and new.stage is distinct from 'withdrawn' then
    raise exception 'Applicants may only withdraw their own application, not change its pipeline stage.' using errcode = '42501';
  end if;

  if new.opportunity_id is distinct from old.opportunity_id
    or new.applicant_user_id is distinct from old.applicant_user_id
    or new.organization_id is distinct from old.organization_id
    or new.applicant_full_name is distinct from old.applicant_full_name
    or new.applicant_email is distinct from old.applicant_email
    or new.applicant_phone is distinct from old.applicant_phone
    or new.applicant_county is distinct from old.applicant_county
    or new.cover_letter is distinct from old.cover_letter
    or new.cv_url is distinct from old.cv_url
    or new.screening_answers is distinct from old.screening_answers
    or new.evaluation_notes is distinct from old.evaluation_notes
    or new.internal_rating is distinct from old.internal_rating
    or new.match_score is distinct from old.match_score
    or new.match_notes is distinct from old.match_notes
    or new.rejection_reason is distinct from old.rejection_reason
    or new.interview_details is distinct from old.interview_details
    or new.hiring_offer_details is distinct from old.hiring_offer_details
    or new.resume_file_name is distinct from old.resume_file_name
    or new.resume_data_url is distinct from old.resume_data_url
    or new.resume_url is distinct from old.resume_url
    or new.documents is distinct from old.documents
    or new.evaluation_strengths is distinct from old.evaluation_strengths
    or new.evaluation_improvements is distinct from old.evaluation_improvements
    or new.internal_notes is distinct from old.internal_notes
    or new.applied_at is distinct from old.applied_at
  then
    raise exception 'Applicants may only withdraw their own application; employer-managed fields cannot be self-edited.' using errcode = '42501';
  end if;

  return new;
end;
$$;
