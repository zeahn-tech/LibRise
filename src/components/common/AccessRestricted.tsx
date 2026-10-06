import React from 'react';
import { Lock } from 'lucide-react';

interface AccessRestrictedProps {
  reason?: string;
  hint?: string;
  /** Guests get a sign-in button. */
  isGuest: boolean;
  onSignIn: () => void;
  onGoHome: () => void;
}

/**
 * Shown when someone opens a workspace URL (e.g. /recruiter, /admin, /billing)
 * their account is not meant to use. The navigation never links here, so this
 * is only reachable by typing the address or following a stale bookmark.
 */
export const AccessRestricted: React.FC<AccessRestrictedProps> = ({ reason, hint, isGuest, onSignIn, onGoHome }) => (
  <div className="max-w-md mx-auto text-center bg-white border border-[#E8E4D9] rounded-3xl p-8 mt-10" role="alert" id="access-restricted">
    <div className="w-12 h-12 mx-auto rounded-2xl bg-[#FEFAE0] text-[#BC6C25] flex items-center justify-center mb-4">
      <Lock className="w-6 h-6" />
    </div>
    <h2 className="text-lg font-bold text-[#132A13]">{reason || "You don't have access to this page."}</h2>
    {hint && <p className="text-sm text-[#606C38] mt-2">{hint}</p>}
    <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
      {isGuest && (
        <button onClick={onSignIn} className="px-5 min-h-11 rounded-xl bg-[#283618] text-white text-sm font-semibold cursor-pointer">
          Sign in
        </button>
      )}
      <button onClick={onGoHome} className="px-5 min-h-11 rounded-xl border border-[#E8E4D9] text-[#283618] text-sm font-semibold cursor-pointer">
        Back to opportunities
      </button>
    </div>
  </div>
);
