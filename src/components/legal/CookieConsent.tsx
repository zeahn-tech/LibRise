import React, { useEffect, useState } from 'react';
import { Cookie, X } from 'lucide-react';
import {
  acceptAllConsent,
  closeCookieSettings,
  necessaryOnlyConsent,
  saveConsent,
  useConsent
} from '../../lib/consent';

const Toggle: React.FC<{
  id: string;
  label: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (v: boolean) => void;
}> = ({ id, label, description, checked, locked, onChange }) => (
  <div className="flex items-start gap-3 p-4 rounded-2xl border border-[#E8E4D9] bg-white">
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block text-sm font-bold text-[#132A13]">
        {label}
        {locked && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#4F772D]">Always on</span>}
      </label>
      <p className="mt-1 text-xs leading-relaxed text-[#606C38]">{description}</p>
    </div>
    <label className="relative inline-flex items-center shrink-0 min-h-11 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only peer"
      />
      <span className="w-12 h-7 rounded-full bg-gray-300 peer-checked:bg-[#4F772D] peer-disabled:opacity-60 peer-focus-visible:ring-2 peer-focus-visible:ring-[#283618] transition-colors after:content-[''] after:absolute after:top-1/2 after:-translate-y-1/2 after:left-0.5 after:w-6 after:h-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  </div>
);

/** Choose-by-category panel. Opened from the banner's "Customize" and from "Cookie settings" in the footer. */
const SettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { consent } = useConsent();
  const [preferences, setPreferences] = useState(consent?.preferences ?? false);
  const [thirdParty, setThirdParty] = useState(consent?.thirdParty ?? false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cookie settings"
      className="fixed inset-0 z-[95] bg-[#132A13]/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-hidden overscroll-contain"
    >
      <div className="bg-[#F9F8F6] w-full max-w-lg rounded-t-[28px] sm:rounded-[32px] border border-[#E8E4D9] shadow-2xl flex flex-col max-h-[92dvh]">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[#E8E4D9] flex-none">
          <div>
            <h2 className="text-lg font-serif font-bold text-[#132A13]">Cookie settings</h2>
            <p className="mt-1 text-xs text-[#606C38]">Choose what LibRise may store on your device. You can change this any time.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-11 min-h-11 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-[#283618] hover:bg-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 space-y-3">
          <Toggle
            id="consent-necessary"
            label="Necessary"
            description="Keeps you signed in, secures your session and lets the app work offline. Needed for LibRise to function."
            checked
            locked
          />
          <Toggle
            id="consent-preferences"
            label="Preferences"
            description="Remembers your display choices: currency (USD or LRD) and data-saver mode."
            checked={preferences}
            onChange={setPreferences}
          />
          <Toggle
            id="consent-third-party"
            label="Third-party content"
            description="Loads fonts from Google. Google receives your IP address when this is on. If off, your device’s standard fonts are used."
            checked={thirdParty}
            onChange={setThirdParty}
          />
          <p className="text-xs text-[#606C38]">
            We do not use advertising or third-party analytics. See the <a className="underline font-semibold text-[#4F772D]" href="#/legal/cookies">Cookie Policy</a> for the full list.
          </p>
        </div>

        <div className="flex-none flex flex-col-reverse sm:flex-row gap-2 p-5 border-t border-[#E8E4D9] bg-white rounded-b-[32px] pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => acceptAllConsent()} className="min-h-11 px-4 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] cursor-pointer sm:flex-1">
            Accept all
          </button>
          <button
            type="button"
            onClick={() => saveConsent({ preferences, thirdParty })}
            className="min-h-11 px-4 rounded-xl bg-[#283618] text-white text-xs font-bold hover:bg-[#132A13] cursor-pointer sm:flex-1"
          >
            Save my choices
          </button>
        </div>
      </div>
    </div>
  );
};

/** First-visit banner plus the settings panel. Mounted once, outside the app shell, so it appears on every screen. */
export const CookieConsent: React.FC = () => {
  const { consent, settingsOpen } = useConsent();
  const [customizing, setCustomizing] = useState(false);
  const showBanner = consent === null && !customizing && !settingsOpen;
  const showPanel = customizing || settingsOpen;

  return (
    <>
      {showBanner && (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pointer-events-none"
        >
          <div className="pointer-events-auto max-w-3xl mx-auto bg-white border border-[#E8E4D9] rounded-3xl shadow-2xl p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-10 h-10 rounded-2xl bg-[#ECF3E9] flex items-center justify-center text-[#4F772D]">
                <Cookie className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#132A13]">Your privacy choices</h2>
                <p className="mt-1 text-xs leading-relaxed text-[#606C38]">
                  LibRise stores a small amount of information on your device to keep you signed in and the app working. With your OK we also remember your display preferences and load fonts from Google. We do not use ads or third-party analytics.{' '}
                  <a className="underline font-semibold text-[#4F772D]" href="#/legal/cookies">Cookie Policy</a> ·{' '}
                  <a className="underline font-semibold text-[#4F772D]" href="#/legal/privacy">Privacy Policy</a>
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => setCustomizing(true)} className="min-h-11 px-4 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] cursor-pointer">
                Customize
              </button>
              <button type="button" onClick={() => necessaryOnlyConsent()} className="min-h-11 px-4 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] cursor-pointer">
                Necessary only
              </button>
              <button type="button" onClick={() => acceptAllConsent()} className="min-h-11 px-5 rounded-xl bg-[#283618] text-white text-xs font-bold hover:bg-[#132A13] cursor-pointer">
                Accept all
              </button>
            </div>
          </div>
        </div>
      )}
      {showPanel && (
        <SettingsPanel
          onClose={() => {
            setCustomizing(false);
            closeCookieSettings();
          }}
        />
      )}
    </>
  );
};
