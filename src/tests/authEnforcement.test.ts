import { describe, it, expect, vi } from 'vitest';
import { syncAuthEnforcement, BAN_DURATION, type EnforcementDeps } from '../../server/authEnforcement';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const FUTURE = '9999-12-31T00:00:00Z';

function deps(over: Partial<EnforcementDeps> = {}): EnforcementDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: EnforcementDeps = {
    listDrift: async () => ({ data: [{ user_id: 'u1', desired: 'ban' }], error: null }),
    setBan: async (id, banned) => { calls.push(`set:${id}:${banned}`); return { error: null }; },
    getBannedUntil: async (id) => { calls.push(`get:${id}`); return { bannedUntil: FUTURE, error: null }; },
    record: async (id, status) => { calls.push(`record:${id}:${status}`); return { error: null }; },
    now: () => NOW
  };
  return Object.assign({ ...base, ...over }, { calls });
}

describe('syncAuthEnforcement (supported Auth Admin API path)', () => {
  it('uses a 100-year ban duration', () => { expect(BAN_DURATION).toBe('876000h'); });

  it('rejects a caller who is not a platform administrator (403) and touches nothing', async () => {
    const d = deps({ listDrift: async () => ({ data: null, error: { code: '42501', message: 'Only platform administrators may run this report.' } }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(403);
    expect(out.body.success).toBe(false);
    expect(d.calls).toEqual([]);
  });

  it('bans, verifies and records "applied" on success', async () => {
    const d = deps();
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(d.calls).toEqual(['set:u1:true', 'get:u1', 'record:u1:applied']);
  });

  it('does NOT report success when the Admin API call fails: 502, recorded as failed', async () => {
    const d = deps({ setBan: async () => ({ error: { message: 'upstream 500' } }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.success).toBe(false);
    expect(out.body.failed).toBe(1);
    expect(out.body.results[0].detail).toContain('upstream 500');
    expect(d.calls).toContain('record:u1:failed');
  });

  it('does NOT trust the API response: a ban that is not in effect afterwards is a failure', async () => {
    const d = deps({ getBannedUntil: async () => ({ bannedUntil: null, error: null }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results[0].detail).toContain('not in effect');
    expect(d.calls).toContain('record:u1:failed');
  });

  it('treats an expired banned_until as not in effect', async () => {
    const d = deps({ getBannedUntil: async () => ({ bannedUntil: '2020-01-01T00:00:00Z', error: null }) });
    expect((await syncAuthEnforcement(d)).status).toBe(502);
  });

  it('a thrown exception is a recorded failure, not a crash and not a success', async () => {
    const d = deps({ setBan: async () => { throw new Error('socket hang up'); } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results[0].detail).toContain('socket hang up');
  });

  it('fails when the result cannot be recorded (an unrecorded enforcement is not reported as success)', async () => {
    const d = deps({ record: async () => ({ error: { message: 'db down' } }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results[0].ok).toBe(false);
  });

  it('unbans only the accounts the report lists as desired=unban, and verifies the ban is gone', async () => {
    const seen: string[] = [];
    const d = deps({
      listDrift: async () => ({ data: [{ user_id: 'u2', desired: 'unban' }], error: null }),
      getBannedUntil: async (id) => { seen.push(`get:${id}`); return { bannedUntil: null, error: null }; }
    });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(d.calls).toEqual(['set:u2:false', 'record:u2:cleared']);
    expect(seen).toEqual(['get:u2']);   // the ban state is read back before success is recorded
  });

  it('a failed unban is recorded as cleared_failed and returns 502', async () => {
    const d = deps({
      listDrift: async () => ({ data: [{ user_id: 'u2', desired: 'unban' }], error: null }),
      getBannedUntil: async () => ({ bannedUntil: FUTURE, error: null })
    });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(d.calls).toContain('record:u2:cleared_failed');
  });

  it('honours a userId filter and leaves other accounts alone', async () => {
    const d = deps({ listDrift: async () => ({ data: [{ user_id: 'a', desired: 'ban' }, { user_id: 'b', desired: 'ban' }], error: null }) });
    const out = await syncAuthEnforcement(d, { userId: 'b' });
    expect(out.body.results.map((r) => r.userId)).toEqual(['b']);
    expect(d.calls.filter((c) => c.startsWith('set:'))).toEqual(['set:b:true']);
  });

  it('continues with the remaining accounts when one fails, and reports the failure', async () => {
    const d = deps({
      listDrift: async () => ({ data: [{ user_id: 'a', desired: 'ban' }, { user_id: 'b', desired: 'ban' }], error: null }),
      setBan: async (id) => (id === 'a' ? { error: { message: 'nope' } } : { error: null })
    });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results.map((r) => r.ok)).toEqual([false, true]);
  });

  it('nothing to enforce is a clean success', async () => {
    const out = await syncAuthEnforcement(deps({ listDrift: async () => ({ data: [], error: null }) }));
    expect(out.status).toBe(200);
    expect(out.body.results).toEqual([]);
  });

  it('an unreadable report is a 502, not a silent success', async () => {
    const out = await syncAuthEnforcement(deps({ listDrift: async () => ({ data: null, error: { message: 'timeout' } }) }));
    expect(out.status).toBe(502);
    vi.restoreAllMocks();
  });
});
