-- =====================================================================
-- F-19 (Medium): a suspended account kept a working login.
--
-- 20261012150000 makes the DATABASE deny a suspended account everything, but
-- the Supabase Auth user stayed able to sign in and refresh its session (an
-- access token is also valid for up to its expiry, default 1 h).
--
-- apply_account_restriction('full_suspension') now also BANS the auth user
-- (auth.users.banned_until = 'infinity', which blocks sign-in and token
-- refresh) and deletes its sessions and refresh tokens;
-- lift_account_restriction() clears the ban when the last active full
-- suspension is lifted. Both go through set_auth_ban(), which is NOT
-- executable by client roles and which downgrades any failure to a WARNING:
-- if a project does not let the migration owner modify the auth schema, the
-- database-level enforcement still applies and the ban must be applied from
-- the dashboard / admin API instead (see docs/LAUNCH_AUDIT.md).
-- Session semantics after suspension:
--   * new sign-in / refresh        -> refused by Auth (ban)          [needs real Auth to verify]
--   * an already-issued access JWT -> valid until expiry, but every table and
--     RPC call is denied by the account-status policies (tested)
--   * Realtime / Storage           -> see docs/LAUNCH_AUDIT.md
--
-- ROLLBACK: re-apply the function bodies from 20260911150000 (+ the
-- assert_account_active() line from 20261012150000); drop set_auth_ban(). Bans
-- already applied can be cleared with:
--   update auth.users set banned_until = null where id = '<uuid>';
-- =====================================================================
create or replace function public.set_auth_ban(p_uid varchar, p_ban boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
  begin
    update auth.users
    set banned_until = case when p_ban then 'infinity'::timestamptz else null end
    where id = p_uid::uuid;
    if p_ban then
      delete from auth.refresh_tokens where user_id = p_uid;
      delete from auth.sessions where user_id = p_uid::uuid;
    end if;
  exception when others then
    raise warning 'set_auth_ban(%, %) could not update the auth schema: %', p_uid, p_ban, sqlerrm;
  end;
end;
$$;
revoke all on function public.set_auth_ban(varchar, boolean) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.apply_account_restriction(character varying, character varying, character varying, text, timestamp with time zone)'::regprocedure) into v_def;
  if position('set_auth_ban' in v_def) = 0 then
    v_new := replace(v_def,
      E'update public.users set account_status = ''suspended'' where id = p_target_user_id;',
      E'update public.users set account_status = ''suspended'' where id = p_target_user_id;\n    perform public.set_auth_ban(p_target_user_id, true);');
    if v_new = v_def then raise exception 'apply_account_restriction layout not recognised'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef('public.lift_account_restriction(character varying)'::regprocedure) into v_def;
  if position('set_auth_ban' in v_def) = 0 then
    v_new := replace(v_def,
      E'update public.users set account_status = ''active'' where id = v_restriction.user_id and account_status = ''suspended'';',
      E'update public.users set account_status = ''active'' where id = v_restriction.user_id and account_status = ''suspended'';\n    perform public.set_auth_ban(v_restriction.user_id, false);');
    if v_new = v_def then raise exception 'lift_account_restriction layout not recognised'; end if;
    execute v_new;
  end if;
end $$;
