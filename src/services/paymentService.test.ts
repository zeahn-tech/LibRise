import { describe, it, expect } from 'vitest';
import { formatMinorAmount, getMomoInstructions } from './paymentService';
import { PaymentRequiredError, AppError } from '../core/errors/AppError';

describe('formatMinorAmount (integer minor units -> display, no float math)', () => {
  it('formats USD cents', () => {
    expect(formatMinorAmount(500, 'USD')).toBe('$5.00');
    expect(formatMinorAmount(1050, 'USD')).toBe('$10.50');
    expect(formatMinorAmount(5, 'USD')).toBe('$0.05');
    expect(formatMinorAmount(0, 'USD')).toBe('$0.00');
  });

  it('groups thousands', () => {
    expect(formatMinorAmount(123456789, 'USD')).toBe('$1,234,567.89');
  });

  it('formats non-USD with currency suffix', () => {
    expect(formatMinorAmount(250000, 'LRD')).toBe('2,500.00 LRD');
  });

  it('never produces float artifacts for amounts that break float division', () => {
    // 0.1 + 0.2 style problems cannot occur: only integer floor/modulo is used.
    expect(formatMinorAmount(1999, 'USD')).toBe('$19.99');
    expect(formatMinorAmount(1, 'USD')).toBe('$0.01');
  });
});

describe('getMomoInstructions (honesty when unconfigured)', () => {
  it('reports NOT configured and returns null numbers when env vars are empty', () => {
    // Test env sets no VITE_MOMO_* vars, so this must fail closed: the UI
    // relies on `configured === false` to refuse to show payment details
    // rather than displaying a blank/placeholder number a recruiter might
    // actually send money to.
    const mtn = getMomoInstructions('manual_momo_mtn');
    const orange = getMomoInstructions('manual_momo_orange');
    expect(mtn.configured).toBe(false);
    expect(mtn.phoneNumber).toBeNull();
    expect(orange.configured).toBe(false);
    expect(orange.phoneNumber).toBeNull();
  });
});

describe('PaymentRequiredError', () => {
  it('is an AppError with HTTP 402 and carries the opportunity id for checkout routing', () => {
    const err = new PaymentRequiredError('pay up', { opportunityId: 'opp-1' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(402);
    expect(err.code).toBe('PAYMENT_REQUIRED');
    expect(err.details?.opportunityId).toBe('opp-1');
  });
});
