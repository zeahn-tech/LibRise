import { describe, it, expect } from 'vitest';
import { friendlyAuthError, NO_ACCOUNT_MESSAGE } from '../lib/authErrors';

describe('friendlyAuthError', () => {
  it('says plainly that no account matches when the credentials are wrong', () => {
    expect(friendlyAuthError('Invalid login credentials', 'signin')).toBe(NO_ACCOUNT_MESSAGE);
    expect(NO_ACCOUNT_MESSAGE).toMatch(/couldn’t find an account with that email and password/);
    expect(NO_ACCOUNT_MESSAGE).toMatch(/create an account/);
  });

  it('never lets raw database or internal text reach the screen', () => {
    const rawErrors = [
      'Database error querying schema',
      'Database error finding user',
      'Database error saving new user',
      'Database error deleting user',
      'unexpected_failure',
      'Internal Server Error',
      'pq: relation "auth.users" does not exist',
      'sql: Scan error on column index 3',
      ''
    ];
    for (const raw of rawErrors) {
      for (const ctx of ['signin', 'signup', 'reset', 'password'] as const) {
        const msg = friendlyAuthError(raw, ctx);
        expect(msg).not.toMatch(/database|schema|scan|pq:|sql|relation|unexpected_failure|internal server/i);
        expect(msg.length).toBeGreaterThan(20);
      }
    }
    expect(friendlyAuthError('Database error querying schema', 'signin')).toMatch(/couldn’t sign you in right now/);
    expect(friendlyAuthError('Database error finding user', 'signup')).toMatch(/couldn’t create your account right now/);
  });

  it('explains the common, expected situations in plain language', () => {
    expect(friendlyAuthError('User already registered', 'signup')).toMatch(/already exists.*Sign in/);
    expect(friendlyAuthError('Email not confirmed', 'signin')).toMatch(/isn’t confirmed/);
    expect(friendlyAuthError('User is banned', 'signin')).toMatch(/not available/);
    expect(friendlyAuthError('Email rate limit exceeded', 'signup')).toMatch(/Too many attempts/);
    expect(friendlyAuthError('For security purposes, you can only request this after 45 seconds.', 'reset')).toMatch(/Too many attempts/);
    expect(friendlyAuthError('Password should be at least 6 characters.', 'signup')).toMatch(/too short or too easy/);
    expect(friendlyAuthError('New password should be different from the old password.', 'password')).toMatch(/haven’t used before/);
    expect(friendlyAuthError('Signups not allowed for this instance', 'signup')).toMatch(/temporarily closed/);
    expect(friendlyAuthError('Unable to validate email address: invalid format', 'signup')).toMatch(/valid email/);
    expect(friendlyAuthError('TypeError: Failed to fetch', 'signin')).toMatch(/couldn’t reach the server/);
  });

  it('accepts Error objects and unknown values', () => {
    expect(friendlyAuthError(new Error('Invalid login credentials'), 'signin')).toBe(NO_ACCOUNT_MESSAGE);
    expect(friendlyAuthError(undefined, 'signup')).toMatch(/couldn’t create your account/);
    expect(friendlyAuthError(42 as unknown, 'signin')).toMatch(/couldn’t sign you in/);
  });
});
