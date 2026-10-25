import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mail, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const RESEND_COOLDOWN_SECONDS = 60;

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Real email-verification actions: resend the confirmation email (with a cooldown so people don't hit Supabase's
 * rate limit) and re-check the account after the person clicked the link (possibly on another device).
 */
export function useEmailVerification() {
  const { user, resendVerificationEmail, refreshEmailVerification } = useAuth();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = useCallback(async (): Promise<ActionResult> => {
    if (sending || cooldown > 0) return { ok: false, message: 'Please wait before requesting another email.' };
    setSending(true);
    try {
      await resendVerificationEmail();
      setCooldown(RESEND_COOLDOWN_SECONDS);
      return { ok: true, message: `Verification email sent to ${user?.email}. Check your inbox and spam folder, then open the newest link.` };
    } catch (err) {
      // Back off after a failure too, so a rate-limit message doesn't invite an immediate retry.
      setCooldown(15);
      return { ok: false, message: err instanceof Error ? err.message : 'Could not send the verification email.' };
    } finally {
      setSending(false);
    }
  }, [sending, cooldown, resendVerificationEmail, user?.email]);

  const check = useCallback(async (): Promise<ActionResult> => {
    if (checking) return { ok: false, message: '' };
    setChecking(true);
    try {
      const confirmed = await refreshEmailVerification();
      return confirmed
        ? { ok: true, message: 'Email verified. Your account is fully active.' }
        : { ok: false, message: 'Not verified yet. Open the link in the email we sent, then tap this again.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Could not check your verification status.' };
    } finally {
      setChecking(false);
    }
  }, [checking, refreshEmailVerification]);

  return { resend, check, sending, checking, cooldown };
}

/**
 * Completes confirmation links that arrive as ?token_hash=...&type=... (custom email template). Standard hash-token
 * links are completed by the Supabase client itself, and expired/used links are reported by the sign-in dialog
 * (see lib/recoveryLink).
 */
export function useEmailLinkCallback() {
  const { verifyEmail } = useAuth();
  const { showToast } = useToast();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || typeof window === 'undefined') return;
    handled.current = true;

    const query = new URLSearchParams(window.location.search);

    const tokenHash = query.get('token_hash');
    const type = query.get('type');
    if (tokenHash && type && ['signup', 'email', 'magiclink', 'email_change'].includes(type)) {
      verifyEmail(tokenHash)
        .then(() => showToast('Email verified. Your account is fully active.', 'success'))
        .catch((err) => showToast(err instanceof Error ? err.message : 'Verification failed.', 'error'))
        .finally(() => window.history.replaceState(null, '', window.location.pathname));
    }
  }, [verifyEmail, showToast]);
}

/** Banner shown while the signed-in account's email is unconfirmed. */
export const EmailVerificationBanner: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { resend, check, sending, checking, cooldown } = useEmailVerification();
  const [dismissed, setDismissed] = useState(false);
  const wasVerified = useRef(!!user?.isEmailVerified);

  useEmailLinkCallback();

  // Celebrate once when the status flips (e.g. the link was opened in this browser and the session refreshed).
  useEffect(() => {
    if (user?.isEmailVerified && !wasVerified.current) {
      showToast('Email verified. Your account is fully active.', 'success');
    }
    wasVerified.current = !!user?.isEmailVerified;
  }, [user?.isEmailVerified, showToast]);

  // When the person comes back to this tab after opening the email, re-check quietly.
  const lastAuto = useRef(0);
  useEffect(() => {
    if (!user || user.isEmailVerified) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastAuto.current < 10_000) return;
      lastAuto.current = Date.now();
      void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, check]);

  if (!user || user.isEmailVerified || dismissed) return null;

  const onResend = async () => {
    const r = await resend();
    showToast(r.message, r.ok ? 'success' : 'error');
  };
  const onCheck = async () => {
    const r = await check();
    if (r.message) showToast(r.message, r.ok ? 'success' : 'info');
  };

  return (
    <div role="status" className="bg-[#FEFAE0] border-b border-[#E8E4D9] px-4 py-3 text-xs text-[#283618]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 max-w-4xl mx-auto w-full">
        <div className="flex items-start gap-2 min-w-0 flex-1 basis-64">
          <AlertCircle className="w-4 h-4 text-[#BC6C25] shrink-0 mt-0.5" />
          <span>
            <strong>Confirm your email:</strong> we sent a link to <em className="break-all">{user.email}</em>. Open it to unlock your full account.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onResend}
            disabled={sending || cooldown > 0}
            className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl border border-[#BC6C25]/40 bg-white font-bold text-[#BC6C25] hover:bg-[#FEFAE0] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
          </button>
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-[#283618] font-bold text-white hover:bg-[#132A13] disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            I've verified
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="min-w-11 min-h-11 flex items-center justify-center rounded-xl text-[#606C38] hover:bg-black/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
