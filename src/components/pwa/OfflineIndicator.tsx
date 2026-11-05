import React, { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useOnlineStatus } from '../../pwa/useOnlineStatus';
import { OFFLINE_MESSAGE } from '../../lib/offlineMessage';

/**
 * Shown at the bottom of the screen (above the navigation bar) while the device has no connection.
 * Styled like the app's error notices. It can be dismissed, and comes back the next time the connection drops.
 */
export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  // A fresh outage should always be shown, even if the previous one was dismissed.
  useEffect(() => {
    if (isOnline) setDismissed(false);
  }, [isOnline]);

  if (isOnline || dismissed) return null;

  return (
    <div
      id="pwa-offline-indicator"
      role="alert"
      className="fixed z-50 inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-6 sm:w-full sm:max-w-sm xl:bottom-6 rounded-2xl p-4 shadow-xl border flex items-start gap-3 text-xs sm:text-sm bg-[#FCF0E8] text-[#8C2F1B] border-[#F2C0A2]"
    >
      <div className="shrink-0 mt-0.5">
        <AlertCircle className="w-4 h-4 text-[#BC6C25]" />
      </div>
      <div className="flex-1 font-medium">{OFFLINE_MESSAGE}</div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 -m-2.5 w-11 h-11 flex items-center justify-center rounded-xl opacity-70 hover:opacity-100 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
