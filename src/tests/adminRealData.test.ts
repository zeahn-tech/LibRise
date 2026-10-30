import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterPayments, monthLabel, monthlySeries, paymentsToCsv, statusLabel } from '../lib/paymentsLedger';
import { parsePlatformSettings } from '../services/platformSettingsService';
import { mergeIndustries } from '../lib/platformSettingsStore';
import { BUSINESS_INDUSTRIES } from '../config/constants';
import { convertAmount, getUsdToLrdRate, rateNote, setUsdToLrdRate } from '../lib/currency';
import type { AdminPayment } from '../services/adminService';

const pay = (o: Partial<AdminPayment> = {}): AdminPayment => ({
  id: 'p1', publicPaymentId: 'OHL-AAAA-0001', organizationId: 'org-1', organizationName: 'Acme Ltd', planId: 'plan_pro', planName: 'Pro Plan',
  provider: 'MTN_MOMO', providerTransactionId: 'TX-100', senderPhoneNumber: '0886000000', amountMinor: 2500, currency: 'USD',
  status: 'payment_success', createdAt: '2026-10-01T10:00:00Z', ...o
});

describe('payments ledger helpers', () => {
  it('labels statuses and filters by status and search text', () => {
    expect(statusLabel('payment_pending')).toBe('Awaiting review');
    expect(statusLabel('something_new')).toBe('something new');
    const rows = [pay(), pay({ id: 'p2', publicPaymentId: 'OHL-BBBB-0002', organizationName: 'Zeta', status: 'payment_failed' }), pay({ id: 'p3', status: 'created' })];
    expect(filterPayments(rows, 'payment_success', '')).toHaveLength(1);
    expect(filterPayments(rows, 'other', '')).toHaveLength(1);
    expect(filterPayments(rows, 'all', 'zeta')).toHaveLength(1);
    expect(filterPayments(rows, 'all', 'tx-100')).toHaveLength(3); // all three share that transaction id
    expect(filterPayments(rows, 'all', 'nope')).toHaveLength(0);
  });

  it('exports CSV with escaping and spreadsheet-formula protection', () => {
    const csv = paymentsToCsv([pay({ organizationName: '=HYPERLINK("x")', failureReason: 'line1\nline2, "quoted"' })]);
    expect(csv.startsWith('\uFEFFReference,Organization')).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain('"line1\nline2, ""quoted"""');
    expect(csv).toContain(',25.00,USD,Confirmed,');
  });

  it('fills empty months with zero and scales bars to the largest real month', () => {
    const series = monthlySeries(
      [{ month: '2026-08', currency: 'USD', confirmedMinor: 10000 }, { month: '2026-10', currency: 'USD', confirmedMinor: 5000 }, { month: '2026-10', currency: 'LRD', confirmedMinor: 99999 }],
      'USD', 4, new Date(Date.UTC(2026, 9, 15))
    );
    expect(series.map((s) => s.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(series.map((s) => s.minor)).toEqual([0, 10000, 0, 5000]);
    expect(series.map((s) => s.pct)).toEqual([0, 100, 0, 50]);
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
});

describe('platform settings', () => {
  it('parses valid values and ignores malformed ones', () => {
    const s = parsePlatformSettings([
      { key: 'announcement', value: { enabled: true, message: 'Maintenance Sunday' } },
      { key: 'usd_to_lrd', value: 190.5 },
      { key: 'extra_industries', value: ['Fisheries', 42, '  ', 'Rubber'] }
    ]);
    expect(s).toEqual({ announcement: { enabled: true, message: 'Maintenance Sunday' }, usdToLrd: 190.5, extraIndustries: ['Fisheries', 'Rubber'] });
    const bad = parsePlatformSettings([{ key: 'usd_to_lrd', value: 5 }, { key: 'announcement', value: { enabled: 'yes' } }, { key: 'unknown', value: 1 }]);
    expect(bad).toEqual({ announcement: null, usdToLrd: null, extraIndustries: [] });
  });

  it('merges extra industries after the built-in list without duplicates', () => {
    const merged = mergeIndustries(['Fisheries', 'agriculture & forestry', ' Fisheries ']);
    expect(merged.slice(0, BUSINESS_INDUSTRIES.length)).toEqual([...BUSINESS_INDUSTRIES]);
    expect(merged.slice(BUSINESS_INDUSTRIES.length)).toEqual(['Fisheries']);
  });

  it('the admin-set exchange rate drives conversions, and out-of-range values are ignored', () => {
    const original = getUsdToLrdRate();
    try {
      setUsdToLrdRate(200);
      expect(convertAmount(10, 'USD', 'LRD')).toBe(2000);
      expect(convertAmount(2000, 'LRD', 'USD')).toBe(10);
      expect(rateNote()).toBe('1 USD = 200 LRD');
      setUsdToLrdRate(5);
      setUsdToLrdRate(NaN);
      expect(getUsdToLrdRate()).toBe(200);
    } finally {
      setUsdToLrdRate(original);
    }
  });
});

describe('the admin center no longer contains placeholder data', () => {
  const src = readFileSync('src/components/trust/TrustSafetyAdminCenter.tsx', 'utf8');
  const everything = [
    src,
    ...['AnalyticsPanel', 'RevenueLedgerPanel', 'SubscriptionsPanel', 'OpportunityModerationPanel', 'PlatformSettingsPanels'].map((f) => readFileSync(`src/components/trust/admin/${f}.tsx`, 'utf8'))
  ].join('\n');

  it.each([
    ['sample ledger', /SAMPLE DATA|logDemoInvoice|Simulate Receipt/],
    ['hard-coded uptime and latency', /99\.98|12ms|Failover Mirrored|Storage Adaptor/],
    ['invented revenue and growth', /4,620|\+14%/],
    ['fabricated chart dates', /Aug 30|Sep 05/],
    ['fake county numbers', /48 openings|Montserrado County<\/span>\s*<span>48/],
    ['local-only plan toggle', /toggleOrgSubscriptionTier|plan-enterprise/],
    ['canned resolution note', /Scam Desk resolution review completed/],
    ['invented ministry notice', /Ministry of Labour requires/],
    ['browser-only audit log', /db\.emitAuditLog/]
  ])('has no %s', (_label, pattern) => {
    expect(everything).not.toMatch(pattern);
  });
});
