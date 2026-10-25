/**
 * scrollLock.ts
 *
 * Stops the page behind a modal from scrolling. Uses the "fixed body" technique (body becomes position:fixed at the
 * current offset, then the offset is restored on unlock) because `overflow:hidden` alone does not stop background
 * scrolling on several mobile browsers. Locks are reference counted so stacked dialogs (a viewer opened from a
 * dialog) never unlock the page early.
 */

export interface ScrollLockEnv {
  win: Pick<Window, 'scrollTo' | 'innerWidth' | 'innerHeight'> & { scrollY: number };
  doc: {
    body: { style: Record<string, string> };
    documentElement: { clientWidth: number };
  };
}

const STYLE_KEYS = ['position', 'top', 'left', 'right', 'width', 'overflow', 'paddingRight'] as const;

let lockCount = 0;
let savedStyles: Record<string, string> = {};
let savedScrollY = 0;

const defaultEnv = (): ScrollLockEnv => ({ win: window, doc: document as unknown as ScrollLockEnv['doc'] });

export function lockPageScroll(env: ScrollLockEnv = defaultEnv()): void {
  lockCount += 1;
  if (lockCount > 1) return;

  const { win, doc } = env;
  const style = doc.body.style;
  savedScrollY = win.scrollY;
  savedStyles = {};
  for (const key of STYLE_KEYS) savedStyles[key] = style[key] ?? '';

  // Keep the layout from shifting when the desktop scrollbar disappears.
  const scrollbarWidth = Math.max(0, win.innerWidth - doc.documentElement.clientWidth);

  style.position = 'fixed';
  style.top = `-${savedScrollY}px`;
  style.left = '0';
  style.right = '0';
  style.width = '100%';
  style.overflow = 'hidden';
  if (scrollbarWidth > 0) style.paddingRight = `${scrollbarWidth}px`;
}

export function unlockPageScroll(env: ScrollLockEnv = defaultEnv()): void {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;

  const { win, doc } = env;
  const style = doc.body.style;
  for (const key of STYLE_KEYS) style[key] = savedStyles[key] ?? '';
  win.scrollTo(0, savedScrollY);
}

/** Test helper. */
export function __resetScrollLockForTests(): void {
  lockCount = 0;
  savedStyles = {};
  savedScrollY = 0;
}

export function isPageScrollLocked(): boolean {
  return lockCount > 0;
}

/**
 * True for an element that currently behaves like a modal: a visible, pointer-capturing, fixed overlay covering
 * (nearly) the whole viewport. Toast containers (pointer-events:none), hidden/closed sheets and small fixed bars
 * (bottom nav, offline badge) are not modals.
 */
export function isModalOverlay(
  el: Element,
  win: Pick<Window, 'getComputedStyle' | 'innerWidth' | 'innerHeight'> = window
): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const cs = win.getComputedStyle(el);
  if (cs.position !== 'fixed' || cs.pointerEvents === 'none') return false;
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width >= win.innerWidth * 0.9 && rect.height >= win.innerHeight * 0.9;
}

export function hasOpenModalOverlay(root: ParentNode = document, win: Window = window): boolean {
  const candidates = root.querySelectorAll('.fixed.inset-0, [role="dialog"][aria-modal="true"]');
  for (const el of Array.from(candidates)) {
    if (isModalOverlay(el, win)) return true;
  }
  return false;
}
