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

export class AccountDeletionError extends Error {
  constructor(message: string, public readonly status: number, public readonly blockers: DeletionBlocker[] = []) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

export const accountService = {
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
      res = await fetch(`${envConfig.apiBaseUrl.replace(/\/+$/, '')}/account/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password, confirm })
      });
    } catch {
      throw new AccountDeletionError('Could not reach the server. Check your connection and try again. Nothing was changed.', 0);
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
