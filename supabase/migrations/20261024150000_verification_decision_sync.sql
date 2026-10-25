-- Unify the two verification decision paths.
--
-- Background: a verification submission creates BOTH a verification_requests row (reviewed in the Trust & Safety
-- "Statutory Evidence Queue" via review_verification_request) and a verification_audits row (reviewed in the
-- Verification Hub queue via decide_verification_audit). Deciding one never touched the other, so the same
-- submission could stay "pending" in one queue after being approved in the other.
--
-- Fix: whichever decision is made first is mirrored onto the sibling record, so both queues always agree. Both RPCs
-- already update the organization's badge themselves, so this only syncs status / reviewer / notes.
-- Siblings are matched by id (new submissions share the id) and, for older rows, by organization.
-- The sync only touches siblings that are still pending, so the two triggers cannot loop.
-- Idempotent.

create or replace function public.sync_audit_from_request()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status text;
begin
  if new.entity_type <> 'organization' or new.status not in ('verified', 'rejected')
     or old.status is not distinct from new.status then
    return new;
  end if;
  v_status := case new.status when 'verified' then 'approved' else 'rejected' end;

  update public.verification_audits a
     set status = v_status, reviewer_user_id = new.reviewer_user_id,
         reviewer_notes = coalesce(new.reviewer_notes, new.rejection_reason),
         reviewed_at = coalesce(new.reviewed_at, now())
   where a.id = new.id and a.status in ('pending', 'under_review');

  if not found then
    update public.verification_audits a
       set status = v_status, reviewer_user_id = new.reviewer_user_id,
           reviewer_notes = coalesce(new.reviewer_notes, new.rejection_reason),
           reviewed_at = coalesce(new.reviewed_at, now())
     where a.organization_id = new.entity_id and a.status in ('pending', 'under_review');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_audit_from_request() from public, anon, authenticated;

drop trigger if exists trg_sync_audit_from_request on public.verification_requests;
create trigger trg_sync_audit_from_request
  after update of status on public.verification_requests
  for each row execute function public.sync_audit_from_request();

create or replace function public.sync_request_from_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status text;
  v_name character varying;
begin
  if new.status not in ('approved', 'rejected') or old.status is not distinct from new.status then
    return new;
  end if;
  v_status := case new.status when 'approved' then 'verified' else 'rejected' end;
  select full_name into v_name from public.users where id = new.reviewer_user_id;

  update public.verification_requests r
     set status = v_status, reviewer_user_id = new.reviewer_user_id,
         reviewer_name = coalesce(v_name, 'Platform Administrator'),
         reviewer_notes = new.reviewer_notes,
         rejection_reason = case when v_status = 'rejected' then new.reviewer_notes else r.rejection_reason end,
         reviewed_at = coalesce(new.reviewed_at, now()), updated_at = now()
   where r.id = new.id and r.status = 'pending_review';

  if not found then
    update public.verification_requests r
       set status = v_status, reviewer_user_id = new.reviewer_user_id,
           reviewer_name = coalesce(v_name, 'Platform Administrator'),
           reviewer_notes = new.reviewer_notes,
           rejection_reason = case when v_status = 'rejected' then new.reviewer_notes else r.rejection_reason end,
           reviewed_at = coalesce(new.reviewed_at, now()), updated_at = now()
     where r.entity_type = 'organization' and r.entity_id = new.organization_id and r.status = 'pending_review';
  end if;
  return new;
end;
$$;
revoke all on function public.sync_request_from_audit() from public, anon, authenticated;

drop trigger if exists trg_sync_request_from_audit on public.verification_audits;
create trigger trg_sync_request_from_audit
  after update of status on public.verification_audits
  for each row execute function public.sync_request_from_audit();

-- One-time backfill for rows already decided in only one queue (the triggers above only handle future decisions).
update public.verification_audits a
   set status = case r.status when 'verified' then 'approved' else 'rejected' end,
       reviewer_user_id = r.reviewer_user_id,
       reviewer_notes = coalesce(r.reviewer_notes, r.rejection_reason),
       reviewed_at = coalesce(r.reviewed_at, now())
  from public.verification_requests r
 where r.entity_type = 'organization' and r.entity_id = a.organization_id
   and r.status in ('verified', 'rejected') and a.status in ('pending', 'under_review');

update public.verification_requests r
   set status = case a.status when 'approved' then 'verified' else 'rejected' end,
       reviewer_user_id = a.reviewer_user_id,
       reviewer_notes = a.reviewer_notes,
       rejection_reason = case when a.status = 'rejected' then a.reviewer_notes else r.rejection_reason end,
       reviewed_at = coalesce(a.reviewed_at, now()), updated_at = now()
  from public.verification_audits a
 where r.entity_type = 'organization' and r.entity_id = a.organization_id
   and a.status in ('approved', 'rejected') and r.status = 'pending_review';
