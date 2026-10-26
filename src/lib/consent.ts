/**
 * consent.ts
 *
 * Cookie / local-storage consent for LibRise.
 *
 * What the app stores on a device is split into three groups:
 *   - necessary:   needed to sign in and run the app. Always on, no consent needed (disclosed in the Cookie Policy).
 *   - preferences: remembers display choices (currency, data-saver mode). Only with consent.
 *   - thirdParty:  fonts loaded from Google. Only with consent (the font stylesheet is not requested until then).
 * LibRise has no advertising or third-party analytics, so there is deliberately no such category.
 *
 * STORAGE_REGISTRY is the single source of truth: the Cookie Policy table is generated from it, and the code that
 * writes these keys imports the constants below, so the policy cannot silently drift from what the app does.
 */

import { useSyncExternalStore } from 'react';

export const CONSENT_STORAGE_KEY = 'librise_cookie_consent';
/** Bump when categories change so everyone is asked again. */
export const CONSENT_VERSION = 1;

export const PREF_CURRENCY_KEY = 'opphub_currency';
export const PREF_LOW_BANDWIDTH_KEY = 'opphub_low_bandwidth';
export const PREFERENCE_KEYS = [PREF_CURRENCY_KEY, PREF_LOW_BANDWIDTH_KEY] as const;

export const FONTS_STYLESHEET_ID = 'librise-google-fonts';
export const FONTS_STYLESHEET_HREF =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';

export type ConsentCategory = 'necessary' | 'preferences' | 'thirdParty';

export interface ConsentState {
  version: number;
  preferences: boolean;
  thirdParty: boolean;
  decidedAt: string;
}

export interface StorageItem {
  name: string;
  where: string;
  category: ConsentCategory;
  purpose: string;
  duration: string;
  party: 'LibRise' | 'Our authentication provider (Supabase)' | 'Google';
}

export const STORAGE_REGISTRY: StorageItem[] = [
  {
    name: 'sb-…-auth-token',
    where: 'Local storage',
    category: 'necessary',
    purpose: 'Keeps you signed in and refreshes your secure session. Set by our authentication provider’s library.',
    duration: 'Until you sign out or the session expires',
    party: 'Our authentication provider (Supabase)'
  },
  {
    name: 'opphub_auth_session',
    where: 'Local storage',
    category: 'necessary',
    purpose: 'A cached copy of your signed-in profile (name, email, role, organisation) so the app loads quickly.',
    duration: 'Until you sign out',
    party: 'LibRise'
  },
  {
    name: CONSENT_STORAGE_KEY,
    where: 'Local storage',
    category: 'necessary',
    purpose: 'Remembers your cookie choices so we do not ask on every visit.',
    duration: 'Until you clear your browser data (we ask again if our categories change)',
    party: 'LibRise'
  },
  {
    name: 'App files (Workbox precache) and service worker',
    where: 'Cache storage',
    category: 'necessary',
    purpose: 'Lets the app install on your phone, open quickly and keep working with a weak or no connection.',
    duration: 'Until the app is updated or you clear site data',
    party: 'LibRise'
  },
  {
    name: 'api-cache',
    where: 'Cache storage',
    category: 'necessary',
    purpose: 'Keeps recent responses from our own server (for example AI features) so they can be shown if your connection drops.',
    duration: 'Up to 24 hours (at most 100 responses)',
    party: 'LibRise'
  },
  {
    name: PREF_CURRENCY_KEY,
    where: 'Local storage',
    category: 'preferences',
    purpose: 'Remembers whether you view amounts in USD or LRD.',
    duration: 'Until you clear it or withdraw consent',
    party: 'LibRise'
  },
  {
    name: PREF_LOW_BANDWIDTH_KEY,
    where: 'Local storage',
    category: 'preferences',
    purpose: 'Remembers if you turned on data-saver (low-bandwidth) mode.',
    duration: 'Until you clear it or withdraw consent',
    party: 'LibRise'
  },
  {
    name: 'Google Fonts (fonts.googleapis.com, fonts.gstatic.com) and google-fonts-cache / gstatic-fonts-cache',
    where: 'Network requests and Cache storage',
    category: 'thirdParty',
    purpose: 'Loads the Newsreader and Plus Jakarta Sans typefaces. Google receives your IP address and browser details when fonts are requested.',
    duration: 'Fonts are cached for up to 1 year',
    party: 'Google'
  }
];

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Parses a stored consent record; anything invalid or from an older version means "not decided yet". */
export function parseConsent(raw: string | null): ConsentState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      v &&
      typeof v === 'object' &&
      v.version === CONSENT_VERSION &&
      typeof v.preferences === 'boolean' &&
      typeof v.thirdParty === 'boolean' &&
      typeof v.decidedAt === 'string'
    ) {
      return v as ConsentState;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function readConsent(storage: StorageLike | null = safeStorage()): ConsentState | null {
  try {
    return parseConsent(storage?.getItem(CONSENT_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Is storing in this category allowed right now? Necessary is always true; the rest need an explicit yes. */
export function consentAllows(category: ConsentCategory, state: ConsentState | null = readConsent()): boolean {
  if (category === 'necessary') return true;
  return !!state && state[category];
}

/** Removes everything we stored under a category the person has now declined. */
export function purgeDeclined(state: ConsentState, storage: StorageLike | null = safeStorage()): void {
  if (!storage) return;
  if (!state.preferences) for (const key of PREFERENCE_KEYS) storage.removeItem(key);
}

// ---- tiny external store (so React and non-React code share one source of truth) -------------------------------

interface Snapshot {
  consent: ConsentState | null;
  settingsOpen: boolean;
}

let snapshot: Snapshot = { consent: readConsent(), settingsOpen: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getConsentSnapshot = (): Snapshot => snapshot;

export function saveConsent(choice: { preferences: boolean; thirdParty: boolean }): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    preferences: choice.preferences,
    thirdParty: choice.thirdParty,
    decidedAt: new Date().toISOString()
  };
  const storage = safeStorage();
  try {
    storage?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full/blocked: the choice still applies for this visit */
  }
  purgeDeclined(state, storage);
  snapshot = { consent: state, settingsOpen: false };
  applyConsentEffects(state);
  emit();
  return state;
}

export const acceptAllConsent = () => saveConsent({ preferences: true, thirdParty: true });
export const necessaryOnlyConsent = () => saveConsent({ preferences: false, thirdParty: false });

export function openCookieSettings(): void {
  snapshot = { ...snapshot, settingsOpen: true };
  emit();
}
export function closeCookieSettings(): void {
  snapshot = { ...snapshot, settingsOpen: false };
  emit();
}

export function useConsent(): Snapshot {
  return useSyncExternalStore(subscribeConsent, getConsentSnapshot, getConsentSnapshot);
}

/** Test helper. */
export function __resetConsentForTests(consent: ConsentState | null = null): void {
  snapshot = { consent, settingsOpen: false };
  listeners.clear();
}

// ---- effects that depend on consent ------------------------------------------------------------------------------

/** Loads (or removes) the Google Fonts stylesheet according to the third-party choice. */
export function applyConsentEffects(state: ConsentState | null, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  const existing = doc.getElementById(FONTS_STYLESHEET_ID);
  if (consentAllows('thirdParty', state)) {
    if (existing) return;
    const link = doc.createElement('link');
    link.id = FONTS_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = FONTS_STYLESHEET_HREF;
    doc.head.appendChild(link);
  } else if (existing) {
    existing.remove();
  }
}

/** Call once at startup. */
export function initConsent(): void {
  applyConsentEffects(snapshot.consent);
}
