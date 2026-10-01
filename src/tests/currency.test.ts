import { describe, it, expect } from 'vitest';
import { convertAmount, formatMoney, formatConverted, formatSalaryRange } from '../lib/currency';

describe('currency helpers', () => {
  it('converts USD <-> LRD at the platform rate and is a no-op for same currency', () => {
    expect(convertAmount(100, 'USD', 'LRD')).toBe(19500);
    expect(convertAmount(19500, 'LRD', 'USD')).toBeCloseTo(100, 5);
    expect(convertAmount(42, 'USD', 'USD')).toBe(42);
  });

  it('formats each currency distinctly', () => {
    expect(formatMoney(1500, 'USD')).toBe('$1,500');
    expect(formatMoney(1500, 'LRD')).toBe('LRD 1,500');
  });

  it('converts before formatting', () => {
    expect(formatConverted(10, 'USD', 'LRD')).toBe('LRD 1,950');
    expect(formatConverted(1950, 'LRD', 'USD')).toBe('$10');
  });

  it('renders salary ranges in the display currency regardless of authoring currency', () => {
    expect(formatSalaryRange(1000, 2000, 'USD', 'USD')).toBe('$1,000 - $2,000');
    expect(formatSalaryRange(1000, 2000, 'USD', 'LRD')).toBe('LRD 195,000 - LRD 390,000');
    // A job posted in LRD must NOT be treated as USD when shown in USD
    expect(formatSalaryRange(195000, 390000, 'LRD', 'USD')).toBe('$1,000 - $2,000');
    expect(formatSalaryRange(500, 0, 'USD', 'USD')).toBe('From $500');
    expect(formatSalaryRange(0, 800, 'USD', 'USD')).toBe('Up to $800');
    expect(formatSalaryRange(0, 0, 'USD', 'USD')).toBeNull();
  });
});
