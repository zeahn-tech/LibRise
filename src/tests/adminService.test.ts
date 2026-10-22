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
    await adminService.moderateOpportunity('opp-1', 'quarantined');
    await adminService.moderateBusiness('biz-1', 'suspended');
    expect(mockRpc).toHaveBeenCalledWith('admin_moderate_opportunity', { p_id: 'opp-1', p_status: 'quarantined' });
    expect(mockRpc).toHaveBeenCalledWith('admin_moderate_business', { p_id: 'biz-1', p_status: 'suspended' });
  });

  it('a non-admin (42501) is surfaced as a permission error, not an empty list', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only platform administrators may perform this action.' } });
    const { adminService } = await import('../services/adminService');
    await expect(adminService.listUsers()).rejects.toThrow(/platform administrators/i);
  });
});
