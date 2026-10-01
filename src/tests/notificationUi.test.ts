import { describe, it, expect, vi } from 'vitest';
import { formatNotificationTime } from '../components/notifications/NotificationCenterModal';
import { fireAndForget } from '../lib/fireAndForget';

describe('formatNotificationTime', () => {
  const now = new Date('2026-10-01T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('shows friendly relative times', () => {
    expect(formatNotificationTime(ago(10_000), now)).toBe('Just now');
    expect(formatNotificationTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(formatNotificationTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(formatNotificationTime(ago(2 * 86_400_000), now)).toBe('2d ago');
  });

  it('falls back to a dated label for older items and tolerates bad input', () => {
    expect(formatNotificationTime(ago(30 * 86_400_000), now)).toMatch(/2026/);
    expect(formatNotificationTime('not-a-date', now)).toBe('');
  });
});

describe('fireAndForget', () => {
  it('swallows rejections (no unhandled promise rejection) and tolerates undefined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => fireAndForget(Promise.reject(new Error('boom')), 'test')).not.toThrow();
    expect(() => fireAndForget(undefined)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
