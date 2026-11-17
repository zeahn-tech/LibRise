import { describe, it, expect } from 'vitest';
import type { Payment } from '../types';
import { buildReceiptModel, generateReceiptPdf, maskPhone, pdfSafe, receiptFileName } from './paymentReceipt';

const base: Payment = {
  id: 'pay-1', publicPaymentId: 'pub-1', organizationId: 'org-1', createdByUserId: 'u1', opportunityId: null,
  planId: 'plan-sub-pro-monthly-lrd', paymentProvider: 'manual_momo_orange', providerTransactionId: 'TXN123456',
  providerReference: 'OHL-AAAA-BBBB', senderPhoneNumber: '+231770001234', amountMinor: 480000, currency: 'LRD',
  status: 'payment_success', metadata: {}, expiresAt: '2026-11-19T00:00:00Z', paidAt: '2026-11-17T10:30:00Z',
  createdAt: '2026-11-17T09:00:00Z', updatedAt: '2026-11-17T10:30:00Z'
};

describe('payment receipts', () => {
  it('refuses to build a receipt for anything but an approved payment', () => {
    for (const status of ['created', 'payment_pending', 'payment_failed', 'payment_expired', 'cancelled'] as const) {
      expect(() => buildReceiptModel({ payment: { ...base, status } })).toThrow(/approved/);
    }
  });
  it('states the amount with its currency and masks the sender number', () => {
    const m = buildReceiptModel({ payment: base, planName: 'Pro (Monthly)', planType: 'subscription', organizationName: 'Acme Ltd' });
    expect(m.amountLine).toBe('4,800.00 LRD');
    const flat = m.rows.map((r) => r.join('=')).join('|');
    expect(flat).toContain('Sender number=****1234');
    expect(flat).not.toContain('770001234');
    expect(flat).toContain('Paid with=Orange Money');
    expect(flat).toContain('Currency=LRD');
    expect(flat).toContain('Transaction ID=TXN123456');
  });
  it('shows USD receipts in USD', () => {
    expect(buildReceiptModel({ payment: { ...base, currency: 'USD', amountMinor: 2500 } }).amountLine).toBe('$25.00 USD');
  });
  it('helpers are safe', () => {
    expect(maskPhone(null)).toBe('Not provided');
    expect(pdfSafe('Caf\u00e9 \u2013 \u201Cx\u201D')).toBe('Caf? - "x"');
    expect(receiptFileName({ publicPaymentId: 'pub 1/x', currency: 'LRD' })).toBe('LibRise-receipt-pub_1_x-LRD.pdf');
  });
  it('produces a real PDF', async () => {
    const blob = await generateReceiptPdf({ payment: base, planName: 'Pro (Monthly)', planType: 'subscription', organizationName: 'Acme Ltd' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);
  });
});
