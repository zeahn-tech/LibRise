import { logger } from '../core/logging/logger';
import { envConfig } from '../config/env';

export function registerServiceWorker(): void {
  if (!envConfig.pwaEnabled) {
    logger.debug('PWA', 'PWA service worker registration disabled by configuration.');
    return;
  }

  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    // A new service worker has taken control (autoUpdate): reload once so the
    // page runs the new code instead of a stale cached copy (e.g. old prices).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          logger.info('PWA', 'Service worker successfully registered with scope: ' + registration.scope);

          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    logger.info('PWA', 'New content is available; please refresh.');
                  } else {
                    logger.info('PWA', 'Content is cached for offline use.');
                  }
                }
              };
            }
          };
        })
        .catch((error) => {
          logger.warn('PWA', 'Service worker registration encountered notice:', { error: String(error) });
        });
    });
  }
}
