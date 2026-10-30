import React, { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { usePlatformSettings } from '../../lib/platformSettingsStore';

/** Site-wide notice an administrator can switch on in Content Management. Hidden when there is nothing to say. */
export const AnnouncementBanner: React.FC = () => {
  const { announcement } = usePlatformSettings();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!announcement || !announcement.enabled || !announcement.message || dismissed === announcement.message) return null;

  return (
    <div role="status" className="bg-[#FEFAE0] border-b border-[#E8D9A8] text-[#283618]">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-start gap-3">
        <Megaphone className="w-4 h-4 text-[#BC6C25] shrink-0 mt-0.5" />
        <p className="flex-1 min-w-0 text-xs font-semibold leading-relaxed break-words">{announcement.message}</p>
        <button type="button" onClick={() => setDismissed(announcement.message)} aria-label="Dismiss announcement" className="min-w-11 min-h-11 -my-2.5 -mr-3 flex items-center justify-center rounded-xl text-[#606C38] hover:bg-black/5 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
