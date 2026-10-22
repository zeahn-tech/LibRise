import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAiAccess, resetAiAccessCache, PRO_REQUIRED } from '../../server/aiAccess';

describe('checkAiAccess (server-side Pro gate)', () => {
  beforeEach(() => {
    resetAiAccessCache();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('allows when the database says the user has AI access', async () => {
    const call = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await checkAiAccess({ callMyAiAccess: call }, 'u1', 'tok')).toEqual({ allowed: true });
    expect(call).toHaveBeenCalledWith('tok');
  });

  it('returns 402 for users who are not on the Pro plan', async () => {
    const call = vi.fn().mockResolvedValue({ data: false, error: null });
    expect(await checkAiAccess({ callMyAiAccess: call }, 'u2', 'tok')).toEqual({ allowed: false, status: 402, error: PRO_REQUIRED });
  });

  it('fails closed (503) when the check errors or throws, and does not cache the failure', async () => {
    const failing = vi.fn().mockResolvedValue({ data: null, error: { message: 'function not found' } });
    expect((await checkAiAccess({ callMyAiAccess: failing }, 'u3', 't')).status).toBe(503);
    const throwing = vi.fn().mockRejectedValue(new Error('network'));
    expect((await checkAiAccess({ callMyAiAccess: throwing }, 'u3', 't')).status).toBe(503);
    const ok = vi.fn().mockResolvedValue({ data: true, error: null });
    expect((await checkAiAccess({ callMyAiAccess: ok }, 'u3', 't')).allowed).toBe(true);
  });

  it('caches a decision briefly so every AI click is not a database round trip', async () => {
    let t = 1_000;
    const call = vi.fn().mockResolvedValue({ data: true, error: null });
    const deps = { callMyAiAccess: call, now: () => t };
    await checkAiAccess(deps, 'u4', 't');
    await checkAiAccess(deps, 'u4', 't');
    expect(call).toHaveBeenCalledTimes(1);
    t += 61_000;
    await checkAiAccess(deps, 'u4', 't');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
