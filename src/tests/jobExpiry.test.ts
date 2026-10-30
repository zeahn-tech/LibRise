import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_JOB_DAYS, addDaysIso, deadlineError, defaultDeadline, describeLimit, maxDeadline, todayIso } from '../lib/jobExpiry';
import { parsePlatformSettings } from '../services/platformSettingsService';

const NOW = new Date('2026-10-30T15:30:00Z');

describe('max job expiry helpers', () => {
  it('computes dates from the UTC day', () => {
    expect(todayIso(NOW)).toBe('2026-10-30');
    expect(addDaysIso(30, NOW)).toBe('2026-11-29');
    expect(maxDeadline(90, NOW)).toBe('2027-01-28');
    expect(DEFAULT_MAX_JOB_DAYS).toBe(90);
  });

  it('starts new vacancies 30 days out, or at the limit if that is shorter (never a fixed past date)', () => {
    expect(defaultDeadline(90, NOW)).toBe('2026-11-29');
    expect(defaultDeadline(14, NOW)).toBe('2026-11-13');
    expect(defaultDeadline(7, new Date('2031-02-01T00:00:00Z'))).toBe('2031-02-08');
  });

  it('accepts today through the limit and explains anything else', () => {
    expect(deadlineError('2026-10-30', 90, NOW)).toBeNull();
    expect(deadlineError('2027-01-28', 90, NOW)).toBeNull(); // the last allowed day
    expect(deadlineError('2027-01-29', 90, NOW)).toMatch(/at most 90 days.*28 Jan 2027/);
    expect(deadlineError('2026-10-29', 90, NOW)).toMatch(/past/);
    expect(deadlineError('', 90, NOW)).toMatch(/Choose/);
    expect(deadlineError('2099-01-01', 90, NOW)).toMatch(/at most 90 days/);
    expect(deadlineError('not-a-date', 90, NOW)).toMatch(/valid/);
    expect(deadlineError('2026-02-30', 90, NOW)).toMatch(/valid|past/);
  });

  it('describes the limit for the form', () => {
    expect(describeLimit(30, NOW)).toBe('Applications can stay open for up to 30 days (until 29 Nov 2026).');
  });

  it('parses the admin setting, accepting only whole numbers from 7 to 365', () => {
    expect(parsePlatformSettings([{ key: 'max_job_days', value: 60 }]).maxJobDays).toBe(60);
    for (const bad of [6, 366, 60.5, '60', null]) expect(parsePlatformSettings([{ key: 'max_job_days', value: bad }]).maxJobDays).toBeNull();
  });
});
