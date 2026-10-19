-- =====================================================================
-- F-22 (Medium): enforcement status of ANY account was queryable.
--
-- is_account_suspended(p_uid) and has_active_restriction(p_uid, p_type)
-- (20261012150000) are SECURITY DEFINER and were EXECUTE-able by every
-- signed-in user, so `select is_account_suspended('<any uuid>')` revealed
-- whether another account is suspended / restricted (the account_restrictions
-- table itself is only readable by its owner and admins). Reproduced.
--
-- Redesign:
--   * NEW self-only wrappers, which take no user id:
--       current_account_suspended()          -> boolean, about auth.uid() only
--       current_has_restriction(p_type)      -> boolean, about auth.uid() only
--     All restrictive RLS policies now call these.
--   * EXECUTE on the parameterised helpers is REVOKED from authenticated/anon.
--     They remain usable by the SECURITY DEFINER functions that call them
--     (assert_account_active, ...) because those run as the function owner.
--   * assert_account_active(p_action) is self-only already (uses auth.uid()).
-- A user can still see their own status through their own users row, their own
-- account_restrictions rows, and the two wrappers; admins keep full access
-- through the existing account_restrictions policy and the apply/lift RPCs.
--
-- ROLLBACK: re-point the policies to the parameterised helpers (re-run the DO
-- blocks of 20261012150000) and GRANT EXECUTE on them back to authenticated;
-- drop the two wrappers.
-- =====================================================================
create or replace function public.current_account_suspended()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.is_account_suspended(auth.uid()::varchar);
$$;

create or replace function public.current_has_restriction(p_type varchar)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.has_active_restriction(auth.uid()::varchar, p_type);
$$;

revoke all on function public.current_account_suspended() from public, anon;
revoke all on function public.current_has_restriction(varchar) from public, anon;
grant execute on function public.current_account_suspended() to authenticated;
grant execute on function public.current_has_restriction(varchar) to authenticated;

-- Re-point every restrictive policy to the self-only wrappers.
do $$
declare
  t text;
  r record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('users', 'account_restrictions')
  loop
    execute format('drop policy if exists "restrict_suspended_accounts" on public.%I', t);
    execute format(
      'create policy "restrict_suspended_accounts" on public.%I as restrictive for all to authenticated '
      'using ((select not public.current_account_suspended())) with check ((select not public.current_account_suspended()))', t);
  end loop;

  for r in select * from (values
      ('opportunities',          'posting_disabled'),
      ('business_listings',      'posting_disabled'),
      ('applications',           'applications_disabled'),
      ('direct_messages',        'messaging_disabled'),
      ('business_inquiries',     'messaging_disabled'),
      ('business_access_requests','deal_room_disabled')
    ) as v(tbl, rtype)
  loop
    execute format('drop policy if exists %I on public.%I', 'restrict_action_' || r.rtype, r.tbl);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      'with check ((select not public.current_has_restriction(%L)))',
      'restrict_action_' || r.rtype, r.tbl, r.rtype);
  end loop;
end $$;

drop policy if exists "restrict_suspended_accounts_update" on public.users;
create policy "restrict_suspended_accounts_update" on public.users as restrictive for update to authenticated
  using ((select not public.current_account_suspended())) with check ((select not public.current_account_suspended()));
drop policy if exists "restrict_suspended_accounts_delete" on public.users;
create policy "restrict_suspended_accounts_delete" on public.users as restrictive for delete to authenticated
  using ((select not public.current_account_suspended()));
drop policy if exists "restrict_suspended_accounts_insert" on public.users;
create policy "restrict_suspended_accounts_insert" on public.users as restrictive for insert to authenticated
  with check ((select not public.current_account_suspended()));

revoke execute on function public.is_account_suspended(varchar) from authenticated;
revoke execute on function public.has_active_restriction(varchar, varchar) from authenticated;
