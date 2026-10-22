import { describe, it, expect } from 'vitest';
import { FallbackAIProvider } from '../services/ai/fallbackAIProvider';

describe('FallbackAIProvider.scanForScams', () => {
  const provider = new FallbackAIProvider();

  it('flags advance-fee wording as high risk', async () => {
    const res = await provider.scanForScams({ text: 'Congratulations, you are hired. Send cash for the processing fee to start work.' });
    expect(res.riskLevel).toBe('high');
    expect(res.findings.length).toBeGreaterThan(0);
    expect(res.isHeuristic).toBe(true);
  });

  it('never claims an ordinary text is verified safe', async () => {
    const res = await provider.scanForScams({ text: 'We are hiring road maintenance supervisors in Ganta. Valid licence required. Apply with your CV.' });
    expect(res.riskLevel).toBe('low');
    expect(res.findings).toHaveLength(0);
    expect(res.recommendation).toMatch(/cannot confirm/i);
    expect(res.riskScore).toBeLessThan(20);
  });
});

import { vi, beforeEach } from 'vitest';

describe('aiService: plan refusals are surfaced, not bypassed', () => {
  beforeEach(() => vi.resetModules());

  it('a 402 from the server reaches the caller instead of silently using the offline engine', async () => {
    vi.doMock('../services/authService', () => ({ authService: { getSession: () => ({ token: 't' }) } }));
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/ai/health')) return { ok: true, json: async () => ({ configured: true, model: 'm' }) };
      return { ok: false, status: 402, json: async () => ({ error: 'Pro plan required' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { aiService } = await import('../services/ai/aiService');
    await expect(aiService.scanForScams({ text: 'Pay a registration fee to apply for this job today.' })).rejects.toThrow(/Pro plan required/);
    vi.unstubAllGlobals();
  });
});
