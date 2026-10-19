-- =====================================================================
-- F-17 (High): candidate profiles were readable by anonymous callers and
-- the stored privacy settings were largely not enforced.
--
-- get_public_candidate_profile() / search_candidate_profiles() were EXECUTE-able
-- by `anon` and only honoured profileVisibility = 'hidden' | 'anonymous'
-- (TypeScript also defines 'private', 'registered_only' and
-- 'verified_employers_only'; candidateService creates every new profile with
-- 'private'; the column default is 'private' too). Every unrecognised value
-- fell through to "public": an anonymous caller could enumerate profiles (bio,
-- work history, CV text) and, for cvDownloadPermission = 'permission_required',
-- receive the CV file data. Reproduced: an anon call returned a freshly created
-- default ('private') profile.
--
-- Fix:
--   * EXECUTE revoked from anon on both functions (candidate search is a
--     signed-in employer/recruiter feature).
--   * Visibility is enforced: public (and the identity-redacting 'anonymous')
--     -> visible; registered_only -> any signed-in user; verified_employers_only
--     -> members of a VERIFIED organization; hidden / private / ANY OTHER VALUE
--     -> not visible (fail closed) unless the candidate applied to one of the
--     viewer's organizations, the viewer is the candidate, or a platform admin.
--   * CV file data (cv_data_json.fileDataUrl and cv_file_url) is withheld
--     unless cvDownloadPermission = 'all_employers' for a signed-in viewer, or
--     the candidate applied to the viewer's organization.
--   * cv_raw_text (which normally embeds name/email/phone) is withheld unless
--     contact details are visible to the viewer.
-- The account-status guard (20261012150000) is preserved. Existing rows are not
-- modified. Self-view and platform-admin behaviour is unchanged.
--
-- ROLLBACK: re-apply the function body from 20260910150000_candidate_service_backend.sql
-- (plus `perform public.assert_account_active();` as the first statement) and
-- GRANT EXECUTE ... TO anon on both functions.
-- =====================================================================
create or replace function public.get_public_candidate_profile(p_target_user_id character varying)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.candidate_profiles;
  v_viewer_id varchar;
  v_has_applied boolean;
  v_visibility text;
  v_contact_visibility text;
  v_cv_permission text;
  v_visible boolean;
  v_result jsonb;
begin
  perform public.assert_account_active();

  select * into v_row from public.candidate_profiles where user_id = p_target_user_id;
  if not found then
    return null;
  end if;

  v_viewer_id := auth.uid()::varchar;

  -- Self-view: full access, no redaction.
  if v_viewer_id is not null and v_viewer_id = p_target_user_id then
    return to_jsonb(v_row);
  end if;

  -- Platform admin: full access.
  if v_viewer_id is not null and public.is_platform_admin(v_viewer_id) then
    return to_jsonb(v_row);
  end if;

  -- Applied to any organization the viewer is an active member of.
  v_has_applied := v_viewer_id is not null and exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_viewer_id and m.status = 'active'
      and public.candidate_has_applied_to_org(p_target_user_id, m.organization_id)
  );

  v_visibility := coalesce(v_row.privacy_settings->>'profileVisibility', 'public');
  v_contact_visibility := coalesce(v_row.privacy_settings->>'contactVisibility', 'on_application_only');
  v_cv_permission := coalesce(v_row.privacy_settings->>'cvDownloadPermission', 'applied_jobs_only');

  v_visible := case v_visibility
    when 'public' then true
    when 'anonymous' then true
    when 'registered_only' then v_viewer_id is not null
    when 'verified_employers_only' then v_viewer_id is not null and exists (
      select 1
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = v_viewer_id and m.status = 'active' and o.is_verified
    )
    else false  -- hidden, private and any unrecognised value fail closed
  end;

  if not v_visible and not v_has_applied then
    return null;
  end if;

  v_result := to_jsonb(v_row);

  if v_visibility = 'anonymous' and not v_has_applied then
    v_result := v_result
      || jsonb_build_object('full_name', 'Candidate #' || upper(right(p_target_user_id, 4)))
      || jsonb_build_object('avatar_url', null)
      || jsonb_build_object('email', null)
      || jsonb_build_object('phone', null);
  end if;

  if v_contact_visibility = 'on_application_only' and not v_has_applied then
    v_result := v_result || jsonb_build_object('phone', '[Visible upon application]', 'email', '[Visible upon application]');
  elsif v_contact_visibility = 'hidden' then
    v_result := v_result || jsonb_build_object('phone', '[Private]', 'email', '[Private]');
  end if;

  -- CV text normally embeds name / email / phone: only when contact is visible.
  if not v_has_applied and v_contact_visibility is distinct from 'public' then
    v_result := v_result || jsonb_build_object('cv_raw_text', null);
  end if;

  -- CV file: only for 'all_employers' (signed-in viewer) or when the candidate applied.
  if not v_has_applied and not (v_cv_permission = 'all_employers' and v_viewer_id is not null) then
    if v_result->'cv_data_json' is not null and jsonb_typeof(v_result->'cv_data_json') = 'object' then
      v_result := v_result || jsonb_build_object('cv_data_json', (v_result->'cv_data_json') - 'fileDataUrl');
    end if;
    v_result := v_result || jsonb_build_object('cv_file_url', null);
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_public_candidate_profile(character varying) from public, anon;
grant execute on function public.get_public_candidate_profile(character varying) to authenticated;
revoke all on function public.search_candidate_profiles(text, text, text, integer, text) from public, anon;
grant execute on function public.search_candidate_profiles(text, text, text, integer, text) to authenticated;
