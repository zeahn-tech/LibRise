-- =====================================================================
-- Deal-room authorization matrix (migrations 20261012250000 and 20261012270000).
-- Policy: see the header of 20261012270000_deal_room_hardening.sql. begin/rollback.
-- =====================================================================
begin;
select extensions.no_plan();
create temp table test_log (seq serial primary key, line text);
grant insert, select on test_log to authenticated, anon;
grant usage, select on test_log_seq_seq to authenticated, anon;

-- O owner | B0 buyer, no request | B1 approved | B2 approved but deal_room_disabled | B3 approved but suspended
-- O2 suspended owner | O3 owner with deal_room_disabled | B4 buyer with a pending request to O3 | PA platform admin
insert into public.users (id, email, full_name, phone_number, primary_role, system_role, account_status)
select '0f1f1f1f-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'), 'dr-' || n || '@example.com', 'DR ' || n, '+231-770-900-0' || lpad(n::text, 2, '0'),
       case when n = 20 then 'platform_admin' else 'buyer' end, case when n = 20 then 'platform_admin' else 'user' end,
       case when n in (3, 12) then 'suspended' else 'active' end
from unnest(array[1,2,3,4,5,6,11,12,13,14,20]) n;
-- ids: 01=O 02=B0 03=B3 04=B1 05=B2 06=B4 11=O2? (see below) -- mapping used by the statements:
--   O=01, B0=02, B3=03(suspended), B1=04, B2=05, B4=06, O2=12(suspended), O3=13, PA=20
insert into public.business_listings (id, owner_user_id, title, slug, listing_type, industry, county, city_district, headline, description, status, is_confidential, asking_price_usd, annual_revenue_usd, exact_address, seller_name, seller_contact_email, seller_contact_phone) values
 ('dr-l1', '0f1f1f1f-0000-4000-8000-000000000001', 'DR L1', 'dr-l1', 'business', 'Retail', 'Montserrado', 'S', 'h', 'd', 'published', true, 10, 111111, '1 Vault St', 'Seller', 's@example.com', '+231-1'),
 ('dr-l2', '0f1f1f1f-0000-4000-8000-000000000012', 'DR L2', 'dr-l2', 'business', 'Retail', 'Montserrado', 'S', 'h', 'd', 'published', true, 10, 222222, '2 Vault St', 'Seller2', 's2@example.com', '+231-2'),
 ('dr-l3', '0f1f1f1f-0000-4000-8000-000000000013', 'DR L3', 'dr-l3', 'business', 'Retail', 'Montserrado', 'S', 'h', 'd', 'published', true, 10, 333333, '3 Vault St', 'Seller3', 's3@example.com', '+231-3');
insert into public.business_access_requests (id, listing_id, buyer_user_id, buyer_full_name, buyer_email, status, nda_signed) values
 ('dr-r-b1', 'dr-l1', '0f1f1f1f-0000-4000-8000-000000000004', 'B1', 'dr-4@example.com', 'approved', true),
 ('dr-r-b2', 'dr-l1', '0f1f1f1f-0000-4000-8000-000000000005', 'B2', 'dr-5@example.com', 'approved', true),
 ('dr-r-b3', 'dr-l1', '0f1f1f1f-0000-4000-8000-000000000003', 'B3', 'dr-3@example.com', 'approved', true),
 ('dr-r-b2n', 'dr-l3', '0f1f1f1f-0000-4000-8000-000000000005', 'B2', 'dr-5@example.com', 'pending', false),
 ('dr-r-b4', 'dr-l3', '0f1f1f1f-0000-4000-8000-000000000006', 'B4', 'dr-6@example.com', 'pending', false),
 ('dr-r-pend1', 'dr-l1', '0f1f1f1f-0000-4000-8000-000000000002', 'B0', 'dr-2@example.com', 'pending', false);
insert into public.account_restrictions (id, user_id, user_name, user_email, restriction_type, reason, issued_by_user_id, issued_by_name, expires_at, status) values
 ('dr-x-b2', '0f1f1f1f-0000-4000-8000-000000000005', 'B2', 'dr-5@example.com', 'deal_room_disabled', 't', '0f1f1f1f-0000-4000-8000-000000000020', 'PA', null, 'active'),
 ('dr-x-o3', '0f1f1f1f-0000-4000-8000-000000000013', 'O3', 'dr-13@example.com', 'deal_room_disabled', 't', '0f1f1f1f-0000-4000-8000-000000000020', 'PA', null, 'active');
update public.business_access_requests set nda_signed = false, status = 'pending' where id = 'dr-r-pend1';

-- ---------------- buyers ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000004',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('dr-l1')->>'annual_revenue_usd')::numeric = 111111, '[B1 active, approved + NDA] sees confidential figures');
insert into test_log(line) select * from extensions.throws_ok($$select public.has_business_access('dr-l1', '0f1f1f1f-0000-4000-8000-000000000004')$$, '42501'::char(5), NULL::text, '[direct RPC] has_business_access is not callable by signed-in users (no access oracle)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l1') ? 'annual_revenue_usd') and not (public.get_business_listing_public('dr-l1') ? 'seller_contact_email'), '[B0 active, NO approval] confidential fields withheld');
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('dr-l1') ? 'title'), '[B0] the non-confidential teaser is still returned');
insert into test_log(line) select * from extensions.lives_ok($$insert into public.business_access_requests (id, listing_id, buyer_user_id, buyer_full_name, buyer_email, status, nda_signed) values ('dr-r-b0', 'dr-l3', '0f1f1f1f-0000-4000-8000-000000000002', 'B0', 'dr-2@example.com', 'pending', false)$$, '[B0 active] CAN request access (positive control)');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000005',true);
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l1') ? 'annual_revenue_usd'), '[B2, approved earlier, now deal_room_disabled] confidential fields withheld');
insert into test_log(line) select * from extensions.throws_ok($$insert into public.business_access_requests (id, listing_id, buyer_user_id, buyer_full_name, buyer_email, status, nda_signed) values ('dr-r-b2x', 'dr-l2', '0f1f1f1f-0000-4000-8000-000000000005', 'B2', 'dr-5@example.com', 'pending', false)$$, '42501'::char(5), NULL::text, '[B2 deal_room_disabled] cannot request new access');
update public.business_access_requests set nda_signed = true where id = 'dr-r-b2n';
reset role;
insert into test_log(line) select * from extensions.is((select nda_signed from public.business_access_requests where id = 'dr-r-b2n'), false, '[B2 deal_room_disabled] cannot sign an NDA (UPDATE filtered)');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000003',true);
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l1') ? 'annual_revenue_usd'), '[B3 suspended, approved earlier] confidential fields withheld');
insert into test_log(line) select * from extensions.is((select count(*) from public.business_access_requests), 0::bigint, '[B3 suspended] cannot read their own requests');
reset role;
-- ---------------- owners ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000001',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('dr-l1')->>'exact_address') = '1 Vault St', '[O active] sees the full own listing via the RPC');
insert into test_log(line) select * from extensions.ok((select (annual_revenue_usd = 111111) from public.business_listings where id = 'dr-l1'), '[O active] sees the full own listing via the table');
update public.business_access_requests set status = 'approved' where id = 'dr-r-pend1';
reset role;
insert into test_log(line) select * from extensions.is((select status from public.business_access_requests where id = 'dr-r-pend1'), 'approved', '[O active] CAN approve an access request');
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000012',true);
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l2') ? 'exact_address'), '[O2 suspended owner] no owner view through the RPC');
insert into test_log(line) select * from extensions.is((select count(*) from public.business_listings where id = 'dr-l2'), 0::bigint, '[O2 suspended owner] no direct table access to the own listing');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000013',true);
insert into test_log(line) select * from extensions.ok((public.get_business_listing_public('dr-l3')->>'exact_address') = '3 Vault St', '[O3 deal_room_disabled owner] still sees their own listing');
update public.business_listings set title = 'DR L3 renamed' where id = 'dr-l3';
update public.business_access_requests set status = 'approved' where id = 'dr-r-b4';
reset role;
insert into test_log(line) select * from extensions.is((select title from public.business_listings where id = 'dr-l3'), 'DR L3 renamed', '[O3 deal_room_disabled owner] can still manage (edit) their own listing');
insert into test_log(line) select * from extensions.is((select status from public.business_access_requests where id = 'dr-r-b4'), 'pending', '[O3 deal_room_disabled owner] cannot approve new access requests (grants frozen)');
-- ---------------- administrator & bypass attempts ----------------
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000020',true);
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l1') ? 'annual_revenue_usd'), '[platform admin] no confidential read path exists (unchanged, documented); the teaser works');
insert into test_log(line) select * from extensions.lives_ok($$select public.apply_account_restriction('dr-x-new', '0f1f1f1f-0000-4000-8000-000000000002', 'deal_room_disabled', 'abuse', null)$$, '[platform admin] can still impose a deal_room_disabled restriction');
reset role;
select set_config('role','authenticated',true), set_config('request.jwt.claim.sub','0f1f1f1f-0000-4000-8000-000000000002',true);
insert into test_log(line) select * from extensions.throws_ok($$insert into public.business_access_requests (id, listing_id, buyer_user_id, buyer_full_name, buyer_email, status, nda_signed) values ('dr-r-b0b', 'dr-l2', '0f1f1f1f-0000-4000-8000-000000000002', 'B0', 'dr-2@example.com', 'approved', true)$$, '42501'::char(5), NULL::text, '[bypass] a buyer cannot insert an already-approved request (and is now restricted)');
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l1') ? 'annual_revenue_usd'), '[B0 after restriction] still no confidential fields');
reset role;
select set_config('role','anon',true), set_config('request.jwt.claim.sub','',true);
insert into test_log(line) select * from extensions.ok(not (public.get_business_listing_public('dr-l1') ? 'annual_revenue_usd'), '[anonymous] confidential fields withheld');
insert into test_log(line) select * from extensions.throws_ok($$select public.has_business_access('dr-l1', '0f1f1f1f-0000-4000-8000-000000000004')$$, '42501'::char(5), NULL::text, '[anonymous][bypass] has_business_access is not callable');
reset role;

select line from test_log order by seq;
rollback;
