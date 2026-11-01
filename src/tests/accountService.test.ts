import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mockRpc = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc: mockRpc }) }));
vi.mock('../services/authService', () => ({ authService: { getSession: () => ({ token: 'tok-1' }) } }));
vi.mock('../config/env', () => ({ envConfig: { apiBaseUrl: 'https://api.example.test/api/' } }));

describe('accountService', () => {
  beforeEach(() => {
    vi.resetModules();
    mockRpc.mockReset();
    vi.unstubAllGlobals();
  });

  it('getDeletionBlockers returns what the database reports', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: 'payment_pending', message: 'Wait.' }], error: null });
    const { accountService } = await import('../services/accountService');
    expect(await accountService.getDeletionBlockers()).toEqual([{ code: 'payment_pending', message: 'Wait.' }]);
    expect(mockRpc).toHaveBeenCalledWith('account_deletion_blockers');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(accountService.getDeletionBlockers()).rejects.toThrow('denied');
  });

  it('deleteMyAccount posts the confirmation and password with the session token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, warnings: ['x'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { accountService } = await import('../services/accountService');
    await expect(accountService.deleteMyAccount('pw', 'DELETE')).resolves.toEqual({ warnings: ['x'] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/account/delete');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw', confirm: 'DELETE' });
  });

  it('turns server refusals into errors that carry the message and blockers; never reports success on failure', async () => {
    const blockers = [{ code: 'organization_owner', message: 'You are the only owner of Acme.' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'You are the only owner of Acme.', blockers }), { status: 409 })));
    const { accountService, AccountDeletionError } = await import('../services/accountService');
    const err = await accountService.deleteMyAccount('pw', 'DELETE').catch((e) => e);
    expect(err).toBeInstanceOf(AccountDeletionError);
    expect(err.message).toBe('You are the only owner of Acme.');
    expect(err.status).toBe(409);
    expect(err.blockers).toEqual(blockers);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(accountService.deleteMyAccount('pw', 'DELETE')).rejects.toThrow(/could not be deleted/i);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(accountService.deleteMyAccount('pw', 'DELETE')).rejects.toThrow(/Nothing was changed/);
  });
});

describe('delete account UI', () => {
  const dialog = readFileSync('src/components/auth/DeleteAccountDialog.tsx', 'utf8');
  const modal = readFileSync('src/components/auth/UserProfileModal.tsx', 'utf8');

  it('is reachable from the Security tab and signs the person out when finished', () => {
    expect(modal).toContain('<DeleteAccountDialog');
    expect(modal).toMatch(/Delete my account…/);
    expect(modal).toMatch(/onFinished=\{async \(\) => \{[\s\S]*await logout\(\)/);
  });

  it('requires the password and the typed word DELETE, lists what is deleted and kept, and shows blockers', () => {
    expect(dialog).toContain("confirmText === 'DELETE'");
    expect(dialog).toContain('password.length > 0');
    expect(dialog).toContain('blockers.length === 0');
    expect(dialog).toMatch(/What will be deleted/);
    expect(dialog).toMatch(/What we keep/);
    expect(dialog).toMatch(/Before you can delete your account/);
  });

  it('the privacy policy describes this feature (and no longer says deletion is email-only)', async () => {
    const { LEGAL_DOCUMENTS } = await import('../legal/documents');
    const text = LEGAL_DOCUMENTS.privacy.sections.flatMap((s) => s.blocks.map((b) => (b.t === 'ul' ? b.items.join(' ') : b.t === 'table' ? b.rows.flat().join(' ') : b.text))).join('\n');
    expect(text).toMatch(/delete your account yourself/i);
    expect(text).toMatch(/Deleted user/);
    expect(text).not.toMatch(/no one-tap account deletion/i);
  });
});
