import { describe, it, expect } from 'vitest';
import { paymentKindLabel, paymentEffectLabel } from '../components/payments/PaymentReviewQueue';
import type { PaymentWithContext } from '../services/paymentService';

const item = (over: Partial<PaymentWithContext>) => ({ id: 'p', ...over }) as PaymentWithContext;

describe('admin payment review: the reviewer can tell the payment types apart', () => {
  it('subscription payments show tier and billing cycle', () => {
    expect(paymentKindLabel(item({ planType: 'subscription', subscriptionTier: 'pro', billingCycle: 'annual' }))).toBe('Subscription · Pro annual');
    expect(paymentKindLabel(item({ planType: 'subscription', subscriptionTier: 'basic', billingCycle: 'monthly' }))).toBe('Subscription · Starter monthly');
  });

  it.each([
    ['boost', 'Vacancy Boost'],
    ['featured', 'Vacancy Featured'],
    ['premium', 'Vacancy Premium']
  ] as const)('%s vacancy payments are labelled', (level, label) => {
    expect(paymentKindLabel(item({ planType: 'vacancy', promotionLevel: level }))).toBe(label);
  });

  it('says what approval will do', () => {
    expect(paymentEffectLabel(item({ planType: 'subscription' }))).toMatch(/activates the subscription/);
    expect(paymentEffectLabel(item({ planType: 'vacancy', promotionLevel: 'boost', opportunityStatus: 'published' }))).toMatch(/already live.*Boost/);
    expect(paymentEffectLabel(item({ planType: 'vacancy', promotionLevel: 'premium', opportunityStatus: 'payment_required' }))).toMatch(/publishes it.*Premium/);
  });
});
