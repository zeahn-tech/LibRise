/**
 * Pure helpers for dual-currency payment plans.
 *
 * Every package exists as one payment_plans row per currency (paired by `priceGroup`). The currency the user
 * VIEWS prices in (display currency, converted at the admin-set rate) and the currency they PAY in (payment
 * currency, a real plan row whose price is set by an administrator) are independent. Nothing here converts a
 * payment amount: a payment currency always selects a real plan row from the database.
 */
import type { PaymentPlan } from '../types';

export type PaymentCurrency = 'USD' | 'LRD';

export const PAYMENT_CURRENCIES: ReadonlyArray<{ code: PaymentCurrency; flag: string; label: string }> = [
  { code: 'LRD', flag: '🇱🇷', label: 'Liberian Dollar (LRD)' },
  { code: 'USD', flag: '🇺🇸', label: 'US Dollar (USD)' }
];

export const isPaymentCurrency = (value: string | null | undefined): value is PaymentCurrency =>
  value === 'USD' || value === 'LRD';

/** The plans a user can pay for in `currency` (only real plan rows of that currency). */
export function plansInCurrency(plans: PaymentPlan[], currency: PaymentCurrency): PaymentPlan[] {
  return plans.filter((p) => p.currency === currency);
}

/** Currencies that have at least one plan, so the picker never offers a currency nothing can be paid in. */
export function availableCurrencies(plans: PaymentPlan[]): PaymentCurrency[] {
  return PAYMENT_CURRENCIES.map((c) => c.code).filter((code) => plans.some((p) => p.currency === code));
}

/** The plan for a package in a given currency. `groupOrId` may be a price group or a plan id. */
export function planForGroup(plans: PaymentPlan[], groupOrId: string, currency: PaymentCurrency): PaymentPlan | undefined {
  const group = plans.find((p) => p.id === groupOrId)?.priceGroup ?? groupOrId;
  return plans.find((p) => p.priceGroup === group && p.currency === currency);
}

/**
 * One plan per package for DISPLAY: the display currency's own plan when it exists, otherwise the USD plan
 * (so a database without LRD plans still shows prices). Callers show the plan's own currency next to its amount.
 */
export function plansForDisplay(plans: PaymentPlan[], display: PaymentCurrency): PaymentPlan[] {
  const out: PaymentPlan[] = [];
  const seen = new Set<string>();
  for (const p of plans) {
    if (seen.has(p.priceGroup)) continue;
    seen.add(p.priceGroup);
    out.push(planForGroup(plans, p.priceGroup, display) ?? planForGroup(plans, p.priceGroup, 'USD') ?? p);
  }
  return out;
}
