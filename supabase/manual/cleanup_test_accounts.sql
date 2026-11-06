-- LibRise: remove every test account (and its organizations) EXCEPT the 4 below.
-- Run in Supabase -> SQL Editor. Run PART 1 first, check it, then run PART 2.
-- PART 2 is all-or-nothing: if anything fails, nothing is deleted.

-- =====================================================================
-- PART 1: PREVIEW (read-only). Check the KEEP list is exactly your 4 accounts.
-- =====================================================================
with keep as (
  select u.id, u.email from public.users u
  where lower(u.email) in ('info.tracenetlib@gmail.com','chrismoorechamp@gmail.com',
                           'emmanuelzeahn45@gmail.com','ezeahna@gmail.com')
),
keep_orgs as (
  select distinct m.organization_id from public.organization_memberships m
  where m.user_id in (select id from keep)
)
select 'KEEP user' as action, email as detail from keep
union all
select 'KEEP organization', o.name from public.organizations o where o.id in (select organization_id from keep_orgs)
union all
select 'DELETE user', u.email from public.users u where u.id not in (select id from keep)
union all
select 'DELETE organization', o.name from public.organizations o where o.id not in (select organization_id from keep_orgs)
order by 1, 2;

-- =====================================================================
-- PART 2: DELETE (run only after PART 1 looks right)
-- =====================================================================
do $$
declare
  keep_ids  text[];
  keep_orgs text[];
  del_users text[];
  del_orgs  text[];
  fk record;
  n bigint;
begin
  select coalesce(array_agg(id::text), '{}') into keep_ids from public.users
   where lower(email) in ('info.tracenetlib@gmail.com','chrismoorechamp@gmail.com',
                          'emmanuelzeahn45@gmail.com','ezeahna@gmail.com');

  -- Safety stop: all 4 accounts must exist, otherwise the filter is wrong.
  if coalesce(array_length(keep_ids,1),0) <> 4 then
    raise exception 'Expected 4 accounts to keep, found %. Nothing deleted.', coalesce(array_length(keep_ids,1),0);
  end if;

  select coalesce(array_agg(distinct organization_id::text), '{}') into keep_orgs
    from public.organization_memberships where user_id::text = any(keep_ids);

  select coalesce(array_agg(id::text), '{}') into del_users from public.users where id::text <> all(keep_ids);
  select coalesce(array_agg(id::text), '{}') into del_orgs  from public.organizations where id::text <> all(keep_orgs);

  -- The owner-protection triggers would block removing last owners of test orgs.
  alter table public.organization_memberships disable trigger user;
  alter table public.organizations            disable trigger user;

  -- 1. Rows that point at a doomed user/org with a non-cascading foreign key.
  for fk in
    select c.conrelid::regclass as child, a.attname as col, c.confrelid::regclass as parent
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confdeltype in ('r','a')
      and c.confrelid in ('public.users'::regclass, 'public.organizations'::regclass)
      and array_length(c.conkey,1) = 1
      and c.connamespace = 'public'::regnamespace
  loop
    execute format('delete from %s where %I::text = any($1)', fk.child, fk.col)
      using (case when fk.parent = 'public.users'::regclass then del_users else del_orgs end);
  end loop;

  -- 2. Organizations (opportunities, applications, memberships cascade).
  delete from public.organizations where id::text = any(del_orgs);

  -- 3. Users (profiles, memberships, applications, etc. cascade), then logins.
  delete from public.users where id::text = any(del_users);
  delete from auth.users   where id::text = any(del_users);
  get diagnostics n = row_count;

  alter table public.organization_memberships enable trigger user;
  alter table public.organizations            enable trigger user;

  raise notice 'Deleted % users and % organizations. Kept % users, % organizations.',
    coalesce(array_length(del_users,1),0), coalesce(array_length(del_orgs,1),0),
    array_length(keep_ids,1), coalesce(array_length(keep_orgs,1),0);
end $$;

-- Verify afterwards:
-- select email from public.users order by 1;
-- select name from public.organizations order by 1;
