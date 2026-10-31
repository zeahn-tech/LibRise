/**
 * platformSettingsStore.ts
 *
 * One shared copy of the admin-controlled site settings (announcement, USD->LRD rate, extra industries), loaded once
 * at start-up and refreshed after an administrator saves. Non-React code (the currency helpers) and React components
 * (banner, forms, admin panels) all read from here.
 */
import { useSyncExternalStore } from 'react';
import { BUSINESS_INDUSTRIES } from '../config/constants';
import { EMPTY_PLATFORM_SETTINGS, platformSettingsService, type PlatformSettings } from '../services/platformSettingsService';
import { setUsdToLrdRate } from './currency';
import { DEFAULT_MAX_JOB_DAYS } from './jobExpiry';

let snapshot: PlatformSettings = EMPTY_PLATFORM_SETTINGS;
const listeners = new Set<() => void>();

function apply(next: PlatformSettings) {
  snapshot = next;
  if (next.usdToLrd) setUsdToLrdRate(next.usdToLrd);
  listeners.forEach((l) => l());
}

/** `strict` makes a failure to read the settings throw (used right after an admin saves, to confirm it is readable). */
export async function refreshPlatformSettings(strict = false): Promise<PlatformSettings> {
  apply(await platformSettingsService.load({ strict }));
  return snapshot;
}

/** Test helper. */
export function __setPlatformSettingsForTests(next: PlatformSettings) {
  apply(next);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePlatformSettings(): PlatformSettings {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Built-in industries plus any an administrator added (case-insensitive de-duplication, built-ins first). */
export function mergeIndustries(extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...BUSINESS_INDUSTRIES, ...extra]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}

/** The effective maximum job expiry in days (the admin's setting, else the built-in default). */
export function useMaxJobDays(): number {
  return usePlatformSettings().maxJobDays ?? DEFAULT_MAX_JOB_DAYS;
}

export function useBusinessIndustries(): string[] {
  return mergeIndustries(usePlatformSettings().extraIndustries);
}
