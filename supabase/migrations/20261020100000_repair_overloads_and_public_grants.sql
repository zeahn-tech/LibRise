-- Repair for databases that drifted from the migration history.
--
-- Symptoms this fixes on the public home page (before sign-in):
--   * PGRST203 "Could not choose the best candidate function": the pre-pagination
--     3-argument list_business_listings_public(text,text,text) still exists beside
--     the current 5-argument one, so PostgREST cannot pick between them.
--   * "permission denied for function/table ..." for guests: the few functions that
--     the public pages call as `anon` lost their EXECUTE grant.
-- Idempotent: safe to run more than once. Touches only the named functions.

drop function if exists public.list_business_listings_public(text, text, text);

do $$
declare r record;
begin
  -- Functions the public (signed-out) pages call. Every overload by name.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'list_business_listings_public',
        'get_business_listing_public',
        'priority_organization_ids',
        'record_opportunity_view'
      )
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;

-- Diagnostic (read-only): any remaining duplicate public function names.
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' group by proname having count(*) > 1;
