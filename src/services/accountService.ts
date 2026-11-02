/**
 * accountService.ts — deleting your own account.
 *
 * getDeletionBlockers() asks the database (read-only) whether anything must be sorted out first.
 * deleteMyAccount() calls the server, which re-checks everything, verifies the password, deletes the data, removes the
 * uploaded files and the sign-in account (see server/accountDeletion.ts). It never reports success unless the database
 * part really happened; leftover clean-up problems come back as `warnings`.
 */
import { getSupabaseClient } from '../lib/supabaseClient';
import { envConfig } from '../config/env';
import { authService } from './authService';

export interface DeletionBlocker {
  code: string;
  message: string;
}

export type ServerStatus = 'ready' | 'blocked' | 'unreachable';

export class AccountDeletionError extends Error {
  constructor(message: string, public readonly status: number, public readonly blockers: DeletionBlocker[] = []) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

const apiBase = () => envConfig.apiBaseUrl.replace(/\/+$/, '');

export const accountService = {
  /**
   * Can this website talk to the LibRise server?
   *   ready       the server answered and accepts requests from this website
   *   blocked     something answers, but the browser refused the reply: the server's ALLOWED_ORIGINS setting does not
   *               list this website (a setup problem, not a connection problem)
   *   unreachable nothing answered (server asleep or down, or the device is offline)
   * A normal request only succeeds when the server both answers and allows this website. A `no-cors` request succeeds
   * whenever anything answers, so comparing the two tells the cases apart. Hosts on free plans can take up to a minute
   * to wake a sleeping server, hence the long first timeout.
   */
  async checkServer(timeoutMs = 60000, retryDelayMs = 2000): Promise<ServerStatus> {
    const url = `${apiBase()}/ai/health`;
    const attempt = async (init: RequestInit, ms: number): Promise<'ok' | 'failed' | 'timeout'> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        await fetch(url, { ...init, signal: controller.signal });
        return 'ok';
      } catch (err) {
        return (err as Error)?.name === 'AbortError' || controller.signal.aborted ? 'timeout' : 'failed';
      } finally {
        clearTimeout(timer);
      }
    };

    const first = await attempt({}, timeoutMs);
    if (first === 'ok') return 'ready';
    if (first === 'timeout') return 'unreachable';

    // Failed quickly. A host that is mid-restart can fail once without meaning anything, so try once more.
    await new Promise((r) => setTimeout(r, retryDelayMs));
    if ((await attempt({}, timeoutMs)) === 'ok') return 'ready';

    return (await attempt({ mode: 'no-cors' }, 15000)) === 'ok' ? 'blocked' : 'unreachable';
  },

  async getDeletionBlockers(): Promise<DeletionBlocker[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase.rpc('account_deletion_blockers');
    if (error) throw new Error(error.message || 'Could not check whether your account can be deleted.');
    return Array.isArray(data) ? (data as DeletionBlocker[]) : [];
  },

  async deleteMyAccount(password: string, confirm: string): Promise<{ warnings: string[] }> {
    const token = authService.getSession().token;
    if (!token) throw new AccountDeletionError('Your session has expired. Please sign in again.', 401);

    let res: Response;
    try {
      res = await fetch(`${apiBase()}/account/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password, confirm })
      });
    } catch {
      throw new AccountDeletionError('Could not reach the server. Check your connection, wait a moment (the server may be starting up) and try again.', 0);
    }

    let body: { success?: boolean; error?: string; blockers?: DeletionBlocker[]; warnings?: string[] } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || body.success !== true) {
      throw new AccountDeletionError(body.error || 'Your account could not be deleted. Please try again.', res.status, body.blockers ?? []);
    }
    return { warnings: body.warnings ?? [] };
  }
};
