import { describe, it, expect, beforeEach, vi } from 'vitest';

const resend = vi.fn();
const getUser = vi.fn();
const refreshSession = vi.fn();
const verifyOtp = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: { resend, getUser, refreshSession, verifyOtp, getSession: vi.fn(async () => ({ data: { session: null } })) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', email: 'a@b.com', full_name: 'A', is_email_verified: true, account_status: 'active', primary_role: 'job_seeker', system_role: 'user' }, error: null }) }) }) })
  })
}));

async function loadService() {
  const { authService } = await import('../services/authService');
  (authService as any).currentSession = {
    ...(authService as any).currentSession,
    user: { id: 'u1', email: 'a@b.com', fullName: 'A', isEmailVerified: false, capabilities: [] },
    isAuthenticated: true
  };
  return authService;
}

describe('email verification', () => {
  beforeEach(() => {
    vi.resetModules();
    resend.mockReset().mockResolvedValue({ error: null });
    getUser.mockReset();
    refreshSession.mockReset().mockResolvedValue({ data: { session: null } });
    verifyOtp.mockReset();
  });

  it('resendVerificationEmail asks Supabase to resend the signup email for the signed-in address, redirecting back to the app', async () => {
    (globalThis as any).window = { location: { href: 'https://app.example/LibRise/?x=1#frag', hash: '', search: '' } };
    try {
      const auth = await loadService();
      await auth.resendVerificationEmail();
      expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.com', options: { emailRedirectTo: 'https://app.example/LibRise/' } });
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('resendVerificationEmail turns a rate-limit error into a friendly message', async () => {
    const auth = await loadService();
    resend.mockResolvedValue({ error: { message: 'For security purposes, you can only request this after 45 seconds.' } });
    await expect(auth.resendVerificationEmail()).rejects.toThrow(/wait a minute/i);
  });

  it('refreshEmailVerification returns false while unconfirmed and true once Supabase confirms the email', async () => {
    const auth = await loadService();
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com', email_confirmed_at: null } }, error: null });
    expect(await auth.refreshEmailVerification()).toBe(false);

    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com', email_confirmed_at: '2026-10-25T10:00:00Z' } }, error: null });
    expect(await auth.refreshEmailVerification()).toBe(true);
    expect(auth.getSession().user?.isEmailVerified).toBe(true);
  });

  it('verifyEmail maps an expired/invalid link to a clear message', async () => {
    const auth = await loadService();
    verifyOtp.mockResolvedValue({ data: {}, error: { message: 'Email link is invalid or has expired' } });
    await expect(auth.verifyEmail('bad')).rejects.toThrow(/invalid or has expired.*new email/i);
    expect(verifyOtp).toHaveBeenCalledTimes(2); // 'email' then 'signup'
  });
});
