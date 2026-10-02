import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }) }));
vi.mock('../services/authService', () => ({ authService: { getSession: () => ({ user: { id: 'u1' } }) } }));
vi.mock('../services/notificationService', () => ({
  notificationService: { getOrganizationRecipientIds: vi.fn(), notifyPaymentReviewed: vi.fn(), notifyPaymentSubmitted: vi.fn() }
}));

/** Chainable query builder that resolves each awaited / maybeSingle() call from a queue. */
const builder = (...results: Array<{ data: unknown; error: unknown }>) => {
  const queue = [...results];
  const next = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'insert', 'update']) b[m] = vi.fn(() => b);
  b.maybeSingle = vi.fn(next);
  b.then = (resolve: (v: unknown) => unknown) => next().then(resolve);
  return b;
};

const planRow = (over: Record<string, unknown> = {}) => ({
  id: 'plan-vacancy-basic', name: 'Basic', description: 'd', amount_minor: 500, currency: 'USD',
  duration_days: 30, features: [], active: true, subscription_tier: null, billing_cycle: null, ...over
});

const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1', public_payment_id: 'LR-1', organization_id: 'org-1', created_by_user_id: 'u1', opportunity_id: 'opp-1',
  plan_id: 'plan-vacancy-basic', payment_provider: 'manual_momo_mtn', payment_method: null, provider_transaction_id: null,
  provider_reference: 'REF', sender_phone_number: null, amount_minor: 500, currency: 'USD', description: null,
  status: 'created', metadata: {}, failure_reason: null, expires_at: '2099-01-01T00:00:00Z', paid_at: null,
  reviewed_by_user_id: null, reviewed_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over
});

describe('paymentService: database errors are never hidden behind "unexpected system error"', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('a database missing the plan_type migration still loads vacancy plans (checkout keeps working)', async () => {
    mockFrom
      .mockReturnValueOnce(builder({ data: null, error: { code: '42703', message: 'column payment_plans.plan_type does not exist' } }))
      .mockReturnValueOnce(builder({ data: [planRow()], error: null }));
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.getPlans('vacancy');

    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(res.data?.[0].planType).toBe('vacancy');
  });

  it('subscription plans on an outdated database explain that a database update is pending', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { code: '42703', message: 'column payment_plans.plan_type does not exist' } }));
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.getPlans('subscription');

    expect(res.error?.code).toBe('PAYMENTS_SETUP_INCOMPLETE');
    expect(res.error?.message).toMatch(/database update is pending/i);
  });

  it.each([['42P01'], ['PGRST202'], ['PGRST205']])('schema-drift error %s is explained as a pending database update', async (code) => {
    mockFrom.mockReturnValue(builder({ data: null, error: { code, message: 'relation does not exist' } }));
    const { paymentService } = await import('../services/paymentService');
    const res = await paymentService.getPlans();
    expect(res.error?.code).toBe('PAYMENTS_SETUP_INCOMPLETE');
  });

  it('an expired session says so', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }));
    const { paymentService } = await import('../services/paymentService');
    const res = await paymentService.getPlans();
    expect(res.error?.code).toBe('UNAUTHORIZED');
    expect(res.error?.message).toMatch(/sign in again/i);
  });

  it('any other database error gives an actionable message with the error code, not the generic one', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { code: '23514', message: 'check constraint violated' } }));
    const { paymentService } = await import('../services/paymentService');
    const res = await paymentService.getPlans();
    expect(res.error?.code).toBe('PAYMENT_ERROR');
    expect(res.error?.message).toContain('23514');
    expect(res.error?.message).not.toMatch(/unexpected system error/i);
  });
});

describe('paymentService.initiate(): MTN vs Orange', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  const openMtnPayment = () => {
    mockFrom
      .mockReturnValueOnce(builder({ data: { id: 'opp-1', organization_id: 'org-1', status: 'payment_required' }, error: null }))
      .mockReturnValueOnce(builder({ data: paymentRow(), error: null }));
  };

  it('tapping Orange on an unpaid MTN payment switches it, so the number shown matches the provider recorded', async () => {
    openMtnPayment();
    mockRpc.mockResolvedValue({ data: paymentRow({ payment_provider: 'manual_momo_orange' }), error: null });
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.initiate({ opportunityId: 'opp-1', planId: 'plan-vacancy-basic', provider: 'manual_momo_orange' });

    expect(mockRpc).toHaveBeenCalledWith('switch_payment_provider', { p_payment_id: 'pay-1', p_provider: 'manual_momo_orange' });
    expect(res.data?.paymentProvider).toBe('manual_momo_orange');
  });

  it('does not call the switch function when the provider is unchanged', async () => {
    openMtnPayment();
    const { paymentService } = await import('../services/paymentService');
    const res = await paymentService.initiate({ opportunityId: 'opp-1', planId: 'plan-vacancy-basic', provider: 'manual_momo_mtn' });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(res.data?.paymentProvider).toBe('manual_momo_mtn');
  });

  it('if the switch is refused or not installed yet, returns the existing payment with its REAL provider (no error)', async () => {
    openMtnPayment();
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.initiate({ opportunityId: 'opp-1', planId: 'plan-vacancy-basic', provider: 'manual_momo_orange' });

    expect(res.error).toBeNull();
    expect(res.data?.paymentProvider).toBe('manual_momo_mtn');
  });

  it('never tries to switch once a reference has been submitted', async () => {
    mockFrom
      .mockReturnValueOnce(builder({ data: { id: 'opp-1', organization_id: 'org-1', status: 'payment_required' }, error: null }))
      .mockReturnValueOnce(builder({ data: paymentRow({ status: 'payment_pending' }), error: null }));
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.initiate({ opportunityId: 'opp-1', planId: 'plan-vacancy-basic', provider: 'manual_momo_orange' });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res.data?.paymentProvider).toBe('manual_momo_mtn');
    expect(res.data?.status).toBe('payment_pending');
  });
});
