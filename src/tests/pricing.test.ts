import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUBSCRIPTION_PLANS, getPlanForSubscription } from '../data/subscriptionPlans';

/**
 * The database is the source of truth for prices, durations and limits
 * (supabase/migrations/20261008100000_pricing_revision.sql). The TS plan
 * metadata only drives display, so these tests fail loudly if the two drift.
 */
const SQL = readFileSync('supabase/migrations/20261008100000_pricing_revision.sql', 'utf8');

/** id -> { amountMinor, durationDays } from the payment_plans upsert. */
function dbPlans(): Record<string, { amountMinor: number; durationDays: number }> {
  const out: Record<string, { amountMinor: number; durationDays: number }> = {};
  const re = /\('(plan-[a-z-]+)',\s*'[^']*',\s*'[^']*',\s*(\d+),\s*'USD',\s*(\d+),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) out[m[1]] = { amountMinor: Number(m[2]), durationDays: Number(m[3]) };
  return out;
}

describe('pricing revision (database is authoritative)', () => {
  const db = dbPlans();

  it('subscription prices: Starter $10/$100, Pro $25/$250', () => {
    expect(db['plan-sub-basic-monthly']).toEqual({ amountMinor: 1000, durationDays: 30 });
    expect(db['plan-sub-basic-annual']).toEqual({ amountMinor: 10000, durationDays: 365 });
    expect(db['plan-sub-pro-monthly']).toEqual({ amountMinor: 2500, durationDays: 30 });
    expect(db['plan-sub-pro-annual']).toEqual({ amountMinor: 25000, durationDays: 365 });
  });

  it('pay-as-you-go prices: Basic $3, Featured $5, Premium $10', () => {
    expect(db['plan-vacancy-basic'].amountMinor).toBe(300);
    expect(db['plan-vacancy-featured'].amountMinor).toBe(500);
    expect(db['plan-vacancy-premium'].amountMinor).toBe(1000);
  });

  it('annual plans are 365 days and monthly plans 30 days, enforced by a CHECK constraint', () => {
    for (const [id, p] of Object.entries(db)) {
      if (id.endsWith('-annual')) expect(p.durationDays).toBe(365);
      if (id.endsWith('-monthly')) expect(p.durationDays).toBe(30);
    }
    expect(SQL).toMatch(/payment_plans_cycle_duration_check/);
  });

  it('the UI display fallback prices match the database', () => {
    const byTier = Object.fromEntries(SUBSCRIPTION_PLANS.map((p) => [p.tier, p]));
    expect(byTier.basic.monthlyPrice * 100).toBe(db['plan-sub-basic-monthly'].amountMinor);
    expect(byTier.basic.annualPrice * 100).toBe(db['plan-sub-basic-annual'].amountMinor);
    expect(byTier.pro.monthlyPrice * 100).toBe(db['plan-sub-pro-monthly'].amountMinor);
    expect(byTier.pro.annualPrice * 100).toBe(db['plan-sub-pro-annual'].amountMinor);
  });

  it('annual savings are exactly $20 (Starter) and $50 (Pro)', () => {
    const byTier = Object.fromEntries(SUBSCRIPTION_PLANS.map((p) => [p.tier, p]));
    expect(byTier.basic.monthlyPrice * 12 - byTier.basic.annualPrice).toBe(20);
    expect(byTier.pro.monthlyPrice * 12 - byTier.pro.annualPrice).toBe(50);
  });

  it('limits shown in the UI match tier_limits() in the database: jobs 1/10/50, listings 1/3/10, featured 0/1/5', () => {
    const m = /select\s+case p_tier when 'pro' then (\d+) when 'basic' then (\d+) else (\d+) end,\s+case p_tier when 'pro' then (\d+) when 'basic' then (\d+)\s+else (\d+) end,\s+case p_tier when 'pro' then (\d+)\s+when 'basic' then (\d+)\s+else (\d+) end;/.exec(SQL);
    expect(m).not.toBeNull();
    const [, jobsPro, jobsBasic, jobsFree, lstPro, lstBasic, lstFree, ftPro, ftBasic, ftFree] = (m as RegExpExecArray).map(Number);
    const byTier = Object.fromEntries(SUBSCRIPTION_PLANS.map((p) => [p.tier, p.entitlements]));
    expect([byTier.free.maxActiveJobs, byTier.basic.maxActiveJobs, byTier.pro.maxActiveJobs]).toEqual([jobsFree, jobsBasic, jobsPro]);
    expect([byTier.free.maxActiveListings, byTier.basic.maxActiveListings, byTier.pro.maxActiveListings]).toEqual([lstFree, lstBasic, lstPro]);
    expect([byTier.free.maxFeaturedVacancies, byTier.basic.maxFeaturedVacancies, byTier.pro.maxFeaturedVacancies]).toEqual([ftFree, ftBasic, ftPro]);
    expect([jobsFree, jobsBasic, jobsPro]).toEqual([1, 10, 50]);
  });

  it('Free is a permanent plan, not a 14-day trial', () => {
    const free = SUBSCRIPTION_PLANS[0];
    expect(free.name).toBe('Free');
    expect(JSON.stringify(free).toLowerCase()).not.toMatch(/trial|14-day|14 day/);
  });

  it('entitlements: Starter promotes jobs without analytics; Pro adds featured, priority visibility, analytics and AI', () => {
    const starter = getPlanForSubscription({ tier: 'basic' }).entitlements;
    const pro = getPlanForSubscription({ tier: 'pro' }).entitlements;
    expect(starter).toMatchObject({ jobPromotion: true, advancedAnalytics: false, priorityVisibility: false, canUseAI: false });
    expect(pro).toMatchObject({ jobPromotion: true, advancedAnalytics: true, priorityVisibility: true, canUseAI: true });
    expect(pro.maxFeaturedVacancies).toBeGreaterThan(starter.maxFeaturedVacancies);
    // AI is an enhancement, not the paywall: the main differences are capacity and visibility
    expect(pro.maxActiveJobs as number).toBeGreaterThan(starter.maxActiveJobs as number);
  });

  it('a lapsed/absent subscription resolves to Free entitlements', () => {
    expect(getPlanForSubscription(null).tier).toBe('free');
  });
});

describe('free Basic job + optional promotions (migration 20261009100000)', () => {
  const PROMO_SQL = readFileSync('supabase/migrations/20261009100000_free_basic_promotions.sql', 'utf8');

  it('the $3/$5/$10 vacancy plans are named and levelled Boost / Featured / Premium', () => {
    expect(PROMO_SQL).toMatch(/name = 'Boost'[\s\S]*promotion_level = 'boost'[\s\S]*where id = 'plan-vacancy-basic'/);
    expect(PROMO_SQL).toMatch(/name = 'Featured'[\s\S]*promotion_level = 'featured'[\s\S]*where id = 'plan-vacancy-featured'/);
    expect(PROMO_SQL).toMatch(/name = 'Premium'[\s\S]*promotion_level = 'premium'[\s\S]*where id = 'plan-vacancy-premium'/);
  });

  it('prices are NOT changed by the promotion migration (the database keeps $3 / $5 / $10)', () => {
    expect(PROMO_SQL).not.toMatch(/amount_minor\s*=/);
  });

  it('promotion columns are protected from the client and rejection never unpublishes a live job', () => {
    expect(PROMO_SQL).toMatch(/new\.promotion_level := old\.promotion_level/);
    expect(PROMO_SQL).toMatch(/and status = 'payment_required';/);
  });

  it('promotions expire on their own: the paid level is only used while promotion_until is in the future', async () => {
    const { promotionFieldsForTest } = await import('../services/opportunityService');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(promotionFieldsForTest({ promotion_level: 'premium', promotion_until: future } as never).promotionLevel).toBe('premium');
    expect(promotionFieldsForTest({ promotion_level: 'premium', promotion_until: past } as never).promotionLevel).toBeNull();
    expect(promotionFieldsForTest({ promotion_level: 'boost', promotion_until: past } as never).isFeatured).toBe(false);
  });
});
