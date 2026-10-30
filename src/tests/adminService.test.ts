import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({ rpc: mockRpc, from: mockFrom })
}));

describe('adminService', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockReset();
  });

  it('listUsers(): maps admin_list_users rows to User objects', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'u1', email: 'a@b.com', full_name: 'Ada Lovelace', phone_number: null, primary_role: 'employer',
          system_role: 'moderator', account_status: 'active', avatar_url: null, primary_county: 'Nimba',
          is_email_verified: true, is_phone_verified: false, created_at: '2026-01-01T00:00:00Z', last_login_at: null
        }
      ],
      error: null
    });
    const { adminService } = await import('../services/adminService');
    const users = await adminService.listUsers();
    expect(mockRpc).toHaveBeenCalledWith('admin_list_users');
    expect(users[0]).toMatchObject({ id: 'u1', fullName: 'Ada Lovelace', systemRole: 'moderator', accountStatus: 'active', primaryCounty: 'Nimba' });
  });

  it('listAuditLogs(): maps resource_type to targetEntity and keeps the actor name', async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: 'a1', user_id: 'u1', actor_name: 'Ada', organization_id: null, action: 'user.role_change', resource_type: 'user', resource_id: 'u2', details: { to: 'moderator' }, ip_address: null, created_at: '2026-01-02T00:00:00Z' }],
      error: null
    });
    const { adminService } = await import('../services/adminService');
    const logs = await adminService.listAuditLogs(50);
    expect(mockRpc).toHaveBeenCalledWith('admin_list_audit_logs', { p_limit: 50 });
    expect(logs[0]).toMatchObject({ actorName: 'Ada', targetEntity: 'user', targetId: 'u2' });
  });

  it('moderation calls the matching RPC with the chosen status', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { adminService } = await import('../services/adminService');
    await adminService.moderateOpportunity('opp-1', 'quarantined', 'Asks applicants to pay a fee');
    await adminService.moderateOpportunity('opp-2', 'published');
    await adminService.moderateBusiness('biz-1', 'suspended');
    expect(mockRpc).toHaveBeenCalledWith('admin_moderate_opportunity', { p_id: 'opp-1', p_status: 'quarantined', p_note: 'Asks applicants to pay a fee' });
    expect(mockRpc).toHaveBeenCalledWith('admin_moderate_opportunity', { p_id: 'opp-2', p_status: 'published', p_note: null });
    expect(mockRpc).toHaveBeenCalledWith('admin_moderate_business', { p_id: 'biz-1', p_status: 'suspended' });
  });

  it('a non-admin (42501) is surfaced as a permission error, not an empty list', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only platform administrators may perform this action.' } });
    const { adminService } = await import('../services/adminService');
    await expect(adminService.listUsers()).rejects.toThrow(/platform administrators/i);
  });

  it('moderation without a reason surfaces the database message instead of a generic error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'A reason of at least 5 characters is required to quarantine or reject a vacancy.' } });
    const { adminService } = await import('../services/adminService');
    await expect(adminService.moderateOpportunity('opp-1', 'quarantined')).rejects.toThrow(/reason of at least 5/i);
  });

  it('getPlatformMetrics / getRevenueOverview return what the database computed', async () => {
    mockRpc.mockResolvedValueOnce({ data: { days: 7, totals: { users: 4 }, daily: [], counties: [], revenue: [], queues: {} }, error: null });
    mockRpc.mockResolvedValueOnce({ data: { totals: [], monthly: [] }, error: null });
    const { adminService } = await import('../services/adminService');
    expect((await adminService.getPlatformMetrics(7)).totals.users).toBe(4);
    expect(mockRpc).toHaveBeenCalledWith('admin_platform_metrics', { p_days: 7 });
    await adminService.getRevenueOverview(6);
    expect(mockRpc).toHaveBeenCalledWith('admin_revenue_overview', { p_months: 6 });
  });

  it('listPayments maps ledger rows and never invents missing names', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        id: 'pay-1', public_payment_id: 'OHL-AAAA-BBBB', organization_id: 'org-1', organization_name: null, plan_id: 'plan_pro', plan_name: 'Pro',
        payment_provider: 'MTN_MOMO', provider_transaction_id: 'TX1', sender_phone_number: '0886000000', amount_minor: 2500, currency: 'USD',
        status: 'payment_success', failure_reason: null, created_at: '2026-10-01T00:00:00Z', paid_at: '2026-10-01T01:00:00Z', reviewed_at: null, reviewed_by_name: null
      }],
      error: null
    });
    const { adminService } = await import('../services/adminService');
    const [p] = await adminService.listPayments();
    expect(mockRpc).toHaveBeenCalledWith('admin_list_payments', { p_limit: 500 });
    expect(p).toMatchObject({ publicPaymentId: 'OHL-AAAA-BBBB', organizationName: 'Unknown organization', amountMinor: 2500, status: 'payment_success' });
    expect(p.failureReason).toBeUndefined();
  });

  it('listSubscriptions maps real plan rows; setSubscription calls the audited RPC', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ organization_id: 'org-1', organization_name: 'Acme', industry: null, tier: 'basic', plan_id: 'plan_basic', status: 'active', billing_cycle: 'monthly', current_period_end: '2026-11-01T00:00:00Z', cancel_at_period_end: false }],
      error: null
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const { adminService } = await import('../services/adminService');
    const [sub] = await adminService.listSubscriptions();
    expect(sub).toMatchObject({ organizationId: 'org-1', tier: 'basic', industry: '' });
    await adminService.setSubscription('org-1', 'pro', 14);
    expect(mockRpc).toHaveBeenCalledWith('admin_set_subscription', { p_organization_id: 'org-1', p_tier: 'pro', p_days: 14 });
  });

  it('logAction writes a server-side audit entry', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { adminService } = await import('../services/adminService');
    await adminService.logAction('report.resolve', 'content_report', 'rep-1', { action: 'dismissed' });
    expect(mockRpc).toHaveBeenCalledWith('admin_log_action', { p_action: 'report.resolve', p_resource_type: 'content_report', p_resource_id: 'rep-1', p_details: { action: 'dismissed' } });
  });
});
