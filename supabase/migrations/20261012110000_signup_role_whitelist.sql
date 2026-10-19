-- =====================================================================
-- F-12 (P0): signup could self-assign platform_admin.
--
-- handle_new_auth_user() copied auth.users.raw_user_meta_data->>'primaryRole'
-- straight into public.users.primary_role. raw_user_meta_data is the
-- `options.data` object of the PUBLIC supabase.auth.signUp() call, i.e.
-- fully attacker-controlled, and public.is_platform_admin() treats
-- primary_role = 'platform_admin' as a platform admin. Anyone could
-- register as a platform admin.
--
-- Fix: only self-selectable roles are honoured from signup metadata;
-- anything else (including platform_admin / verification_officer, which
-- must be granted by an operator) becomes 'job_seeker'. Existing rows are
-- NOT modified -- see the audit query in docs/LAUNCH_AUDIT.md to review
-- any account that already holds an admin role.
--
-- ROLLBACK: re-apply the function body from
-- 20260908120000_sync_auth_users_to_public_users.sql.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_requested_role text := NEW.raw_user_meta_data->>'primaryRole';
  v_role text;
BEGIN
  v_role := CASE
    WHEN v_requested_role IN (
      'job_seeker', 'employer', 'recruiter', 'business_seller', 'buyer',
      'service_provider', 'organization_admin', 'investor_buyer'
    ) THEN v_requested_role
    ELSE 'job_seeker'
  END;

  INSERT INTO public.users (
    id, email, full_name, phone_number, primary_role, system_role,
    account_status, primary_county, is_email_verified, is_phone_verified,
    created_at, last_login_at
  )
  VALUES (
    NEW.id::VARCHAR,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'fullName', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phoneNumber',
    v_role,
    'user',
    'pending_verification',
    COALESCE(NEW.raw_user_meta_data->>'primaryCounty', 'Montserrado'),
    (NEW.email_confirmed_at IS NOT NULL),
    FALSE,
    NEW.created_at,
    NEW.created_at
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
