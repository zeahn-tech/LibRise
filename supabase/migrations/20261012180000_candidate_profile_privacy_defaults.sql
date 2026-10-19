-- =====================================================================
-- F-17b: fail-closed defaults and CV/anonymity leaks in
-- get_public_candidate_profile() (follow-up to 20261012170000).
--
-- Review findings against 20261012170000:
--  1. A missing / null profileVisibility defaulted to 'public'. Product policy
--     (candidateService.createProfile and the column default) is 'private', so
--     a missing key now means 'private' (hidden until the candidate applies).
--  2. contactVisibility: only 'on_application_only' and 'hidden' were handled;
--     any other value left email/phone visible. Supported values are
--     'public' | 'on_application_only' | 'hidden'; missing -> 'on_application_only';
--     ANY OTHER value -> treated as 'hidden' (never shown).
--  3. A profile marked 'anonymous' still exposed cv_raw_text (normally embeds
--     name/email/phone) and cv_data_json / cv_file_url whenever contact
--     visibility was 'public'. For anonymous profiles the CV artefacts are now
--     withheld from every viewer who has not received an application from the
--     candidate. NOTE: free-text fields the candidate wrote (bio, work history)
--     are still shown for anonymous profiles by design.
--  4. cvDownloadPermission: 'all_employers' now requires the viewer to be an
--     ACTIVE MEMBER OF AN ORGANIZATION (previously any signed-in user);
--     'applied_jobs_only' (default when missing) and 'permission_required'
--     show the CV file only to an organization the candidate applied to;
--     any other value is treated as 'permission_required'.
--  Self-view and platform-admin access are unchanged.
--
-- BEHAVIOUR CHANGE for existing rows: profiles whose privacy_settings has no
-- profileVisibility key (or '{}' / JSON null) switch from visible to hidden.
-- Rows created by the app or by the column default already carry 'private'.
-- Count the affected rows BEFORE applying:
--   select count(*) from public.candidate_profiles
--    where coalesce(privacy_settings->>'profileVisibility','') = '';
-- No row is modified by this migration.
--
-- ROLLBACK: re-apply the function body from 20261012170000_candidate_profile_privacy.sql.
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
  v_is_employer boolean;
  v_visibility text;
  v_contact text;
  v_contact_raw text;
  v_cv text;
  v_cv_raw text;
  v_visible boolean;
  v_contact_ok boolean;
  v_cv_ok boolean;
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

  v_has_applied := v_viewer_id is not null and exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_viewer_id and m.status = 'active'
      and public.candidate_has_applied_to_org(p_target_user_id, m.organization_id)
  );
  v_is_employer := v_viewer_id is not null and exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_viewer_id and m.status = 'active'
  );

  -- Visibility: missing -> 'private' (product default); unknown -> not visible.
  v_visibility := coalesce(v_row.privacy_settings->>'profileVisibility', 'private');
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
    else false  -- 'hidden', 'private' and any unrecognised value
  end;
  if not v_visible and not v_has_applied then
    return null;
  end if;

  -- Contact visibility: missing -> on_application_only; unknown -> hidden.
  v_contact_raw := v_row.privacy_settings->>'contactVisibility';
  v_contact := case
    when v_contact_raw is null then 'on_application_only'
    when v_contact_raw in ('public', 'on_application_only', 'hidden') then v_contact_raw
    else 'hidden'
  end;
  v_contact_ok := v_contact = 'public' or (v_contact = 'on_application_only' and v_has_applied);

  -- CV permission: missing -> applied_jobs_only; unknown -> permission_required.
  v_cv_raw := v_row.privacy_settings->>'cvDownloadPermission';
  v_cv := case
    when v_cv_raw is null then 'applied_jobs_only'
    when v_cv_raw in ('all_employers', 'applied_jobs_only', 'permission_required') then v_cv_raw
    else 'permission_required'
  end;
  v_cv_ok := v_has_applied or (v_cv = 'all_employers' and v_is_employer);

  v_result := to_jsonb(v_row);

  if v_visibility = 'anonymous' and not v_has_applied then
    v_result := v_result
      || jsonb_build_object('full_name', 'Candidate #' || upper(right(p_target_user_id, 4)))
      || jsonb_build_object('avatar_url', null)
      || jsonb_build_object('email', null)
      || jsonb_build_object('phone', null);
  end if;

  if v_contact = 'on_application_only' and not v_has_applied then
    v_result := v_result || jsonb_build_object('phone', '[Visible upon application]', 'email', '[Visible upon application]');
  elsif v_contact not in ('public', 'on_application_only') then
    v_result := v_result || jsonb_build_object('phone', '[Private]', 'email', '[Private]');
  end if;

  -- CV text embeds identity/contact details: needs contact to be visible AND the
  -- profile not to be an anonymous one the viewer has no application from.
  if not v_contact_ok or (v_visibility = 'anonymous' and not v_has_applied) then
    v_result := v_result || jsonb_build_object('cv_raw_text', null);
  end if;

  -- CV file / structured CV.
  if v_visibility = 'anonymous' and not v_has_applied then
    v_result := v_result || jsonb_build_object('cv_data_json', null, 'cv_file_url', null);
  elsif not v_cv_ok then
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
