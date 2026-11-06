/**
 * authErrors.ts — turns the technical errors returned by the sign-in service into plain language.
 *
 * People must never see text like "Database error querying schema". Anything we do not recognise becomes a calm,
 * context-appropriate sentence instead of being passed through, so internal details never reach the screen.
 */

export type AuthErrorContext = 'signin' | 'signup' | 'reset' | 'password';

const FALLBACK: Record<AuthErrorContext, string> = {
  signin: 'We couldn’t sign you in right now. Please check your email and password, or create an account if you don’t have one yet. If this keeps happening, try again in a few minutes.',
  signup: 'We couldn’t create your account right now. If you already registered, try signing in instead; otherwise please try again in a few minutes.',
  reset: 'We couldn’t send the reset email right now. Please check the address and try again in a few minutes.',
  password: 'We couldn’t update your password right now. Please try again in a few minutes.'
};

export const NO_ACCOUNT_MESSAGE =
  'We couldn’t find an account with that email and password. Check your details, or create an account if you don’t have one yet.';

export function friendlyAuthError(raw: unknown, context: AuthErrorContext): string {
  const text = (typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '').toLowerCase();

  if (/failed to fetch|networkerror|network request failed|load failed/.test(text)) {
    return 'We couldn’t reach the server. Check your internet connection and try again.';
  }
  if (/invalid login credentials|invalid email or password|invalid_credentials|invalid grant/.test(text)) {
    return NO_ACCOUNT_MESSAGE;
  }
  if (/email not confirmed|email_not_confirmed/.test(text)) {
    return 'Your email isn’t confirmed yet. Open the confirmation link we emailed you (check your spam folder), then sign in.';
  }
  if (/\bbanned\b|user is banned/.test(text)) {
    return 'This account is not available. If you think this is a mistake, please contact support.';
  }
  if (/already registered|already been registered|user_already_exists|already exists/.test(text)) {
    return 'An account with this email already exists. Sign in instead, or reset your password.';
  }
  if (/rate limit|too many requests|over_request_rate_limit|only request this after|security purposes/.test(text)) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (/signups? (not allowed|are disabled|disabled)|signup_disabled/.test(text)) {
    return 'New registrations are temporarily closed. Please try again later.';
  }
  if (/different from the old password|same_password/.test(text)) {
    return 'Choose a password you haven’t used before.';
  }
  if (/password should be|weak password|weak_password|password is too/.test(text)) {
    return 'That password is too short or too easy to guess. Choose a longer one that mixes letters and numbers.';
  }
  if (/invalid email|unable to validate email|email_address_invalid|validation_failed/.test(text)) {
    return 'Please enter a valid email address.';
  }
  // Database/internal errors and anything unrecognised: never show the raw text.
  return FALLBACK[context];
}
