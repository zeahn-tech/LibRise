import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc: mockRpc }) }));

describe('platformPulseService', () => {
  beforeEach(() => mockRpc.mockReset());

  it('maps the database aggregates to numbers and the latest opportunity', async () => {
    mockRpc.mockResolvedValue({
      data: {
        verified_candidates: 87,
        open_tenders: 3,
        ma_asset_value_usd: '1250000.50',
        counties_active: 9,
        latest_opportunity: { title: 'Road maintenance', type: 'tender', county: 'Nimba', organization: 'MPW', published_at: '2026-10-20T00:00:00Z' },
        generated_at: '2026-10-22T00:00:00Z'
      },
      error: null
    });
    const { platformPulseService } = await import('../services/platformPulseService');
    const p = await platformPulseService.getPulse();
    expect(mockRpc).toHaveBeenCalledWith('get_platform_pulse');
    expect(p).toMatchObject({ verifiedCandidates: 87, openTenders: 3, maAssetValueUsd: 1250000.5, countiesActive: 9 });
    expect(p.latestOpportunity?.county).toBe('Nimba');
  });

  it('returns zeros and no ticker when the database is empty (never invented numbers)', async () => {
    mockRpc.mockResolvedValue({
      data: { verified_candidates: 0, open_tenders: 0, ma_asset_value_usd: 0, counties_active: 0, latest_opportunity: null, generated_at: 'x' },
      error: null
    });
    const { platformPulseService } = await import('../services/platformPulseService');
    const p = await platformPulseService.getPulse();
    expect(p.verifiedCandidates).toBe(0);
    expect(p.latestOpportunity).toBeNull();
  });

  it('throws when the RPC fails so the UI can show an error instead of fake figures', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    const { platformPulseService } = await import('../services/platformPulseService');
    await expect(platformPulseService.getPulse()).rejects.toThrow(/function not found/);
  });
});
