/**
 * jobExpiry.ts — the maximum job expiry rule, shared by the post-vacancy form and the admin settings.
 *
 * The database enforces the same rule (20261030100000_max_job_expiry.sql); these helpers only let the form show the
 * limit up front and explain it, instead of the employer discovering it as a rejected save.
 */

export const DEFAULT_MAX_JOB_DAYS = 90; // matches platform_max_job_days() when no setting exists
export const MIN_MAX_JOB_DAYS = 7;
export const MAX_MAX_JOB_DAYS = 365;
export const DEFAULT_DEADLINE_DAYS = 30; // what a new vacancy's deadline starts at (capped by the limit)

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar date as YYYY-MM-DD (the platform runs on Liberia time, which is UTC). */
export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export const addDaysIso = (days: number, now: Date = new Date()): string => new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10);

/** The latest deadline an employer may choose. */
export const maxDeadline = (maxDays: number, now: Date = new Date()): string => addDaysIso(maxDays, now);

/** A sensible starting deadline: 30 days out, or the limit if that is shorter. */
export const defaultDeadline = (maxDays: number, now: Date = new Date()): string => addDaysIso(Math.min(DEFAULT_DEADLINE_DAYS, maxDays), now);

const isValidIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const pretty = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Why this deadline cannot be used, or null when it is fine. */
export function deadlineError(deadline: string, maxDays: number, now: Date = new Date()): string | null {
  if (!deadline) return 'Choose an application deadline.';
  if (!isValidIsoDate(deadline)) return 'Enter a valid deadline date.';
  if (deadline < todayIso(now)) return 'The deadline cannot be in the past.';
  const latest = maxDeadline(maxDays, now);
  if (deadline > latest) return `Applications can stay open for at most ${maxDays} days. Choose a date on or before ${pretty(latest)}.`;
  return null;
}

export const describeLimit = (maxDays: number, now: Date = new Date()): string =>
  `Applications can stay open for up to ${maxDays} days (until ${pretty(maxDeadline(maxDays, now))}).`;
