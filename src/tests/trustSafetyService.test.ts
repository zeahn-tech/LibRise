import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Covers trustSafetyService.ts's RPC-call logic, row-mapping, and
 * error-translation by mocking '../lib/supabaseClient' and
 * '../services/authService' at the module boundary -- see
 * docs/PHASE3_SERVICE8_VERIFICATION.md for the live proof (the
 * server-side multi-report auto-quarantine count, atomic account
 * suspension, and non-admin rejection on every RPC) run directly against
 * the real project via the Supabase MCP connector.
 */

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc })
}));

vi.mock('../services/authService', () => ({
  authService: {
    getSession: vi.fn(() => ({
      user: { id: 'user-1', fullName: 'Jane Reporter', email: 'jane@example.com' },
      activeOrganization: null,
      isAuthenticated: true
    }))
  }
}));

function chain(result: { data: unknown; error: unknown }) {
  const builder: any = {};
  const methods = ['select', 'eq', 'order', 'insert', 'in'];
  for (const m of methods) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

describe('trustSafetyService', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockRpc.mockReset();
    vi.unstubAllGlobals();
  });

  it('submitReport(): calls the submit_content_report RPC (not a raw insert), never computing the report count client-side', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'report-1',
        report_type: 'listing',
        target_id: 'opp-1',
        target_title_or_name: 'Suspicious Job',
        reporter_user_id: 'user-1',
        reporter_name: 'Jane Reporter',
        reporter_email: 'jane@example.com',
        reason: 'scam_fee_charging',
        details: 'Asked for a fee',
        evidence_urls: [],
        status: 'pending',
        action_taken: null,
        admin_notes: null,
        reviewed_by_user_id: null,
        reviewed_by_name: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      error: null
    });

    const { trustSafetyService } = await import('../services/trustSafetyService');
    const report = await trustSafetyService.submitReport({
      reportType: 'listing',
      targetId: 'opp-1',
      targetTitleOrName: 'Suspicious Job',
      reason: 'scam_fee_charging',
      details: 'Asked for a fee'
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'submit_content_report',
      expect.objectContaining({ p_target_id: 'opp-1', p_reason: 'scam_fee_charging' })
    );
    expect(mockFrom).not.toHaveBeenCalledWith('content_reports');
    expect(report.status).toBe('pending');
  });

  it('resolveReport(): surfaces a 42501 (non-admin) as ForbiddenError', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only platform administrators may resolve reports.' } });

    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(trustSafetyService.resolveReport('report-1', 'dismissed', 'user-1')).rejects.toMatchObject({
      name: 'ForbiddenError'
    });
  });

  it('applyAccountRestriction(): calls the apply_account_restriction RPC, never updates users.account_status directly', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'restr-1',
        user_id: 'user-2',
        user_name: 'Target User',
        user_email: 'target@example.com',
        organization_id: null,
        restriction_type: 'full_suspension',
        reason: 'Scam pattern confirmed',
        issued_by_user_id: 'user-1',
        issued_by_name: 'Jane Reporter',
        expires_at: null,
        status: 'active',
        appeal_notes: null,
        created_at: new Date().toISOString(),
        updated_at: null
      },
      error: null
    });
    // the Auth side is already enforced (SQL path recorded 'applied'), so no backend call is needed
    mockFrom.mockImplementation((table: string) => chain({ data: table === 'account_auth_enforcement' ? { status: 'applied', detail: 'ok' } : null, error: null }));

    const { trustSafetyService } = await import('../services/trustSafetyService');
    const restriction = await trustSafetyService.applyAccountRestriction({
      userId: 'user-2',
      restrictionType: 'full_suspension',
      reason: 'Scam pattern confirmed'
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'apply_account_restriction',
      expect.objectContaining({ p_target_user_id: 'user-2', p_restriction_type: 'full_suspension' })
    );
    expect(mockFrom).not.toHaveBeenCalledWith('users');
    expect(restriction.status).toBe('active');
  });

  it('applyAccountRestriction(): surfaces a 42501 (non-admin) as ForbiddenError', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only platform administrators may restrict an account.' } });

    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(
      trustSafetyService.applyAccountRestriction({ userId: 'user-2', restrictionType: 'full_suspension', reason: 'x' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  it('isUserRestricted(): queries only the given user\'s own active restrictions (RLS narrows this further server-side)', async () => {
    const builder = chain({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    const { trustSafetyService } = await import('../services/trustSafetyService');
    await trustSafetyService.isUserRestricted('user-1', 'posting');

    expect(mockFrom).toHaveBeenCalledWith('account_restrictions');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('isUserRestricted(): a full_suspension restriction blocks every action type', async () => {
    mockFrom.mockReturnValue(chain({ data: [{ restriction_type: 'full_suspension', reason: 'Fraud' }], error: null }));

    const { trustSafetyService } = await import('../services/trustSafetyService');
    const res = await trustSafetyService.isUserRestricted('user-1', 'messaging');

    expect(res.isRestricted).toBe(true);
    expect(res.reason).toMatch(/Account suspended/);
  });

  it('scanContentForScams(): flags a known scam phrase and recommends quarantine for high-severity hits', async () => {
    const { TrustSafetyService } = await import('../services/trustSafetyService');
    const svc = new TrustSafetyService();

    const result = svc.scanContentForScams('Easy job', 'Please pay a registration fee upfront to secure this role.');

    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.recommendedStatus).toBe('quarantined');
  });

  const fullSuspensionRow = (over: Record<string, unknown> = {}) => ({
    id: 'restr-9', user_id: 'user-2', user_name: 'T', user_email: 't@example.com', organization_id: null,
    restriction_type: 'full_suspension', reason: 'r', issued_by_user_id: 'user-1', issued_by_name: 'A',
    expires_at: null, status: 'active', appeal_notes: null, created_at: new Date().toISOString(), updated_at: null, ...over
  });

  it('applyAccountRestriction(): when the Auth ban is missing it runs the backend sync and succeeds only if that succeeds', async () => {
    mockRpc.mockResolvedValue({ data: fullSuspensionRow(), error: null });
    mockFrom.mockImplementation((table: string) => chain({ data: table === 'account_auth_enforcement' ? { status: 'failed', detail: 'permission denied' } : null, error: null }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    (await import('../services/authService')).authService.getSession = vi.fn(() => ({ token: 'admin-token', isAuthenticated: true })) as never;

    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(trustSafetyService.applyAccountRestriction({ userId: 'user-2', restrictionType: 'full_suspension', reason: 'r' })).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/admin/auth-enforcement/sync');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer admin-token');
  });

  it('applyAccountRestriction(): does NOT report success when authentication enforcement fails (and says what is in place)', async () => {
    mockRpc.mockResolvedValue({ data: fullSuspensionRow(), error: null });
    mockFrom.mockImplementation((table: string) => chain({ data: table === 'account_auth_enforcement' ? { status: 'failed', detail: 'x' } : null, error: null }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: '1 account(s) could not be enforced', results: [{ detail: 'admin api: upstream 500' }] }) }));
    (await import('../services/authService')).authService.getSession = vi.fn(() => ({ token: 'admin-token', isAuthenticated: true })) as never;

    const { trustSafetyService } = await import('../services/trustSafetyService');
    const p = trustSafetyService.applyAccountRestriction({ userId: 'user-2', restrictionType: 'full_suspension', reason: 'r' });
    await expect(p).rejects.toThrow(/database access is already blocked.*did NOT complete.*upstream 500/s);
  });

  it('applyAccountRestriction(): an unreachable enforcement backend is also reported as a failure', async () => {
    mockRpc.mockResolvedValue({ data: fullSuspensionRow(), error: null });
    mockFrom.mockImplementation(() => chain({ data: null, error: null }));   // no enforcement record at all
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    (await import('../services/authService')).authService.getSession = vi.fn(() => ({ token: 'admin-token', isAuthenticated: true })) as never;

    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(trustSafetyService.applyAccountRestriction({ userId: 'user-2', restrictionType: 'full_suspension', reason: 'r' })).rejects.toThrow(/unreachable/);
  });

  it('applyAccountRestriction(): a non-suspension restriction never triggers Auth enforcement', async () => {
    mockRpc.mockResolvedValue({ data: fullSuspensionRow({ restriction_type: 'posting_disabled' }), error: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { trustSafetyService } = await import('../services/trustSafetyService');
    await trustSafetyService.applyAccountRestriction({ userId: 'user-2', restrictionType: 'posting_disabled', reason: 'r' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('liftAccountRestriction(): while another qualifying suspension remains the account must stay banned (no unban expected, no sync)', async () => {
    mockRpc.mockResolvedValue({ data: fullSuspensionRow({ status: 'lifted' }), error: null });
    mockFrom.mockImplementation((table: string) =>
      table === 'account_restrictions' ? chain({ data: [{ id: 'restr-other', expires_at: null }], error: null })
                                       : chain({ data: { status: 'applied', detail: 'ok' }, error: null }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(trustSafetyService.liftAccountRestriction('restr-9')).resolves.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('liftAccountRestriction(): after the LAST suspension is lifted a ban that was not cleared is detected and reported', async () => {
    mockRpc.mockResolvedValue({ data: fullSuspensionRow({ status: 'lifted' }), error: null });
    mockFrom.mockImplementation((table: string) =>
      table === 'account_restrictions' ? chain({ data: [], error: null })
                                       : chain({ data: { status: 'cleared_failed', detail: 'x' }, error: null }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Authentication enforcement is not configured on this server.' }) }));
    (await import('../services/authService')).authService.getSession = vi.fn(() => ({ token: 'admin-token', isAuthenticated: true })) as never;
    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(trustSafetyService.liftAccountRestriction('restr-9')).rejects.toThrow(/restored.*did NOT complete.*not configured/s);
  });
});
