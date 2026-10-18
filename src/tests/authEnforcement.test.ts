import { describe, it, expect } from 'vitest';
import { syncAuthEnforcement, BAN_DURATION, type EnforcementDeps, type DriftRow } from '../../server/authEnforcement';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const FUTURE = '9999-12-31T00:00:00Z';
const MINE = '2126-10-20T12:00:00Z';          // a banned_until value LibRise imposed earlier
const OPERATOR = '2026-11-30T00:00:00Z';      // a manual (operator) ban

interface Opts {
  drift?: DriftRow[];
  ban?: Record<string, string | null>;        // current banned_until per user
  setBan?: EnforcementDeps['setBan'];
  record?: EnforcementDeps['record'];
  listDrift?: EnforcementDeps['listDrift'];
  getBannedUntil?: EnforcementDeps['getBannedUntil'];
}
function deps(o: Opts = {}) {
  const calls: string[] = [];
  const recorded: Array<{ id: string; status: string; imposed: string | null | undefined }> = [];
  const ban: Record<string, string | null> = { ...(o.ban ?? {}) };
  const d: EnforcementDeps = {
    listDrift: o.listDrift ?? (async () => ({ data: o.drift ?? [{ user_id: 'u1', desired: 'ban' }], error: null })),
    setBan: o.setBan ?? (async (id, banned) => { calls.push(`set:${id}:${banned}`); ban[id] = banned ? FUTURE : null; return { error: null }; }),
    getBannedUntil: o.getBannedUntil ?? (async (id) => { calls.push(`get:${id}`); return { bannedUntil: ban[id] ?? null, error: null }; }),
    record: o.record ?? (async (id, status, _detail, imposed) => { calls.push(`record:${id}:${status}`); recorded.push({ id, status, imposed }); return { error: null }; }),
    now: () => NOW
  };
  return Object.assign(d, { calls, recorded, ban });
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

  it('bans an un-banned account, verifies, and records the value it imposed (ownership)', async () => {
    const d = deps({ ban: { u1: null } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(d.calls).toEqual(['get:u1', 'set:u1:true', 'get:u1', 'record:u1:applied']);
    expect(d.recorded[0].imposed).toBe(FUTURE);
  });

  it('does NOT report success when the Admin API call fails: 502, recorded as failed', async () => {
    const d = deps({ ban: { u1: null }, setBan: async () => ({ error: { message: 'upstream 500' } }) });
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
    const d = deps({ ban: { u1: '2020-01-01T00:00:00Z' }, setBan: async () => ({ error: null }) });
    expect((await syncAuthEnforcement(d)).status).toBe(502);   // still expired after the call -> failure
  });

  it('a thrown exception is a recorded failure, not a crash and not a success', async () => {
    const d = deps({ ban: { u1: null }, setBan: async () => { throw new Error('socket hang up'); } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results[0].detail).toContain('socket hang up');
  });

  it('fails when the result cannot be recorded (an unrecorded enforcement is not reported as success)', async () => {
    const d = deps({ ban: { u1: null }, record: async () => ({ error: { message: 'db down' } }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results[0].ok).toBe(false);
  });

  // ---------------- ownership (F-30) ----------------
  it('NEVER overwrites a ban that is already in effect, and claims no ownership of it', async () => {
    const d = deps({ ban: { u1: OPERATOR } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(d.calls.some((c) => c.startsWith('set:'))).toBe(false);
    expect(d.recorded[0]).toMatchObject({ status: 'applied', imposed: null });
    expect(out.body.results[0].detail).toContain('not imposed by LibRise');
  });

  it('keeps ownership when the ban already in effect is exactly the one LibRise recorded', async () => {
    const d = deps({ drift: [{ user_id: 'u1', desired: 'ban', imposed_banned_until: MINE }], ban: { u1: MINE } });
    await syncAuthEnforcement(d);
    expect(d.calls.some((c) => c.startsWith('set:'))).toBe(false);
    expect(d.recorded[0].imposed).toBe(MINE);
  });

  it('unbans only a ban whose CURRENT value equals the one LibRise recorded, and verifies it is gone', async () => {
    const d = deps({ drift: [{ user_id: 'u2', desired: 'unban', imposed_banned_until: MINE }], ban: { u2: MINE } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(d.calls).toEqual(['get:u2', 'set:u2:false', 'get:u2', 'record:u2:cleared']);
    expect(d.recorded[0].imposed).toBeNull();
  });

  it('LEAVES a ban in place when it is not the one LibRise recorded, even if the report listed the account (TOCTOU / manual change)', async () => {
    const d = deps({ drift: [{ user_id: 'u2', desired: 'unban', imposed_banned_until: MINE }], ban: { u2: OPERATOR } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(d.calls.some((c) => c.startsWith('set:'))).toBe(false);
    expect(d.ban.u2).toBe(OPERATOR);
    expect(out.body.results[0].detail).toContain('left in place');
  });

  it('LEAVES a ban in place when LibRise recorded no ownership at all (operator ban, even with a failed record)', async () => {
    const d = deps({ drift: [{ user_id: 'u3', desired: 'unban', imposed_banned_until: null }], ban: { u3: OPERATOR } });
    await syncAuthEnforcement(d);
    expect(d.calls.some((c) => c.startsWith('set:'))).toBe(false);
    expect(d.ban.u3).toBe(OPERATOR);
  });

  it("compares 'infinity' ownership values (the SQL path) without mis-parsing them", async () => {
    const d = deps({
      drift: [{ user_id: 'u4', desired: 'unban', imposed_banned_until: 'infinity' }],
      getBannedUntil: (() => { let n = 0; return async () => ({ bannedUntil: n++ === 0 ? 'infinity' : null, error: null }); })()
    });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(d.calls).toContain('set:u4:false');
  });

  it('a failed unban is recorded as cleared_failed and returns 502 (ownership is kept for the retry)', async () => {
    const d = deps({ drift: [{ user_id: 'u2', desired: 'unban', imposed_banned_until: MINE }], ban: { u2: MINE }, setBan: async () => ({ error: { message: 'upstream 500' } }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(d.calls).toContain('record:u2:cleared_failed');
    expect(d.recorded[0].imposed).toBeNull();   // the server passes nothing; the database keeps the stored value on *_failed
  });

  it('honours a userId filter and leaves other accounts alone', async () => {
    const d = deps({ drift: [{ user_id: 'a', desired: 'ban' }, { user_id: 'b', desired: 'ban' }], ban: { a: null, b: null } });
    const out = await syncAuthEnforcement(d, { userId: 'b' });
    expect(out.body.results.map((r) => r.userId)).toEqual(['b']);
    expect(d.calls.filter((c) => c.startsWith('set:'))).toEqual(['set:b:true']);
  });

  it('never touches an account that is not in the database-generated report, whatever userId is requested', async () => {
    const d = deps({ drift: [{ user_id: 'only-this-one', desired: 'ban' }] });
    const out = await syncAuthEnforcement(d, { userId: 'some-other-user' });
    expect(out.status).toBe(200);
    expect(out.body.results).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  it('continues with the remaining accounts when one fails, and reports the failure', async () => {
    const d = deps({
      drift: [{ user_id: 'a', desired: 'ban' }, { user_id: 'b', desired: 'ban' }], ban: { a: null, b: null },
      setBan: async (id) => (id === 'a' ? { error: { message: 'nope' } } : { error: null })
    });
    // b's ban call succeeds but the state never changes in this stub, so b fails verification too: both are reported
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(out.body.results.map((r) => r.userId)).toEqual(['a', 'b']);
    expect(out.body.results[0].ok).toBe(false);
  });

  it('success depends on the ban being in effect, not on any session state (the API cannot delete sessions)', async () => {
    const d = deps({ ban: { u1: null } });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(200);
    expect(out.body.results[0].detail).toContain('not deleted');
    expect(d.calls.some((c) => c.toLowerCase().includes('session'))).toBe(false);
  });

  it('nothing to enforce is a clean success', async () => {
    const out = await syncAuthEnforcement(deps({ listDrift: async () => ({ data: [], error: null }) }));
    expect(out.status).toBe(200);
    expect(out.body.results).toEqual([]);
  });

  it('an unreadable report is a 502, not a silent success', async () => {
    const out = await syncAuthEnforcement(deps({ listDrift: async () => ({ data: null, error: { message: 'timeout' } }) }));
    expect(out.status).toBe(502);
  });

  it('an unreadable current ban state is a recorded failure and no ban call is made', async () => {
    const d = deps({ getBannedUntil: async () => ({ bannedUntil: null, error: { message: 'auth admin 503' } }) });
    const out = await syncAuthEnforcement(d);
    expect(out.status).toBe(502);
    expect(d.calls.some((c) => c.startsWith('set:'))).toBe(false);
  });
});
