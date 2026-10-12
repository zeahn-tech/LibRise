insert into public.users (id,email,full_name,primary_role,system_role,account_status) values
 ('11111111-aaaa-4000-8000-000000000001','owner@acme.test','Owner','employer','user','active'),
 ('11111111-aaaa-4000-8000-000000000002','other@acme.test','Other','job_seeker','user','active'),
 ('11111111-aaaa-4000-8000-000000000003','admin@plat.test','Admin','platform_admin','platform_admin','active') on conflict do nothing;
insert into public.organizations (id,slug,name,type,industry,county,city_district,description,tax_id_number,contact_email,registration_number)
 values ('org-http','org-http','HTTP Org','private_company','x','Montserrado','Monrovia','d','TIN-SECRET','secret@acme.test','REG-SECRET') on conflict do nothing;
insert into public.organization_memberships (id,organization_id,user_id,org_role,status) values ('m-http','org-http','11111111-aaaa-4000-8000-000000000001','owner','active') on conflict do nothing;
insert into public.users (id,email,full_name,primary_role,system_role,account_status) values
 ('11111111-aaaa-4000-8000-000000000004','susp@acme.test','Suspended','employer','user','suspended'),
 ('11111111-aaaa-4000-8000-000000000005','adm2@acme.test','Org Admin','recruiter','user','active') on conflict do nothing;
insert into public.organization_memberships (id,organization_id,user_id,org_role,status) values ('m-http-adm','org-http','11111111-aaaa-4000-8000-000000000005','admin','active') on conflict do nothing;
