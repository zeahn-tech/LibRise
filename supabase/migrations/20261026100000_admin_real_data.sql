-- Admin dashboard: replace placeholder/sample data with real database-backed features.
--
--  1. platform_settings          -- public-safe site settings, written ONLY through admin_set_platform_setting
--                                   (announcement banner, USD->LRD display rate, extra business industries)
--  2. Job moderation             -- admin_moderate_opportunity now records a reason, who/when, and notifies the
--                                   employer; approving no longer force-publishes drafts
--  3. admin_platform_metrics     -- analytics: totals, daily series, county distribution, revenue, queues (real data)
--  4. admin_revenue_overview / admin_list_payments -- revenue and payments ledger from public.payments
--  5. admin_list_subscriptions / admin_set_subscription -- real plan view + admin grant (replaces a local-only toggle)
--  6. admin_log_action           -- server-side audit entry for verification/report decisions made in the admin UI
--
-- Idempotent. All admin RPCs are SECURITY DEFINER and refuse anyone who is not a platform administrator.

-- 1. platform_settings ---------------------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key varchar(100) primary key,
  value jsonb not null,
  updated_by_user_id varchar(100) references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;

-- Every key is public-safe by construction (the write RPC only accepts the keys below), so reads are open.
drop policy if exists "Anyone can read platform settings" on public.platform_settings;
create policy "Anyone can read platform settings"
  on public.platform_settings for select
  to anon, authenticated
  using (true);

-- Read-only for everyone; written only by admin_set_platform_setting (SECURITY DEFINER).
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to anon, authenticated;

-- Suspended accounts are blocked on every RLS table (repo-wide invariant, see 20261012150000_enforce_account_status).
drop policy if exists "restrict_suspended_accounts" on public.platform_settings;
create policy "restrict_suspended_accounts" on public.platform_settings
  as restrictive for all to authenticated
  using ((select not public.is_account_suspended())) with check ((select not public.is_account_suspended()));

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

-- 2. Job moderation ------------------------------------------------------------------------------------------
alter table public.opportunities
  add column if not exists moderation_note text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by_user_id character varying;

drop function if exists public.admin_moderate_opportunity(character varying, character varying);

create or replace function public.admin_moderate_opportunity(
  p_id character varying, p_status character varying, p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
  v_org character varying;
  v_title character varying;
  v_old_status character varying;
  v_old_mod character varying;
  v_new_status character varying;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_notify boolean;
  v_title_msg text;
  v_body text;
begin
  v_uid := public.assert_platform_admin();
  if p_status not in ('published','pending_review','flagged','quarantined','rejected') then
    raise exception 'Unknown moderation status %.', p_status using errcode = '22023';
  end if;
  if p_status in ('quarantined','rejected') and (v_note is null or char_length(v_note) < 5) then
    raise exception 'A reason of at least 5 characters is required to quarantine or reject a vacancy.' using errcode = '22023';
  end if;

  select organization_id, title, status, coalesce(moderation_status, 'published')
    into v_org, v_title, v_old_status, v_old_mod
    from public.opportunities where id = p_id for update;
  if not found then
    raise exception 'Opportunity % not found.', p_id using errcode = '02000';
  end if;

  v_new_status := case
    -- Restoring something we hid, or clearing a review hold, puts it back live. Drafts/closed vacancies stay as they are.
    when p_status = 'published' and v_old_mod in ('quarantined','rejected') and v_old_status = 'archived' then 'published'
    when p_status = 'published' and v_old_status = 'pending_review' then 'published'
    when p_status in ('quarantined','rejected') then 'archived'
    else v_old_status
  end;

  update public.opportunities
     set moderation_status = p_status,
         status = v_new_status,
         moderation_note = case when p_status = 'published' then coalesce(v_note, moderation_note) else v_note end,
         moderated_at = now(),
         moderated_by_user_id = v_uid,
         updated_at = now()
   where id = p_id;

  perform public.admin_write_audit(v_uid, 'opportunity.moderate', 'opportunity', p_id,
    jsonb_build_object('previousModeration', v_old_mod, 'nextStatus', p_status, 'previousStatus', v_old_status,
                       'resultingStatus', v_new_status, 'note', v_note), v_org);

  v_notify := (p_status in ('quarantined','rejected')) or (p_status = 'published' and v_old_mod <> 'published');
  if v_notify then
    v_title_msg := case p_status
      when 'published' then 'Your vacancy was approved'
      when 'quarantined' then 'Your vacancy was removed for review'
      else 'Your vacancy was rejected' end;
    v_body := case p_status
      when 'published' then format('"%s" passed moderation and is visible again.', v_title)
      when 'quarantined' then format('"%s" was taken down by a platform moderator. Reason: %s', v_title, v_note)
      else format('"%s" was rejected by a platform moderator. Reason: %s', v_title, v_note) end;
    insert into public.notifications (id, recipient_user_id, category, title, message, action_url, context_id)
    select 'ntf-' || substr(md5(random()::text || clock_timestamp()::text || m.user_id), 1, 16),
           m.user_id, 'system_alert', v_title_msg, v_body, '/recruiter', p_id
      from public.organization_memberships m
     where m.organization_id = v_org and m.status = 'active' and m.org_role in ('owner','admin');
  end if;
end;
$$;
revoke all on function public.admin_moderate_opportunity(character varying, character varying, text) from public, anon;
grant execute on function public.admin_moderate_opportunity(character varying, character varying, text) to authenticated;

-- 3. Analytics -------------------------------------------------------------------------------------------------
create or replace function public.admin_platform_metrics(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_today date := (now() at time zone 'utc')::date;
  v_result jsonb;
begin
  perform public.assert_platform_admin();

  v_result := jsonb_build_object(
    'generatedAt', now(),
    'days', v_days,
    'totals', jsonb_build_object(
      'users', (select count(*) from public.users),
      'organizations', (select count(*) from public.organizations),
      'opportunities', (select count(*) from public.opportunities),
      'publishedOpportunities', (select count(*) from public.opportunities where status = 'published'),
      'businessListings', (select count(*) from public.business_listings),
      'applications', (select count(*) from public.applications),
      'auditEvents', (select count(*) from public.audit_logs)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(d, 'YYYY-MM-DD'),
        'opportunities', (select count(*) from public.opportunities o where (o.created_at at time zone 'utc')::date = d),
        'applications', (select count(*) from public.applications a where (a.applied_at at time zone 'utc')::date = d),
        'signups', (select count(*) from public.users u where (u.created_at at time zone 'utc')::date = d)
      ) order by d), '[]'::jsonb)
      from (select (v_today - g)::date as d from generate_series(0, v_days - 1) g) days
    ),
    'counties', (
      select coalesce(jsonb_agg(jsonb_build_object('county', county, 'count', c) order by c desc, county), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(county), ''), 'Unspecified') as county, count(*) as c
          from public.opportunities where status = 'published'
         group by 1 order by 2 desc, 1 limit 10
      ) t
    ),
    'revenue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'currency', currency,
        'currentPeriodMinor', cur, 'previousPeriodMinor', prev, 'allTimeMinor', total, 'paymentsCount', n
      ) order by currency), '[]'::jsonb)
      from (
        select currency,
               coalesce(sum(amount_minor) filter (where ts >= now() - make_interval(days => v_days)), 0) as cur,
               coalesce(sum(amount_minor) filter (where ts >= now() - make_interval(days => 2 * v_days)
                                                    and ts < now() - make_interval(days => v_days)), 0) as prev,
               coalesce(sum(amount_minor), 0) as total,
               count(*) as n
          from (select currency, amount_minor, coalesce(paid_at, reviewed_at, created_at) as ts
                  from public.payments where status = 'payment_success') s
         group by currency
      ) r
    ),
    'queues', jsonb_build_object(
      'paymentsAwaitingReview', (select count(*) from public.payments where status = 'payment_pending'),
      'verificationPending', (select count(*) from public.verification_requests where status = 'pending_review'),
      'reportsOpen', (select count(*) from public.content_reports where status = 'pending'),
      'vacanciesNeedingReview', (select count(*) from public.opportunities where moderation_status in ('pending_review','flagged')),
      'vacanciesQuarantined', (select count(*) from public.opportunities where moderation_status = 'quarantined')
    )
  );
  return v_result;
end;
$$;
revoke all on function public.admin_platform_metrics(integer) from public, anon;
grant execute on function public.admin_platform_metrics(integer) to authenticated;

-- 4. Revenue and payments ledger ----------------------------------------------------------------------------
create or replace function public.admin_revenue_overview(p_months integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_months integer := least(greatest(coalesce(p_months, 6), 1), 24);
begin
  perform public.assert_platform_admin();
  return jsonb_build_object(
    'generatedAt', now(),
    'totals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'currency', currency,
        'confirmedMinor', confirmed_minor, 'confirmedCount', confirmed_count,
        'awaitingMinor', awaiting_minor, 'awaitingCount', awaiting_count,
        'failedCount', failed_count, 'expiredCount', expired_count
      ) order by currency), '[]'::jsonb)
      from (
        select currency,
               coalesce(sum(amount_minor) filter (where status = 'payment_success'), 0) as confirmed_minor,
               count(*) filter (where status = 'payment_success') as confirmed_count,
               coalesce(sum(amount_minor) filter (where status = 'payment_pending'), 0) as awaiting_minor,
               count(*) filter (where status = 'payment_pending') as awaiting_count,
               count(*) filter (where status = 'payment_failed') as failed_count,
               count(*) filter (where status = 'payment_expired') as expired_count
          from public.payments group by currency
      ) t
    ),
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'currency', currency, 'confirmedMinor', minor)
                                order by m, currency), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', ts at time zone 'utc'), 'YYYY-MM') as m, currency, sum(amount_minor) as minor
          from (select currency, amount_minor, coalesce(paid_at, reviewed_at, created_at) as ts
                  from public.payments where status = 'payment_success') s
         where ts >= date_trunc('month', now()) - make_interval(months => v_months - 1)
         group by 1, 2
      ) x
    )
  );
end;
$$;
revoke all on function public.admin_revenue_overview(integer) from public, anon;
grant execute on function public.admin_revenue_overview(integer) to authenticated;

create or replace function public.admin_list_payments(p_limit integer default 500)
returns table (
  id character varying, public_payment_id character varying,
  organization_id character varying, organization_name character varying,
  plan_id character varying, plan_name character varying,
  payment_provider character varying, provider_transaction_id character varying, sender_phone_number character varying,
  amount_minor integer, currency character varying, status character varying, failure_reason text,
  created_at timestamptz, paid_at timestamptz, reviewed_at timestamptz, reviewed_by_name character varying
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.assert_platform_admin();
  return query
    select p.id, p.public_payment_id, p.organization_id, o.name, p.plan_id, pl.name,
           p.payment_provider, p.provider_transaction_id, p.sender_phone_number,
           p.amount_minor, p.currency, p.status, p.failure_reason,
           p.created_at, p.paid_at, p.reviewed_at, u.full_name
      from public.payments p
      left join public.organizations o on o.id = p.organization_id
      left join public.payment_plans pl on pl.id = p.plan_id
      left join public.users u on u.id = p.reviewed_by_user_id
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;
revoke all on function public.admin_list_payments(integer) from public, anon;
grant execute on function public.admin_list_payments(integer) to authenticated;

-- 5. Subscriptions -------------------------------------------------------------------------------------------
create or replace function public.admin_list_subscriptions()
returns table (
  organization_id character varying, organization_name character varying, industry character varying,
  tier character varying, plan_id character varying, status character varying, billing_cycle character varying,
  current_period_end timestamptz, cancel_at_period_end boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.assert_platform_admin();
  return query
    select o.id, o.name, o.industry,
           coalesce(s.tier, 'free'), coalesce(s.plan_id, 'plan_free'), coalesce(s.status, 'active'),
           coalesce(s.billing_cycle, 'monthly'), s.current_period_end, coalesce(s.cancel_at_period_end, false)
      from public.organizations o
      left join public.organization_subscriptions s on s.organization_id = o.id
     order by o.name
     limit 5000;
end;
$$;
revoke all on function public.admin_list_subscriptions() from public, anon;
grant execute on function public.admin_list_subscriptions() to authenticated;

create or replace function public.admin_set_subscription(
  p_organization_id character varying, p_tier character varying, p_days integer default 30
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying;
  v_org_name character varying;
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_prev character varying;
begin
  v_uid := public.assert_platform_admin();
  if p_tier not in ('free','basic','pro') then
    raise exception 'Unknown plan tier %.', p_tier using errcode = '22023';
  end if;
  select name into v_org_name from public.organizations where id = p_organization_id;
  if not found then
    raise exception 'Organization % not found.', p_organization_id using errcode = '02000';
  end if;
  select tier into v_prev from public.organization_subscriptions where organization_id = p_organization_id;

  insert into public.organization_subscriptions
    (id, organization_id, plan_id, tier, status, billing_cycle, current_period_start, current_period_end, cancel_at_period_end)
  values ('sub-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), p_organization_id,
          'plan_' || p_tier, p_tier, 'active', 'monthly', now(),
          now() + make_interval(days => case when p_tier = 'free' then 36500 else v_days end), false)
  on conflict (organization_id) do update
    set plan_id = excluded.plan_id, tier = excluded.tier, status = 'active',
        current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
        cancel_at_period_end = false, updated_at = now();

  perform public.admin_write_audit(v_uid, 'subscription.admin_set', 'subscription', p_organization_id,
    jsonb_build_object('previousTier', coalesce(v_prev, 'free'), 'nextTier', p_tier, 'days', v_days), p_organization_id);

  insert into public.notifications (id, recipient_user_id, category, title, message, action_url, context_id)
  select 'ntf-' || substr(md5(random()::text || clock_timestamp()::text || m.user_id), 1, 16),
         m.user_id, 'subscription_event', 'Your plan was updated',
         format('A platform administrator set %s to the %s plan.', v_org_name, p_tier), '/billing', p_organization_id
    from public.organization_memberships m
   where m.organization_id = p_organization_id and m.status = 'active' and m.org_role in ('owner','admin');
end;
$$;
revoke all on function public.admin_set_subscription(character varying, character varying, integer) from public, anon;
grant execute on function public.admin_set_subscription(character varying, character varying, integer) to authenticated;

-- 6. Server-side audit entry for decisions made in the admin UI ----------------------------------------------
create or replace function public.admin_log_action(
  p_action character varying, p_resource_type character varying, p_resource_id character varying, p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid character varying := auth.uid()::character varying;
begin
  perform public.assert_account_active();
  if v_uid is null or not exists (
    select 1 from public.users u
     where u.id = v_uid and coalesce(u.account_status, 'active') = 'active'
       and (u.system_role in ('platform_admin','verifier','verification_officer','moderator') or u.primary_role = 'platform_admin')
  ) then
    raise exception 'Only platform staff may record admin actions.' using errcode = '42501';
  end if;
  if p_action not in ('verification.request_decision', 'report.resolve') then
    raise exception 'Unsupported audit action %.', p_action using errcode = '22023';
  end if;
  perform public.admin_write_audit(v_uid, p_action, p_resource_type, p_resource_id, p_details);
end;
$$;
revoke all on function public.admin_log_action(character varying, character varying, character varying, jsonb) from public, anon;
grant execute on function public.admin_log_action(character varying, character varying, character varying, jsonb) to authenticated;
