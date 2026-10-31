-- Maximum job expiry: how far in the future a vacancy's application deadline may be.
--
-- Before: nothing limited the deadline, so a vacancy could stay open for years (or until 2099).
-- Now: a platform setting (max_job_days, default 90, allowed 7..365) that the DATABASE enforces, so it cannot be
-- bypassed from the app or the API. The check runs when a vacancy is created, when its deadline changes, or when it
-- is published again; unrelated edits to an older vacancy are never blocked, and platform administrators may
-- override. Idempotent. The previous settings function is replaced with one that also accepts max_job_days.

-- 0. FIX for databases that already ran 20261026100000: its suspended-account policy on platform_settings called
--    is_account_suspended(), which signed-in users may no longer execute (20261012190000). Every signed-in READ of
--    platform_settings therefore failed with "permission denied for function is_account_suspended", so signed-in people
--    never received the announcement banner, exchange rate, extra industries or the expiry limit (anonymous visitors
--    were unaffected). Re-point the policy to the self-only wrapper every other table uses. Safe to re-run.
drop policy if exists "restrict_suspended_accounts" on public.platform_settings;
create policy "restrict_suspended_accounts" on public.platform_settings
  as restrictive for all to authenticated
  using ((select not public.current_account_suspended())) with check ((select not public.current_account_suspended()));

-- Effective cap: the admin's setting if present, else 90 days.
-- SECURITY DEFINER so the rule works for every employer regardless of their own table permissions.
create or replace function public.platform_max_job_days()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select (value #>> '{}')::integer from public.platform_settings
      where key = 'max_job_days' and jsonb_typeof(value) = 'number'),
    90);
$$;
revoke all on function public.platform_max_job_days() from public, anon;
grant execute on function public.platform_max_job_days() to authenticated, service_role;

create or replace function public.enforce_max_job_expiry()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max integer;
begin
  if new.application_deadline is null then
    return new;
  end if;
  -- Unrelated edits (title, description, closing, moderation...) are never blocked by the cap.
  if tg_op = 'UPDATE'
     and new.application_deadline is not distinct from old.application_deadline
     and not (new.status = 'published' and old.status is distinct from 'published') then
    return new;
  end if;
  if public.is_platform_admin(auth.uid()::character varying) then
    return new;
  end if;

  v_max := public.platform_max_job_days();
  if new.application_deadline > now() + make_interval(days => v_max) then
    raise exception 'The application deadline can be at most % days from today (no later than %). Choose an earlier date.',
      v_max, to_char((now() + make_interval(days => v_max)) at time zone 'utc', 'YYYY-MM-DD')
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_max_job_expiry on public.opportunities;
create trigger trg_enforce_max_job_expiry
  before insert or update on public.opportunities
  for each row execute function public.enforce_max_job_expiry();

create or replace function public.admin_set_platform_setting(p_key character varying, p_value jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
  v_item jsonb;
  v_names text[] := '{}';
  v_name text;
begin
  v_uid := public.assert_platform_admin();

  if p_key = 'announcement' then
    -- "is distinct from" so a missing field fails the check instead of evaluating to NULL and slipping through.
    if jsonb_typeof(p_value) is distinct from 'object'
       or jsonb_typeof(p_value -> 'enabled') is distinct from 'boolean'
       or jsonb_typeof(p_value -> 'message') is distinct from 'string' then
      raise exception 'announcement must be {"enabled": boolean, "message": text}.' using errcode = '22023';
    end if;
    if char_length(p_value ->> 'message') > 300
       or ((p_value ->> 'enabled')::boolean and char_length(btrim(p_value ->> 'message')) = 0) then
      raise exception 'announcement message must be up to 300 characters and is required when the announcement is enabled.' using errcode = '22023';
    end if;
    p_value := jsonb_build_object('enabled', (p_value ->> 'enabled')::boolean, 'message', btrim(p_value ->> 'message'));
  elsif p_key = 'usd_to_lrd' then
    if jsonb_typeof(p_value) is distinct from 'number' then
      raise exception 'usd_to_lrd must be a number between 50 and 1000.' using errcode = '22023';
    end if;
    if (p_value #>> '{}')::numeric < 50 or (p_value #>> '{}')::numeric > 1000 then
      raise exception 'usd_to_lrd must be a number between 50 and 1000.' using errcode = '22023';
    end if;
  elsif p_key = 'max_job_days' then
    if jsonb_typeof(p_value) is distinct from 'number' or (p_value #>> '{}') !~ '^[0-9]+$' then
      raise exception 'max_job_days must be a whole number of days between 7 and 365.' using errcode = '22023';
    end if;
    if (p_value #>> '{}')::integer < 7 or (p_value #>> '{}')::integer > 365 then
      raise exception 'max_job_days must be a whole number of days between 7 and 365.' using errcode = '22023';
    end if;
  elsif p_key = 'extra_industries' then
    if jsonb_typeof(p_value) is distinct from 'array' then
      raise exception 'extra_industries must be a list of names.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_value) > 50 then
      raise exception 'extra_industries may hold at most 50 names.' using errcode = '22023';
    end if;
    for v_item in select e from jsonb_array_elements(p_value) e loop
      if jsonb_typeof(v_item) is distinct from 'string' then
        raise exception 'extra_industries entries must be text.' using errcode = '22023';
      end if;
      v_name := btrim(v_item #>> '{}');
      if char_length(v_name) < 2 or char_length(v_name) > 60 then
        raise exception 'Industry names must be 2 to 60 characters.' using errcode = '22023';
      end if;
      if lower(v_name) = any (v_names) then
        raise exception 'Duplicate industry "%".', v_name using errcode = '22023';
      end if;
      v_names := v_names || lower(v_name);
    end loop;
    p_value := (select coalesce(jsonb_agg(btrim(e #>> '{}')), '[]'::jsonb) from jsonb_array_elements(p_value) e);
  else
    raise exception 'Unknown setting %.', p_key using errcode = '22023';
  end if;

  insert into public.platform_settings (key, value, updated_by_user_id, updated_at)
  values (p_key, p_value, v_uid, now())
  on conflict (key) do update
    set value = excluded.value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now();

  perform public.admin_write_audit(v_uid, 'platform_setting.update', 'platform_setting', p_key,
    jsonb_build_object('value', p_value));
end;
$$;
revoke all on function public.admin_set_platform_setting(character varying, jsonb) from public, anon;
grant execute on function public.admin_set_platform_setting(character varying, jsonb) to authenticated;
