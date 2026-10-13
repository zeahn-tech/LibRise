-- =====================================================================
-- F-24 (Medium): previously approved deal-room access survived suspension
-- and a deal_room_disabled restriction.
--
-- Confidential business listings are served by get_business_listing_public(),
-- which returns the full record (revenue, cash flow, address, seller contact)
-- to a buyer with an APPROVED request + signed NDA (has_business_access()).
-- That path is a SECURITY DEFINER function, so neither the restrictive RLS
-- policies of 20261012150000 nor the INSERT-only deal_room_disabled policy on
-- business_access_requests reached it: a suspended buyer, or one whose
-- deal-room access was restricted, kept reading confidential data. Likewise a
-- suspended OWNER kept their owner view through the RPC. Reproduced.
--
-- Fix (CREATE OR REPLACE, same signatures, grants preserved):
--   * has_business_access() is false for a suspended/deactivated viewer and for
--     a viewer with an active deal_room_disabled restriction, even when the
--     request is approved and the NDA signed;
--   * get_business_listing_public() treats a suspended viewer as anonymous
--     (no owner view, no buyer view).
-- Approved requests and NDAs are NOT modified, so access resumes automatically
-- when the restriction is lifted.
--
-- ROLLBACK: re-apply the bodies from 20260912090000 / the earlier definitions
-- (has_business_access without the two extra conditions; the RPC without the
-- suspended-viewer line).
-- =====================================================================
create or replace function public.has_business_access(p_listing_id character varying, p_viewer_id character varying)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select not public.is_account_suspended(p_viewer_id)
     and not public.has_active_restriction(p_viewer_id, 'deal_room_disabled')
     and exists (
    select 1 from public.business_access_requests r
    where r.listing_id = p_listing_id
      and r.buyer_user_id = p_viewer_id
      and r.status = 'approved'
      and r.nda_signed = true
  );
$$;

create or replace function public.get_business_listing_public(p_listing_id character varying)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.business_listings;
  v_viewer_id varchar;
  v_result jsonb;
begin
  select * into v_row from public.business_listings where id = p_listing_id;
  if not found then
    return null;
  end if;

  v_viewer_id := auth.uid()::varchar;
  -- A suspended / deactivated account is treated as anonymous.
  if v_viewer_id is not null and public.is_account_suspended(v_viewer_id) then
    v_viewer_id := null;
  end if;

  if v_viewer_id is not null and v_viewer_id = v_row.owner_user_id then
    return to_jsonb(v_row);
  end if;

  if v_row.status <> 'published' then
    return null;
  end if;

  if not v_row.is_confidential then
    return to_jsonb(v_row);
  end if;

  if v_viewer_id is not null and public.has_business_access(p_listing_id, v_viewer_id) then
    return to_jsonb(v_row);
  end if;

  v_result := to_jsonb(v_row)
    - 'annual_revenue_usd' - 'annual_cash_flow_usd' - 'exact_address'
    - 'seller_name' - 'seller_contact_email' - 'seller_contact_phone';
  return v_result;
end;
$$;
