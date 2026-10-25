import { useEffect } from 'react';
import { hasOpenModalOverlay, lockPageScroll, unlockPageScroll } from '../../lib/scrollLock';

/**
 * Mounted once at the app root. Watches the DOM and keeps the page behind ANY full-screen overlay (dialogs, sheets,
 * drawers, lightboxes) from scrolling while it is open, so individual modals never need their own scroll handling.
 */
export const ModalScrollLock: React.FC = () => {
  useEffect(() => {
    let locked = false;
    let frame = 0;

    const evaluate = () => {
      const open = hasOpenModalOverlay();
      if (open && !locked) {
        lockPageScroll();
        locked = true;
      } else if (!open && locked) {
        unlockPageScroll();
        locked = false;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(evaluate);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    evaluate();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      if (locked) unlockPageScroll();
    };
  }, []);

  return null;
};
