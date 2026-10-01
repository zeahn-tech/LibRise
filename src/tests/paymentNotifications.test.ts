import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({ rpc: mockRpc })
}));
vi.mock('../services/authService', () => ({
  authService: { getSession: () => ({ user: { id: 'payer-1' } }) }
}));

const notify = vi.hoisted(() => ({
  getOrganizationRecipientIds: vi.fn(),
  notifyPaymentReviewed: vi.fn(),
  notifyPaymentSubmitted: vi.fn()
}));
vi.mock('../services/notificationService', () => ({ notificationService: notify }));

const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  public_payment_id: 'LR-0001',
  organization_id: 'org-1',
  created_by_user_id: 'payer-1',
  opportunity_id: 'opp-1',
  plan_id: 'single_job',
  payment_provider: 'manual_mobile_money',
  payment_method: 'orange_money',
  provider_transaction_id: 'TX123',
  provider_reference: 'REF',
  sender_phone_number: null,
  amount_minor: 2500,
  currency: 'USD',
  description: null,
  status: 'payment_success',
  metadata: {},
  failure_reason: null,
  expires_at: '2026-10-02T00:00:00Z',
  paid_at: null,
  reviewed_by_user_id: 'admin-1',
  reviewed_at: '2026-10-01T10:00:00Z',
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  ...over
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('payment notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notify.getOrganizationRecipientIds.mockResolvedValue(['payer-1', 'teammate-1']);
    notify.notifyPaymentReviewed.mockResolvedValue({});
    notify.notifyPaymentSubmitted.mockResolvedValue({});
  });

  it('approval notifies the payer AND their organization team, and says the vacancy is live', async () => {
    mockRpc.mockResolvedValue({ data: paymentRow(), error: null });
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.reviewPayment('pay-1', 'approve');
    await flush();

    expect(res.error).toBeNull();
    // payer is included even though only the org's members are readable, and nobody is duplicated
    expect(notify.getOrganizationRecipientIds).toHaveBeenCalledWith('org-1', ['payer-1']);
    expect(notify.notifyPaymentReviewed).toHaveBeenCalledTimes(2);
    expect(notify.notifyPaymentReviewed).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'teammate-1', decision: 'approved', publishedVacancy: true, paymentId: 'pay-1' })
    );
  });

  it('rejection carries the reviewer\'s reason', async () => {
    mockRpc.mockResolvedValue({ data: paymentRow({ status: 'payment_failed', failure_reason: 'Reference not found' }), error: null });
    const { paymentService } = await import('../services/paymentService');

    await paymentService.reviewPayment('pay-1', 'reject', 'Reference not found');
    await flush();

    expect(notify.notifyPaymentReviewed).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'rejected', publishedVacancy: false, reason: 'Reference not found' })
    );
  });

  it('a notification failure never breaks the (already successful) approval', async () => {
    mockRpc.mockResolvedValue({ data: paymentRow(), error: null });
    notify.notifyPaymentReviewed.mockRejectedValue(new Error('rls'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.reviewPayment('pay-1', 'approve');
    await flush();

    expect(res.error).toBeNull();
    expect(res.data?.id).toBe('pay-1');
    warn.mockRestore();
  });

  it('no notification is sent when the review itself fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Payment is not awaiting review', code: 'P0001' } });
    const { paymentService } = await import('../services/paymentService');

    const res = await paymentService.reviewPayment('pay-1', 'approve');
    await flush();

    expect(res.error).toBeTruthy();
    expect(notify.notifyPaymentReviewed).not.toHaveBeenCalled();
  });

  it('submitting a payment reference confirms receipt to the payer', async () => {
    mockRpc.mockResolvedValue({ data: paymentRow({ status: 'payment_pending_review' }), error: null });
    const { paymentService } = await import('../services/paymentService');

    await paymentService.submitPaymentReference('pay-1', 'TX123');
    await flush();

    expect(notify.notifyPaymentSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'payer-1', paymentId: 'pay-1' })
    );
  });
});
