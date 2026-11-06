import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';

let online = true;
vi.mock('../pwa/useOnlineStatus', () => ({ useOnlineStatus: () => online }));

describe('offline banner', () => {
  beforeEach(() => {
    vi.resetModules();
    online = true;
  });

  it('shows nothing while online', async () => {
    const { OfflineIndicator } = await import('../components/pwa/OfflineIndicator');
    expect(renderToString(createElement(OfflineIndicator))).toBe('');
  });

  it('while offline shows exactly the agreed message, styled like the error notices, with a way to dismiss it', async () => {
    online = false;
    const { OfflineIndicator } = await import('../components/pwa/OfflineIndicator');
    const html = renderToString(createElement(OfflineIndicator));
    expect(html).toContain('You’re currently offline. Reconnect and try again.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('bg-[#FCF0E8]');
    expect(html).toContain('border-[#F2C0A2]');
    expect(html).toContain('aria-label="Dismiss"');
  });

  it('every offline message in the app uses the same wording, and none promises a retry or sync that does not exist', async () => {
    const { OFFLINE_MESSAGE } = await import('../lib/offlineMessage');
    expect(OFFLINE_MESSAGE).toBe('You’re currently offline. Reconnect and try again.');
    const { NetworkOfflineError } = await import('../core/errors/AppError');
    expect(new NetworkOfflineError().message).toBe(OFFLINE_MESSAGE);
    for (const file of ['src/components/pwa/OfflineIndicator.tsx', 'src/core/errors/AppError.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/will be retried|will sync once|Offline Mode Active/);
    }
  });

  it('is mounted once, in the app shell', () => {
    expect(readFileSync('src/App.tsx', 'utf8').match(/<OfflineIndicator \/>/g)).toHaveLength(1);
  });
});
