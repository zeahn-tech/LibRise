/**
 * Single source of truth for currency conversion and price formatting.
 *
 * Liberia is a dual-currency economy (USD and LRD are both in everyday use), so
 * every amount in the app is stored in the currency it was authored in and is
 * converted to the viewer's chosen display currency here.
 */
import { EXCHANGE_RATES } from '../config/constants';

export type Currency = 'USD' | 'LRD';

/** Convert an amount between currencies using the platform benchmark rate. */
export const convertAmount = (amount: number, from: Currency, to: Currency): number => {
  if (from === to) return amount;
  return from === 'USD' ? amount * EXCHANGE_RATES.USD_TO_LRD : amount * EXCHANGE_RATES.LRD_TO_USD;
};

/** Format an amount that is ALREADY in `currency` (no conversion). */
export const formatMoney = (amount: number, currency: Currency): string => {
  const rounded = Math.round(amount);
  return currency === 'USD' ? `$${rounded.toLocaleString()}` : `LRD ${rounded.toLocaleString()}`;
};

/** Convert `amount` from `source` to `display`, then format it. */
export const formatConverted = (amount: number, source: Currency, display: Currency): string =>
  formatMoney(convertAmount(amount, source, display), display);

/** Human-readable rate note, e.g. "1 USD = 195 LRD". */
export const rateNote = (): string => `1 USD = ${EXCHANGE_RATES.USD_TO_LRD} LRD`;

/**
 * Format a salary range authored in `source`, shown in the `display` currency.
 * Returns null when there is nothing numeric to show.
 */
export const formatSalaryRange = (
  min: number | undefined,
  max: number | undefined,
  source: Currency,
  display: Currency
): string | null => {
  const lo = min || 0;
  const hi = max || 0;
  if (!lo && !hi) return null;
  const f = (n: number) => formatConverted(n, source, display);
  if (lo > 0 && hi > 0) return `${f(lo)} - ${f(hi)}`;
  if (lo > 0) return `From ${f(lo)}`;
  return `Up to ${f(hi)}`;
};
