import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetScrollLockForTests,
  hasOpenModalOverlay,
  isModalOverlay,
  isPageScrollLocked,
  lockPageScroll,
  unlockPageScroll,
  type ScrollLockEnv
} from '../lib/scrollLock';

function makeEnv(scrollY = 240, clientWidth = 1000): ScrollLockEnv & { scrollTo: ReturnType<typeof vi.fn> } {
  const scrollTo = vi.fn();
  return {
    win: { scrollY, scrollTo, innerWidth: 1015, innerHeight: 800 } as any,
    doc: { body: { style: { overflow: 'auto', position: '' } as Record<string, string> }, documentElement: { clientWidth } },
    scrollTo
  } as any;
}

describe('page scroll lock', () => {
  beforeEach(() => __resetScrollLockForTests());

  it('freezes the page at its current offset and restores everything (incl. scroll position) on unlock', () => {
    const env = makeEnv();
    lockPageScroll(env);
    const s = env.doc.body.style;
    expect(isPageScrollLocked()).toBe(true);
    expect(s.position).toBe('fixed');
    expect(s.top).toBe('-240px');
    expect(s.overflow).toBe('hidden');
    expect(s.paddingRight).toBe('15px'); // desktop scrollbar width is compensated

    unlockPageScroll(env);
    expect(isPageScrollLocked()).toBe(false);
    expect(s.position).toBe('');
    expect(s.overflow).toBe('auto');
    expect(env.scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it('is reference counted: stacked dialogs keep the page locked until the last one closes', () => {
    const env = makeEnv();
    lockPageScroll(env);
    lockPageScroll(env);
    unlockPageScroll(env);
    expect(isPageScrollLocked()).toBe(true);
    expect(env.doc.body.style.position).toBe('fixed');
    expect(env.scrollTo).not.toHaveBeenCalled();
    unlockPageScroll(env);
    expect(isPageScrollLocked()).toBe(false);
    expect(env.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('extra unlocks are harmless', () => {
    const env = makeEnv();
    unlockPageScroll(env);
    expect(isPageScrollLocked()).toBe(false);
    expect(env.scrollTo).not.toHaveBeenCalled();
  });
});

describe('modal overlay detection', () => {
  const win = (cs: Record<string, string>) =>
    ({ innerWidth: 400, innerHeight: 800, getComputedStyle: () => ({ position: 'fixed', pointerEvents: 'auto', display: 'flex', visibility: 'visible', opacity: '1', ...cs }) }) as any;
  const el = (w = 400, h = 800, attrs: Record<string, string> = {}) =>
    ({ getAttribute: (k: string) => attrs[k] ?? null, getBoundingClientRect: () => ({ width: w, height: h }) }) as any;

  it('treats a visible full-screen fixed overlay as a modal', () => {
    expect(isModalOverlay(el(), win({}))).toBe(true);
  });

  it('ignores toast layers, hidden/closed sheets, aria-hidden and small fixed bars', () => {
    expect(isModalOverlay(el(), win({ pointerEvents: 'none' }))).toBe(false);
    expect(isModalOverlay(el(), win({ display: 'none' }))).toBe(false);
    expect(isModalOverlay(el(), win({ visibility: 'hidden' }))).toBe(false);
    expect(isModalOverlay(el(), win({ opacity: '0' }))).toBe(false);
    expect(isModalOverlay(el(400, 800, { 'aria-hidden': 'true' }), win({}))).toBe(false);
    expect(isModalOverlay(el(400, 56), win({}))).toBe(false); // bottom nav / offline badge
    expect(isModalOverlay(el(), win({ position: 'absolute' }))).toBe(false);
  });

  it('hasOpenModalOverlay is true only when some candidate is a real modal', () => {
    const root = (els: any[]) => ({ querySelectorAll: () => els }) as any;
    expect(hasOpenModalOverlay(root([]), win({}))).toBe(false);
    expect(hasOpenModalOverlay(root([el(400, 56)]), win({}))).toBe(false);
    expect(hasOpenModalOverlay(root([el(400, 56), el()]), win({}))).toBe(true);
  });
});
