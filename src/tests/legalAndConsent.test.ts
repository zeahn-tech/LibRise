import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  FONTS_STYLESHEET_ID,
  PREFERENCE_KEYS,
  STORAGE_REGISTRY,
  __resetConsentForTests,
  applyConsentEffects,
  consentAllows,
  getConsentSnapshot,
  necessaryOnlyConsent,
  acceptAllConsent,
  parseConsent,
  purgeDeclined,
  saveConsent,
  type ConsentState
} from '../lib/consent';
import { LEGAL_DOCUMENTS, getLegalDocument, type LegalBlock } from '../legal/documents';
import { LEGAL_NAV } from '../legal/legalConfig';
import { renderInline } from '../components/legal/LegalPage';

const state = (over: Partial<ConsentState> = {}): ConsentState => ({
  version: CONSENT_VERSION, preferences: true, thirdParty: true, decidedAt: '2026-10-25T00:00:00Z', ...over
});

describe('consent', () => {
  beforeEach(() => __resetConsentForTests());

  it('treats missing, corrupt or old-version records as "not decided yet"', () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('not json')).toBeNull();
    expect(parseConsent(JSON.stringify({ ...state(), version: CONSENT_VERSION - 1 }))).toBeNull();
    expect(parseConsent(JSON.stringify({ ...state(), preferences: 'yes' }))).toBeNull();
    expect(parseConsent(JSON.stringify(state()))).toEqual(state());
  });

  it('necessary storage never needs consent; everything else needs an explicit yes', () => {
    expect(consentAllows('necessary', null)).toBe(true);
    expect(consentAllows('preferences', null)).toBe(false);
    expect(consentAllows('thirdParty', null)).toBe(false);
    expect(consentAllows('preferences', state({ preferences: false }))).toBe(false);
    expect(consentAllows('thirdParty', state())).toBe(true);
  });

  it('declining preferences deletes what was stored for them (and nothing else)', () => {
    const store: Record<string, string> = { opphub_currency: 'LRD', opphub_low_bandwidth: 'true', opphub_auth_session: 'keep' };
    const fake = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] };
    purgeDeclined(state({ preferences: false }), fake);
    for (const k of PREFERENCE_KEYS) expect(store[k]).toBeUndefined();
    expect(store.opphub_auth_session).toBe('keep');

    store.opphub_currency = 'USD';
    purgeDeclined(state({ preferences: true }), fake);
    expect(store.opphub_currency).toBe('USD');
  });

  it('saving a choice updates the shared snapshot', () => {
    acceptAllConsent();
    expect(getConsentSnapshot().consent).toMatchObject({ preferences: true, thirdParty: true });
    necessaryOnlyConsent();
    expect(getConsentSnapshot().consent).toMatchObject({ preferences: false, thirdParty: false });
    saveConsent({ preferences: true, thirdParty: false });
    expect(getConsentSnapshot().consent).toMatchObject({ preferences: true, thirdParty: false });
  });

  it('only loads the Google Fonts stylesheet when third-party content is accepted, and removes it when withdrawn', () => {
    const nodes = new Map<string, any>();
    const doc: any = {
      getElementById: (id: string) => nodes.get(id) ?? null,
      createElement: () => ({ remove() { nodes.delete(FONTS_STYLESHEET_ID); } }),
      head: { appendChild: (el: any) => nodes.set(el.id, el) }
    };
    applyConsentEffects(null, doc);
    expect(nodes.size).toBe(0);
    applyConsentEffects(state({ thirdParty: true }), doc);
    expect(nodes.size).toBe(1);
    expect(nodes.get(FONTS_STYLESHEET_ID).href).toContain('fonts.googleapis.com');
    applyConsentEffects(state({ thirdParty: true }), doc); // idempotent
    expect(nodes.size).toBe(1);
    applyConsentEffects(state({ thirdParty: false }), doc);
    expect(nodes.size).toBe(0);
  });
});

describe('legal documents', () => {
  const docs = Object.values(LEGAL_DOCUMENTS);
  const text = (b: LegalBlock): string =>
    b.t === 'ul' ? b.items.join(' ') : b.t === 'table' ? [...b.head, ...b.rows.flat()].join(' ') : b.text;
  const fullText = (slug: string) =>
    getLegalDocument(slug)!.sections.flatMap((s) => s.blocks.map(text)).join('\n');

  it('provides every document in the navigation, each with unique section ids and real content', () => {
    expect(docs.map((d) => d.slug).sort()).toEqual(LEGAL_NAV.map((n) => n.slug).sort());
    for (const d of docs) {
      const ids = d.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of d.sections) expect(s.blocks.length).toBeGreaterThan(0);
      for (const s of d.sections) for (const b of s.blocks) if (b.t === 'table') for (const r of b.rows) expect(r.length).toBe(b.head.length);
    }
  });

  it('every internal link points at a document that exists', () => {
    const all = docs.map((d) => fullText(d.slug)).join('\n');
    const targets = [...all.matchAll(/\(#\/legal\/([a-z]+)\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(getLegalDocument(t)).not.toBeNull();
  });

  it('describe what the app really does: providers, AI, payments, refunds', () => {
    const privacy = fullText('privacy');
    for (const word of ['Supabase', 'Gemini', 'MTN', 'Orange', 'Google Fonts', 'verification']) expect(privacy).toContain(word);
    expect(privacy).toMatch(/do not sell/i);
    const terms = fullText('terms');
    expect(terms).toMatch(/not an employer/i);
    expect(terms).toMatch(/pay any fee to apply|Charging job seekers/i);
    expect(terms).toContain('Refund Policy');
    const refunds = fullText('refunds');
    expect(refunds).toMatch(/MTN Mobile Money or Orange Money/);
    expect(refunds).toContain('OHL-XXXX-XXXX');
    expect(refunds).toMatch(/not refunded/i);
    expect(refunds).toContain('48 hours');
    const cookies = fullText('cookies');
    expect(cookies).toMatch(/does not use advertising/i);
  });

  it('the Cookie Policy lists every item in the storage registry', () => {
    const cookies = fullText('cookies');
    for (const item of STORAGE_REGISTRY) expect(cookies).toContain(item.name);
    expect(STORAGE_REGISTRY.some((i) => i.name === CONSENT_STORAGE_KEY)).toBe(true);
  });

  it('inline formatting renders bold and links', () => {
    const nodes = renderInline('See **this** and [Terms](#/legal/terms).') as any[];
    expect(nodes.some((n) => n?.type === 'strong')).toBe(true);
    const link = nodes.find((n) => n?.type === 'a');
    expect(link.props.href).toBe('#/legal/terms');
  });
});

describe('storage stays in sync with the Cookie Policy', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });

  it('no code writes a raw localStorage key outside the consent-managed constants', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (file.includes('/tests/') || file.endsWith('.test.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:localStorage|sessionStorage)\.setItem\(\s*['"`]([^'"`]+)['"`]/g)) offenders.push(`${file}: ${m[1]}`);
      if (/document\.cookie\s*=/.test(src)) offenders.push(`${file}: document.cookie`);
    }
    expect(offenders).toEqual([]);
  });

  it('index.html does not load third-party fonts before consent', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});

describe('operator details', () => {
  it('names the operator and a real support address in every document', async () => {
    const { LEGAL } = await import('../legal/legalConfig');
    expect(LEGAL.operatorName).toBe('Zeahn Inc.');
    expect(LEGAL.supportEmail).toBe('info.tracenetlib@gmail.com');
    for (const d of Object.values(LEGAL_DOCUMENTS)) {
      const text = d.sections.flatMap((s) => s.blocks.map((b) => (b.t === 'ul' ? b.items.join(' ') : b.t === 'table' ? b.rows.flat().join(' ') : b.text))).join('\n');
      expect(text).toContain('info.tracenetlib@gmail.com');
      expect(text).not.toContain('opportunityhub');
    }
  });
});
