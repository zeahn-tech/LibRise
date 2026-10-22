/**
 * Live headline figures for the Discover sidebar ("Platform Pulse"). Every number comes from the
 * get_platform_pulse() database function -- nothing here is hardcoded or estimated.
 */
import { getSupabaseClient } from '../lib/supabaseClient';

export interface PlatformPulse {
  verifiedCandidates: number;
  openTenders: number;
  maAssetValueUsd: number;
  countiesActive: number;
  latestOpportunity: {
    title: string;
    type: string;
    county: string;
    organization: string | null;
    publishedAt: string;
  } | null;
  generatedAt: string;
}

interface PulseRow {
  verified_candidates: number;
  open_tenders: number;
  ma_asset_value_usd: number | string;
  counties_active: number;
  latest_opportunity: { title: string; type: string; county: string; organization: string | null; published_at: string } | null;
  generated_at: string;
}

export const platformPulseService = {
  async getPulse(): Promise<PlatformPulse> {
    const client = getSupabaseClient();
    if (!client) throw new Error('Live statistics are unavailable right now.');
    const { data, error } = await client.rpc('get_platform_pulse');
    if (error) throw new Error(error.message || 'Could not load live statistics.');
    const r = data as PulseRow;
    return {
      verifiedCandidates: Number(r.verified_candidates) || 0,
      openTenders: Number(r.open_tenders) || 0,
      maAssetValueUsd: Number(r.ma_asset_value_usd) || 0,
      countiesActive: Number(r.counties_active) || 0,
      latestOpportunity: r.latest_opportunity
        ? {
            title: r.latest_opportunity.title,
            type: r.latest_opportunity.type,
            county: r.latest_opportunity.county,
            organization: r.latest_opportunity.organization,
            publishedAt: r.latest_opportunity.published_at
          }
        : null,
      generatedAt: r.generated_at
    };
  }
};
