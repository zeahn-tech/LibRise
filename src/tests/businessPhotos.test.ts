import { describe, it, expect } from 'vitest';
import { rowToListing } from '../services/businessService';

const baseRow = {
  id: 'biz-1', owner_user_id: 'u1', title: 'T', slug: 't', listing_type: 'business_sale', industry: 'Retail',
  county: 'Montserrado', city_district: 'Monrovia', exact_address: null, asking_price_usd: 1000,
  annual_revenue_usd: null, annual_cash_flow_usd: null, is_price_negotiable: false, headline: 'h',
  description: 'd', public_teaser: 'h', financial_ranges: null, assets_included: null,
  reason_for_selling: null, years_established: 1, employee_count: 1, status: 'published',
  is_confidential: false, is_verified: false, moderation_status: null, moderation_note: null,
  seller_name: null, seller_contact_email: null, seller_contact_phone: null, views_count: 0,
  created_at: '', updated_at: ''
};

describe('business listing photos mapping', () => {
  it('returns every stored photo, in order', () => {
    const l = rowToListing({ ...baseRow, photos: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'] });
    expect(l.photos).toEqual(['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg']);
  });
  it('tolerates missing or malformed photos', () => {
    expect(rowToListing(baseRow).photos).toEqual([]);
    expect(rowToListing({ ...baseRow, photos: null }).photos).toEqual([]);
    expect(rowToListing({ ...baseRow, photos: ['https://a/1.jpg', 5, ''] }).photos).toEqual(['https://a/1.jpg']);
  });
});
