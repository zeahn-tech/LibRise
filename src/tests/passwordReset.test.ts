import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Forgot-password regression: the emailed link used window.location.origin +
 * '/#reset-password'. Hosted under a sub-path (https://user.github.io/LibRise/)
 * that points at https://user.github.io/ -- a page that does not exist (404).
 */
const mockResetPasswordForEmail = vi.fn();
let mockClient: any = null;
vi.mock('../lib/supabaseClient', () => ({ getSupabaseClient: () => mockClient }));

function stubWindow(href: string) {
  const u = new URL(href);
  vi.stubGlobal('window', {
    location: { href, origin: u.origin, hash: u.hash, search: u.search, pathname: u.pathname },
    history: { replaceState: vi.fn() }
  });
}

describe('password reset link', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResetPasswordForEmail.mockReset();
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    mockClient = { auth: { resetPasswordForEmail: mockResetPasswordForEmail, onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the emailed link points back at the app itself, including its sub-path, with no #fragment', async () => {
    stubWindow('https://zeahn-tech.github.io/LibRise/index.html#/something');
    const { authService } = await import('../services/authService');
    await authService.requestPasswordReset('a@b.com');
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('a@b.com', { redirectTo: 'https://zeahn-tech.github.io/LibRise/' });
  });

  it('works for an app served from the domain root too', async () => {
    stubWindow('https://librise.example.com/');
    const { authService } = await import('../services/authService');
    await authService.requestPasswordReset('a@b.com');
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('a@b.com', { redirectTo: 'https://librise.example.com/' });
  });

  it('a reset email link opens the set-new-password screen', async () => {
    stubWindow('https://zeahn-tech.github.io/LibRise/#access_token=abc&refresh_token=def&type=recovery');
    const mod = await import('../lib/recoveryLink');
    expect(mod.openedFromRecoveryLink).toBe(true);
    expect(mod.recoveryLinkError).toBeNull();
  });

  it('an expired link explains itself instead of showing a dead page', async () => {
    stubWindow('https://zeahn-tech.github.io/LibRise/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    const mod = await import('../lib/recoveryLink');
    expect(mod.openedFromRecoveryLink).toBe(false);
    expect(mod.recoveryLinkError).toMatch(/expired or was already used/i);
  });

  it('a normal page load is not treated as a recovery', async () => {
    stubWindow('https://zeahn-tech.github.io/LibRise/');
    const mod = await import('../lib/recoveryLink');
    expect(mod.openedFromRecoveryLink).toBe(false);
    expect(mod.recoveryLinkError).toBeNull();
  });
});
