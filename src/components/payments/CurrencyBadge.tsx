import React from 'react';

/** Small pill that always names a payment's currency, so LRD and USD amounts can never be confused. */
export const CurrencyBadge: React.FC<{ currency: string; className?: string }> = ({ currency, className = '' }) => (
  <span
    data-testid="currency-badge"
    className={`inline-block px-1.5 py-0.5 rounded-md border font-bold text-[10px] tracking-wider ${
      currency === 'LRD' ? 'bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]' : 'bg-[#DBEAFE] text-[#1E40AF] border-[#93C5FD]'
    } ${className}`}
  >
    {currency}
  </span>
);
