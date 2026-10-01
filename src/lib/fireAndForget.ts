/**
 * Run a side effect (e.g. sending a notification) without blocking or failing
 * the main action. Rejections are logged instead of becoming unhandled
 * promise rejections. Safe to pass undefined (mocked services in tests).
 */
export const fireAndForget = (work: unknown, label = 'background task'): void => {
  Promise.resolve(work).catch((err) => {
    console.warn(`[${label}] failed (non-critical):`, err instanceof Error ? err.message : err);
  });
};
