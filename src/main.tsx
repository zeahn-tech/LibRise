import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerServiceWorker } from './pwa/registerServiceWorker.ts';
import { CookieConsent } from './components/legal/CookieConsent';
import { initConsent } from './lib/consent';
import { refreshPlatformSettings } from './lib/platformSettingsStore';

// Initialize PWA Service Worker
registerServiceWorker();

// Apply any stored cookie choices (e.g. load Google Fonts only if the person agreed) before first paint of the app.
initConsent();

// Admin-controlled site settings (announcement, USD->LRD rate, extra industries). Falls back to built-in defaults.
void refreshPlatformSettings();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <CookieConsent />
  </StrictMode>,
);

