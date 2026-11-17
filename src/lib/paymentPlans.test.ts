import { describe, it, expect } from 'vitest';
import type { PaymentPlan } from '../types';
import { availableCurrencies, planForGroup, plansForDisplay, plansInCurrency } from './paymentPlans';

const plan = (id: string, group: string, currency: string, amountMinor: number): PaymentPlan => ({
  id, priceGroup: group, name: group, description: '', amountMinor, currency, durationDays: 30,
  features: [], active: true, planType: 'subscription'
});

const PLANS = [
  plan('plan-sub-basic-monthly', 'plan-sub-basic-monthly', 'USD', 1000),
  plan('plan-sub-basic-monthly-lrd', 'plan-sub-basic-monthly', 'LRD', 195000),
  plan('plan-sub-pro-annual', 'plan-sub-pro-annual', 'USD', 25000)
];

describe('dual-currency plan helpers', () => {
  it('shows only plans of the selected payment currency', () => {
    expect(plansInCurrency(PLANS, 'LRD').map((p) => p.id)).toEqual(['plan-sub-basic-monthly-lrd']);
    expect(plansInCurrency(PLANS, 'USD')).toHaveLength(2);
  });
  it('maps a package to its plan in the other currency without converting', () => {
    expect(planForGroup(PLANS, 'plan-sub-basic-monthly', 'LRD')?.amountMinor).toBe(195000);
    expect(planForGroup(PLANS, 'plan-sub-basic-monthly-lrd', 'USD')?.id).toBe('plan-sub-basic-monthly');
    expect(planForGroup(PLANS, 'plan-sub-pro-annual', 'LRD')).toBeUndefined();
  });
  it('only offers currencies that have plans', () => {
    expect(availableCurrencies(PLANS)).toEqual(['LRD', 'USD']);
    expect(availableCurrencies(plansInCurrency(PLANS, 'USD'))).toEqual(['USD']);
  });
  it('display falls back to the USD plan when the display currency has none', () => {
    const lrd = plansForDisplay(PLANS, 'LRD');
    expect(lrd.map((p) => `${p.priceGroup}:${p.currency}`)).toEqual([
      'plan-sub-basic-monthly:LRD', 'plan-sub-pro-annual:USD'
    ]);
    expect(plansForDisplay(PLANS, 'USD').every((p) => p.currency === 'USD')).toBe(true);
  });
});
