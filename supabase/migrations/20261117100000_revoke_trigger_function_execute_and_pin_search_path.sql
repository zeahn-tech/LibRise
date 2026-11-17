-- Trigger-only SECURITY DEFINER functions were executable by anon/authenticated through /rest/v1/rpc.
-- Trigger firing does not check EXECUTE, so revoking is safe. Also pin search_path on three functions
-- flagged by the Supabase security advisor (function_search_path_mutable).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

alter function public.tier_limits(varchar) set search_path to 'public', 'pg_temp';
alter function public._lr_skill_names(jsonb) set search_path to 'public', 'pg_temp';
alter function public.sync_organization_verified_flag() set search_path to 'public', 'pg_temp';
