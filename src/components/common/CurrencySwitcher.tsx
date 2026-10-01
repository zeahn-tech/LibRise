import React from 'react';
import { useConfig } from '../../context/ConfigContext';
import { rateNote } from '../../lib/currency';

interface CurrencySwitcherProps {
  /** compact: small header pill. full: labelled control with rate note (menus/sheets). */
  variant?: 'compact' | 'full';
  className?: string;
}

const OPTIONS = [
  { code: 'USD', short: '$', label: 'US Dollar' },
  { code: 'LRD', short: 'L$', label: 'Liberian Dollar' },
] as const;

/**
 * Chooses the currency in which every price on the platform is DISPLAYED.
 * Amounts are stored in the currency they were posted in and converted at the
 * platform benchmark rate (see lib/currency.ts).
 */
export const CurrencySwitcher: React.FC<CurrencySwitcherProps> = ({ variant = 'compact', className = '' }) => {
  const { currency, setCurrency } = useConfig();

  if (variant === 'full') {
    return (
      <div className={className}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-stone-800 dark:text-stone-200">Display currency</p>
            <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">
              Prices are converted at {rateNote()}.
            </p>
          </div>
          <div role="group" aria-label="Display currency" className="flex shrink-0 items-center bg-[#F2F2EC] dark:bg-stone-900 rounded-xl p-1 border border-[#E8E4D9] dark:border-stone-800">
            {OPTIONS.map((o) => (
              <button
                key={o.code}
                type="button"
                aria-pressed={currency === o.code}
                onClick={() => setCurrency(o.code)}
                className={`min-h-9 px-3 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  currency === o.code
                    ? 'bg-white dark:bg-stone-700 text-[#283618] dark:text-white shadow-xs'
                    : 'text-[#606C38] dark:text-stone-400'
                }`}
              >
                {o.code}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Display currency"
      title={`Show prices in USD or LRD (${rateNote()})`}
      className={`flex shrink-0 items-center bg-[#F2F2EC] rounded-xl p-0.5 border border-[#E8E4D9] ${className}`}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.code}
          type="button"
          aria-pressed={currency === o.code}
          aria-label={o.label}
          onClick={() => setCurrency(o.code)}
          className={`px-2 py-1.5 text-[11px] sm:text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
            currency === o.code ? 'bg-[#283618] text-white shadow-xs' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          {o.code}
        </button>
      ))}
    </div>
  );
};
