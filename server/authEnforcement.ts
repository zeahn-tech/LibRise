/**
 * Supported-API enforcement of account bans (F-19c).
 *
 * The database is the source of truth: apply_account_restriction()/lift_account_restriction()
 * and every other path that changes users.account_status (or inserts a full_suspension row)
 * deny the account all data access immediately, and best-effort ban the Auth user with SQL
 * (set_auth_ban). Direct SQL writes to auth.* are NOT a documented Supabase contract, so this
 * module is the supported path: it reads the drift report as the CALLER (only platform
 * administrators may), applies/clears the ban through the Auth Admin API
 * (`ban_duration`), verifies the result, and records it through a service-role-only function.
 *
 * Session semantics (verified against the GoTrue source, supabase/auth internal/api/admin.go):
 * the admin update with `ban_duration` ONLY sets auth.users.banned_until. It does not delete
 * sessions or refresh tokens, and there is no admin endpoint that deletes another user's
 * sessions. So a correctly banned account normally KEEPS its auth.sessions / refresh-token rows;
 * GoTrue refuses to use them (refresh: "User Banned"; password grant refused; the user's old
 * access token is rejected by GoTrue's own endpoints). This module therefore verifies the BAN
 * (banned_until in the future), never the absence of session rows. An access token issued
 * before the ban still validates against services that only check the JWT (PostgREST
 * signature/exp, Realtime, Storage) until it expires (GOTRUE_JWT_EXP, default 3600 s); LibRise
 * data is protected meanwhile by the database account-status policies, not by this module.
 *
 * Ban OWNERSHIP (F-30): LibRise only ever clears a ban it imposed, identified by the exact
 * banned_until value it recorded (account_auth_enforcement.imposed_banned_until). A ban that is
 * already in effect when LibRise needs one is never overwritten (no ownership is claimed), and an
 * unban is skipped unless the CURRENT value still equals the recorded one (re-read at call time,
 * not trusted from the report). An operator's manual ban therefore survives.
 *
 * Rules:
 *  - never reports success when any ban/unban failed (HTTP 502 with per-account detail);
 *  - never auto-unbans an account whose current ban is not the one LibRise recorded;
 *  - the dependencies are injected, so this file holds no credentials: server.ts builds them
 *    from server-only environment variables.
 */
export interface DriftRow {
  user_id: string;
  desired: 'ban' | 'unban';
  /** value LibRise recorded when it imposed a ban (null = LibRise owns no ban for this account) */
  imposed_banned_until?: string | null;
  [key: string]: unknown;
}

export interface EnforcementDeps {
  /** list_auth_enforcement_drift() called with the CALLER's token (authorises the request). */
  listDrift(): Promise<{ data: DriftRow[] | null; error: { code?: string; message: string } | null }>;
  /** Auth Admin API: PUT /admin/users/{id} { ban_duration } */
  setBan(userId: string, banned: boolean): Promise<{ error: { message: string } | null }>;
  /** Auth Admin API: GET /admin/users/{id} -> banned_until */
  getBannedUntil(userId: string): Promise<{ bannedUntil: string | null; error: { message: string } | null }>;
  /** record_auth_enforcement(): privileged, server-side only. `imposedBannedUntil` = the ban value LibRise wrote (null = none). */
  record(userId: string, status: 'applied' | 'failed' | 'cleared' | 'cleared_failed', detail: string, imposedBannedUntil?: string | null): Promise<{ error: { message: string } | null }>;
  now?: () => number;
}

export interface EnforcementResult {
  userId: string;
  desired: 'ban' | 'unban';
  ok: boolean;
  detail: string;
}

export interface EnforcementResponse {
  status: 200 | 403 | 502;
  body: { success: boolean; error?: string; failed?: number; results: EnforcementResult[] };
}

// 100 years: GoTrue's ban_duration is a Go duration string; 'none' clears the ban.
export const BAN_DURATION = '876000h';

export async function syncAuthEnforcement(deps: EnforcementDeps, opts: { userId?: string } = {}): Promise<EnforcementResponse> {
  const now = deps.now ?? Date.now;
  const drift = await deps.listDrift();
  if (drift.error) {
    if (drift.error.code === '42501') {
      return { status: 403, body: { success: false, error: 'Platform administrator access required.', results: [] } };
    }
    return { status: 502, body: { success: false, error: `Could not read the enforcement report: ${drift.error.message}`, results: [] } };
  }

  const rows = (drift.data ?? []).filter((r) => !opts.userId || r.user_id === opts.userId);
  const results: EnforcementResult[] = [];

  const inEffect = (v: string | null): boolean => v !== null && (v.toLowerCase() === 'infinity' || Date.parse(v) > now());
  const sameInstant = (a: string | null | undefined, b: string | null | undefined): boolean => {
    if (!a || !b) return false;
    if (a.toLowerCase() === b.toLowerCase()) return true;
    const x = Date.parse(a), y = Date.parse(b);
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  };

  for (const row of rows) {
    const banned = row.desired === 'ban';
    let ok = false;
    let detail = '';
    let status: 'applied' | 'failed' | 'cleared' | 'cleared_failed' = banned ? 'failed' : 'cleared_failed';
    let imposed: string | null = null;
    try {
      const pre = await deps.getBannedUntil(row.user_id);   // re-read: never trust the report for a destructive step
      if (pre.error) {
        detail = `read: ${pre.error.message}`;
      } else if (banned && inEffect(pre.bannedUntil)) {
        // a ban is already in effect: do NOT overwrite it and do NOT claim it
        ok = true; status = 'applied';
        imposed = sameInstant(pre.bannedUntil, row.imposed_banned_until) ? pre.bannedUntil : null;
        detail = imposed ? 'ban already in effect (imposed by LibRise)' : 'ban already in effect; not imposed by LibRise';
      } else if (!banned && !sameInstant(pre.bannedUntil, row.imposed_banned_until)) {
        // the current ban is not the one LibRise recorded (changed or replaced by someone else): leave it
        ok = true; status = 'cleared';
        detail = inEffect(pre.bannedUntil) ? 'the current ban is not the one LibRise imposed; left in place' : 'no LibRise-imposed ban to clear';
      } else {
        const set = await deps.setBan(row.user_id, banned);
        if (set.error) {
          detail = `admin api: ${set.error.message}`;
        } else {
          const check = await deps.getBannedUntil(row.user_id);
          if (check.error) {
            detail = `verify: ${check.error.message}`;
          } else if (banned && !inEffect(check.bannedUntil)) {
            detail = 'verify: ban is not in effect after the admin API call';
          } else if (!banned && inEffect(check.bannedUntil)) {
            detail = 'verify: ban was not cleared after the admin API call';
          } else {
            ok = true;
            status = banned ? 'applied' : 'cleared';
            imposed = banned ? check.bannedUntil : null;
            detail = banned ? 'ban applied via admin api (existing sessions stop refreshing; they are not deleted)' : 'ban cleared via admin api';
          }
        }
      }
    } catch (err) {
      detail = `exception: ${(err as Error).message}`;
    }

    try {
      const rec = await deps.record(row.user_id, status, detail, imposed);
      if (rec.error) {
        ok = false;
        detail = `${detail}; could not record the result: ${rec.error.message}`;
      }
    } catch (err) {
      ok = false;
      detail = `${detail}; could not record the result: ${(err as Error).message}`;
    }
    results.push({ userId: row.user_id, desired: row.desired, ok, detail });
  }

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    return { status: 502, body: { success: false, error: `${failed} account(s) could not be enforced`, failed, results } };
  }
  return { status: 200, body: { success: true, failed: 0, results } };
}
