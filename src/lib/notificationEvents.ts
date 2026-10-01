/**
 * Tiny same-tab event bus so anything that creates or reads/dismisses a
 * notification can tell the bell + panel to refresh immediately, without
 * waiting for the next poll or realtime push.
 */
const EVENT = 'librise:notifications-changed';

export const emitNotificationsChanged = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
};

export const onNotificationsChanged = (cb: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};
