import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// What the database returns for `select key,value from platform_settings`.
let response: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: () => ({ select: async () => response }),
    rpc: async () => ({ data: null, error: null })
  })
}));

async function load() {
  const store = await import('../lib/platformSettingsStore');
  const { AnnouncementBanner } = await import('../components/common/AnnouncementBanner');
  return { store, AnnouncementBanner };
}

describe('announcement: database row -> what a visitor sees', () => {
  beforeEach(() => {
    vi.resetModules();
    response = { data: [], error: null };
  });

  it('shows the saved message to a visitor once settings are loaded', async () => {
    response = { data: [{ key: 'announcement', value: { enabled: true, message: 'Maintenance on Sunday 02:00-03:00' } }], error: null };
    const { store, AnnouncementBanner } = await load();
    expect(renderToString(createElement(AnnouncementBanner))).toBe(''); // nothing before the settings arrive
    await store.refreshPlatformSettings();
    const html = renderToString(createElement(AnnouncementBanner));
    expect(html).toContain('Maintenance on Sunday 02:00-03:00');
    expect(html).toContain('role="status"');
    expect(html).toContain('Dismiss announcement');
  });

  it('shows nothing when the announcement is switched off, empty, or never set', async () => {
    const { store, AnnouncementBanner } = await load();
    for (const rows of [
      [{ key: 'announcement', value: { enabled: false, message: 'Hidden' } }],
      [{ key: 'announcement', value: { enabled: true, message: '' } }],
      []
    ]) {
      response = { data: rows, error: null };
      await store.refreshPlatformSettings();
      expect(renderToString(createElement(AnnouncementBanner))).toBe('');
    }
  });

  it('escapes the message (it is plain text, never HTML)', async () => {
    response = { data: [{ key: 'announcement', value: { enabled: true, message: '<img src=x onerror=alert(1)>' } }], error: null };
    const { store, AnnouncementBanner } = await load();
    await store.refreshPlatformSettings();
    const html = renderToString(createElement(AnnouncementBanner));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('a visitor whose read fails gets no banner (and no crash); an admin save that cannot be read back is reported', async () => {
    response = { data: null, error: { message: 'permission denied for table platform_settings' } };
    const { store, AnnouncementBanner } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(store.refreshPlatformSettings()).resolves.toBeTruthy();
    expect(renderToString(createElement(AnnouncementBanner))).toBe('');
    expect(warn).toHaveBeenCalled();
    await expect(store.refreshPlatformSettings(true)).rejects.toThrow(/permission denied/);
    warn.mockRestore();
  });

  it('the banner is mounted on the landing screen, the signed-in app and the legal pages', () => {
    for (const file of ['src/components/LandingScreen.tsx', 'src/App.tsx', 'src/components/legal/LegalPage.tsx']) {
      expect(readFileSync(file, 'utf8')).toContain('<AnnouncementBanner />');
    }
    expect(readFileSync('src/main.tsx', 'utf8')).toContain('refreshPlatformSettings()');
  });
});
