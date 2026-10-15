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
 * Rules:
 *  - never reports success when any ban/unban failed (HTTP 502 with per-account detail);
 *  - never auto-unbans an account unless LibRise itself banned it (enforced by the report);
 *  - the dependencies are injected, so this file holds no credentials: server.ts builds them
 *    from server-only environment variables.
 */
export interface DriftRow {
  user_id: string;
  desired: 'ban' | 'unban';
  [key: string]: unknown;
}

export interface EnforcementDeps {
  /** list_auth_enforcement_drift() called with the CALLER's token (authorises the request). */
  listDrift(): Promise<{ data: DriftRow[] | null; error: { code?: string; message: string } | null }>;
  /** Auth Admin API: PUT /admin/users/{id} { ban_duration } */
  setBan(userId: string, banned: boolean): Promise<{ error: { message: string } | null }>;
  /** Auth Admin API: GET /admin/users/{id} -> banned_until */
  getBannedUntil(userId: string): Promise<{ bannedUntil: string | null; error: { message: string } | null }>;
  /** record_auth_enforcement(): privileged, server-side only. */
  record(userId: string, status: 'applied' | 'failed' | 'cleared' | 'cleared_failed', detail: string): Promise<{ error: { message: string } | null }>;
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

  for (const row of rows) {
    const banned = row.desired === 'ban';
    let ok = false;
    let detail = '';
    try {
      const set = await deps.setBan(row.user_id, banned);
      if (set.error) {
        detail = `admin api: ${set.error.message}`;
      } else {
        const check = await deps.getBannedUntil(row.user_id);
        if (check.error) {
          detail = `verify: ${check.error.message}`;
        } else {
          const inEffect = check.bannedUntil !== null && Date.parse(check.bannedUntil) > now();
          if (banned && !inEffect) detail = 'verify: ban is not in effect after the admin API call';
          else if (!banned && inEffect) detail = 'verify: ban was not cleared after the admin API call';
          else { ok = true; detail = banned ? 'ban applied via admin api' : 'ban cleared via admin api'; }
        }
      }
    } catch (err) {
      detail = `exception: ${(err as Error).message}`;
    }

    const status = banned ? (ok ? 'applied' : 'failed') : (ok ? 'cleared' : 'cleared_failed');
    try {
      const rec = await deps.record(row.user_id, status, detail);
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
