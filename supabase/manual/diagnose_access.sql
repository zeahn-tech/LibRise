-- READ-ONLY diagnostic. Paste into the Supabase SQL editor and run; send back the result rows.
with expected(name) as (values
  ('create_organization_with_owner'),('get_organization_private_fields'),('priority_organization_ids'),
  ('record_opportunity_view'),('list_business_listings_public'),('get_business_listing_public'),
  ('assert_account_active'),('has_org_permission'),('is_org_member'),('is_platform_admin'),('org_effective_tier'))
select 'missing_function' as k, e.name as v from expected e
 where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=e.name)
union all
select 'duplicate_function', proname||' x'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' group by proname having count(*)>1
union all
select 'authenticated_cannot_execute', p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.prorettype<>'trigger'::regtype
   and not has_function_privilege('authenticated', p.oid, 'execute')
union all
select 'anon_cannot_execute_public_fn', p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('list_business_listings_public','get_business_listing_public','priority_organization_ids','record_opportunity_view')
   and not has_function_privilege('anon', p.oid, 'execute')
union all
select 'table_select_priv', t||': anon='||has_table_privilege('anon','public.'||t,'select')::text||' authenticated='||has_table_privilege('authenticated','public.'||t,'select')::text
 from unnest(array['opportunities','business_listings','applications','organization_memberships','users']) t
union all
select 'organizations_column_priv', 'anon id='||has_column_privilege('anon','public.organizations','id','select')::text||
  ' name='||has_column_privilege('anon','public.organizations','name','select')::text||
  ' authenticated id='||has_column_privilege('authenticated','public.organizations','id','select')::text
union all
select 'recent_org', id||' | '||name||' | '||created_at::text from (select * from public.organizations order by created_at desc limit 5) o
union all
select 'recent_membership', organization_id||' | '||org_role||' | '||status from (select * from public.organization_memberships order by created_at desc limit 5) m
union all
select 'role_count', primary_role||': '||count(*)::text from public.users group by primary_role;
