-- Bans must be a real date, never 'infinity'.
--
-- Problem: set_auth_ban() wrote banned_until = 'infinity'. The sign-in service (GoTrue) cannot read an infinite
-- timestamp: every time it loads a banned account's row it fails with "Database error querying schema" (sign-in) or
-- "Database error finding user" (sign-up with that email), and it cannot delete that user either ("Database error
-- deleting user"). So suspended accounts, and accounts deleted through the self-service flow, left rows that
-- broke sign-in and registration for that email address.
--
-- Fix:
--   1. set_auth_ban() now bans until now() + 100 years (the same length the server's own ban uses, 876000h). Each ban
--      gets its own value, which the ownership bookkeeping records exactly, so that logic is unchanged.
--   2. Existing 'infinity' bans (and the ownership records that point at them) are converted in place.
--   3. Accounts that were deleted through the app but whose sign-in row is still there (because it could not be
--      removed while banned forever) are removed now, which also frees their email address again.
-- Idempotent.

drop function if exists public.set_auth_ban(varchar, boolean);
create function public.set_auth_ban(p_uid varchar, p_ban boolean)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_errors text[] := '{}';
  v_rows integer;
  v_left integer;
begin
  begin
    if p_ban then
      update auth.users set banned_until = (now() + interval '100 years')
      where id = p_uid::uuid and (banned_until is null or banned_until <= now());
    else
      update auth.users set banned_until = null where id = p_uid::uuid;
    end if;
    get diagnostics v_rows = row_count;
    if v_rows = 0 and not exists (select 1 from auth.users where id = p_uid::uuid) then
      return 'no_auth_user';
    end if;
  exception when others then
    v_errors := v_errors || ('ban: ' || sqlerrm);
  end;

  if p_ban then
    begin
      delete from auth.sessions where user_id = p_uid::uuid;
    exception when others then
      v_errors := v_errors || ('sessions: ' || sqlerrm);
    end;
    begin
      delete from auth.refresh_tokens where user_id = p_uid;
    exception when others then
      v_errors := v_errors || ('refresh_tokens: ' || sqlerrm);
    end;
  end if;

  begin
    if p_ban then
      if not exists (select 1 from auth.users where id = p_uid::uuid and banned_until is not null and banned_until > now()) then
        v_errors := v_errors || 'verify: banned_until is not in effect';
      end if;
      select (select count(*) from auth.sessions where user_id = p_uid::uuid)
           + (select count(*) from auth.refresh_tokens where user_id = p_uid) into v_left;
      if v_left > 0 then
        v_errors := v_errors || ('verify: ' || v_left || ' session/refresh-token row(s) remain');
      end if;
    elsif exists (select 1 from auth.users where id = p_uid::uuid and banned_until is not null) then
      v_errors := v_errors || 'verify: banned_until was not cleared';
    end if;
  exception when others then
    v_errors := v_errors || ('verify: ' || sqlerrm);
  end;

  if array_length(v_errors, 1) is null then
    return 'ok';
  end if;
  return 'failed: ' || array_to_string(v_errors, '; ');
end;
$$;
revoke all on function public.set_auth_ban(varchar, boolean) from public, anon, authenticated;

-- 2. Convert existing infinite bans (ownership records first, while the auth rows still match them).
do $$
declare
  v_new timestamptz := now() + interval '100 years';
begin
  update public.account_auth_enforcement e
     set imposed_banned_until = v_new
   where e.imposed_banned_until = 'infinity'
     and exists (select 1 from auth.users u where u.id::text = e.user_id and u.banned_until = 'infinity');

  update auth.users set banned_until = v_new where banned_until = 'infinity';
end;
$$;

-- 3. Finish deletions that could not complete: remove the sign-in row of any account already deleted in the app
--    (its public.users row stays as the anonymised record). Cascades to identities, sessions and tokens.
delete from auth.users u
 using public.users p
 where p.id = u.id::text
   and p.deleted_at is not null;
