-- ---------------------------------------------------------------------
-- AI job-match notifications.
--
-- When a job or internship becomes PUBLISHED, notify the candidates whose
-- profile matches it ("AI Match: <title>" in their notification panel).
--
-- Why this lives in the database (a trigger) and not in the employer's app:
--   * Candidate profiles are deliberately only readable through the audited,
--     privacy-aware RPCs (get_public_candidate_profile / search_...). The
--     employer's browser must never pull candidate rows to work out who
--     matches. Here the candidate data never leaves the database: this
--     function only INSERTS a notification for each match and returns a
--     COUNT, so nothing about any candidate is revealed to the poster.
--   * A trigger on opportunities.status covers EVERY way a job goes live:
--     direct publish, create-as-published, and admin payment approval
--     (admin_review_payment() flips the status inside the database, so the
--     client never gets a chance to run any code).
--
-- Matching (transparent, deterministic, explainable -- no model call):
--   score = 60% share of the job's required skills the candidate lists
--         + 25% same county
--         + 15% candidate headline mentions a word from the job title.
--   A candidate is notified when they share >= 1 required skill (or match
--   BOTH county and title) AND score >= 30.
--
-- Spam / safety guards:
--   * at most 25 candidates per job, best matches first
--   * never the poster, never members of the posting organization, never
--     someone who already applied
--   * never twice for the same job (de-duplicated per recipient + job, so
--     unpublish -> republish does not re-notify)
--   * a failure here can never block publishing (trigger swallows errors)
--   * the matching function cannot be called by app users: EXECUTE is
--     revoked, only the trigger (owner context) runs it
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------

-- Normalise a skills array that may hold strings ("Welding") or objects
-- ({"name":"Welding","level":"expert"}) into distinct lowercase names.
create or replace function public._lr_skill_names(p_skills jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct q.s) filter (where q.s <> ''), '{}'::text[])
  from (
    select lower(trim(case jsonb_typeof(e)
                        when 'string' then e #>> '{}'
                        when 'object' then e ->> 'name'
                        else ''
                      end)) as s
    from jsonb_array_elements(
           case when jsonb_typeof(p_skills) = 'array' then p_skills else '[]'::jsonb end
         ) e
  ) q
$$;

create or replace function public.notify_matching_candidates(p_opportunity_id character varying)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c_max_notifications constant integer := 25;
  c_min_score constant integer := 30;
  v_opp record;
  v_req text[];
  v_words text[];
  v_sent integer := 0;
  r record;
begin
  select o.id, o.title, o.county, o.opportunity_type, o.status,
         o.organization_id, o.created_by_user_id, o.skills_required
    into v_opp
    from public.opportunities o
   where o.id = p_opportunity_id;

  if not found
     or v_opp.status <> 'published'
     or v_opp.opportunity_type not in ('job', 'internship') then
    return 0;
  end if;

  v_req := public._lr_skill_names(v_opp.skills_required);

  select coalesce(array_agg(distinct w), '{}'::text[])
    into v_words
    from unnest(regexp_split_to_array(lower(v_opp.title), '[^a-z0-9]+')) w
   where length(w) >= 4;

  for r in
    select cp.user_id, x.score
      from public.candidate_profiles cp
     cross join lateral (select public._lr_skill_names(cp.skills_json) as skills) s
     cross join lateral (
       select
         (select count(*)
            from unnest(v_req) rq
           where exists (
             select 1 from unnest(s.skills) sk
              where sk = rq
                 or (length(sk) >= 3 and length(rq) >= 3
                     and (position(rq in sk) > 0 or position(sk in rq) > 0))
           )) as hits,
         (case when lower(coalesce(cp.county, '')) = lower(v_opp.county) then 1 else 0 end) as county_match,
         (case when exists (
                select 1 from unnest(v_words) w
                 where position(w in lower(coalesce(cp.headline, ''))) > 0
              ) then 1 else 0 end) as title_hit
     ) h
     cross join lateral (
       select round(100 * (
                0.6 * (case when cardinality(v_req) > 0 then h.hits::numeric / cardinality(v_req) else 0 end)
              + 0.25 * h.county_match
              + 0.15 * h.title_hit
              ))::integer as score
     ) x
     where cp.user_id <> v_opp.created_by_user_id
       and (h.hits >= 1 or (h.county_match = 1 and h.title_hit = 1))
       and x.score >= c_min_score
       and not exists (
         select 1 from public.organization_memberships m
          where m.user_id = cp.user_id and m.organization_id = v_opp.organization_id
       )
       and not exists (
         select 1 from public.applications a
          where a.opportunity_id = v_opp.id and a.applicant_user_id = cp.user_id
       )
       and not exists (
         select 1 from public.notifications n
          where n.recipient_user_id = cp.user_id
            and n.category = 'job_recommendation'
            and n.context_id = v_opp.id
       )
     order by x.score desc, cp.user_id
     limit c_max_notifications
  loop
    insert into public.notifications
      (id, recipient_user_id, category, title, message, action_url, context_id, delivery_channels)
    values (
      'notif-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text || r.user_id), 1, 4),
      r.user_id,
      'job_recommendation',
      'AI Match: ' || v_opp.title,
      format('New %s matching your profile (%s%% match): %s in %s County.',
             case when v_opp.opportunity_type = 'internship' then 'internship' else 'job' end,
             r.score, v_opp.title, v_opp.county),
      '/opportunities',
      v_opp.id,
      '{"inApp":true,"emailSent":false,"pushSmsSent":false}'::jsonb
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.notify_matching_candidates(character varying) from public, anon, authenticated;
revoke all on function public._lr_skill_names(jsonb) from public, anon, authenticated;

-- Fire when a vacancy first becomes published (insert-as-published, or any
-- later transition into 'published' such as payment approval).
create or replace function public.trg_opportunity_published_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    begin
      perform public.notify_matching_candidates(new.id);
    exception when others then
      -- Notifications are a nice-to-have: never block publishing.
      raise warning 'AI job-match notifications failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_opportunity_published_notify() from public, anon, authenticated;

drop trigger if exists opportunity_published_notify on public.opportunities;
create trigger opportunity_published_notify
  after insert or update of status on public.opportunities
  for each row execute function public.trg_opportunity_published_notify();
