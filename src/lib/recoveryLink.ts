/**
 * Supabase emails a password-reset link that opens the app with the recovery
 * session in the URL hash (#access_token=...&type=recovery), or with an error
 * (#error=access_denied&error_code=otp_expired) when the link is expired or
 * already used. supabase-js consumes and clears that hash shortly after load,
 * so it is captured here, at import time, before anything can clear it.
 */
function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash.replace(/^#\/?/, '');
  const search = window.location.search.replace(/^\?/, '');
  return new URLSearchParams([hash, search].filter(Boolean).join('&'));
}

const params = readParams();

/** True when this page load came from a password-reset email link. */
export const openedFromRecoveryLink: boolean = params.get('type') === 'recovery' && !params.get('error');

/** Set when the reset link was rejected (expired / already used). */
export const recoveryLinkError: string | null = params.get('error')
  ? params.get('error_code') === 'otp_expired'
    ? 'This password reset link has expired or was already used. Request a new one below.'
    : (params.get('error_description') || 'This password reset link is not valid. Request a new one below.').replace(/\+/g, ' ')
  : null;

/** The app's own address (works under a sub-path such as /LibRise/), without hash or query. */
export function appBaseUrl(): string {
  return new URL('./', window.location.href).toString();
}

/** Remove recovery tokens/errors from the address bar once handled. */
export function clearRecoveryParamsFromUrl(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', appBaseUrl());
}
