import React from 'react';
import { useAuth } from '../context/AuthContext';
import { getFeatureAccess } from '../core/auth/featureAccess';
import { LEGAL_NAV, legalPath } from '../legal/legalConfig';
import { openCookieSettings } from '../lib/consent';

interface FooterProps {
  onOpenSafetyModal: () => void;
  onOpenVerification: () => void;
}

// GitHub-style footer: off-white surface, centered muted links that wrap
// into rows, then the brand mark + copyright on the last line.
const linkClass =
  'inline-flex items-center min-h-8 px-2 text-xs text-[#606C38] hover:text-[#283618] hover:underline underline-offset-2 transition-colors cursor-pointer bg-transparent border-0';

export const Footer: React.FC<FooterProps> = ({ onOpenSafetyModal, onOpenVerification }) => {
  const { authContext } = useAuth();
  const canSeeVerification = getFeatureAccess(authContext).tabs.verification.allowed;

  return (
    <footer className="bg-[#F2F2EC] border-t border-[#E8E4D9] w-full shrink-0 mt-auto px-4 py-3 flex flex-col items-center gap-0 text-center">
      <nav
        aria-label="Footer"
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0 max-w-xl"
      >
        <button type="button" onClick={onOpenSafetyModal} className={linkClass}>
          Safety
        </button>
        {canSeeVerification && (
          <button type="button" onClick={onOpenVerification} className={linkClass}>
            Verification
          </button>
        )}
        {LEGAL_NAV.map((n) => (
          <a key={n.slug} href={`#${legalPath(n.slug)}`} className={linkClass}>
            {n.short}
          </a>
        ))}
        <button type="button" onClick={openCookieSettings} className={linkClass}>
          Manage cookies
        </button>
      </nav>

      <div className="flex items-center justify-center gap-2 text-xs text-[#606C38]">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#283618]"
        >
          <span className="h-2 w-2 rounded-full border-[1.5px] border-[#F2F2EC]" />
        </span>
        <span>
          © 2026 Lib<span className="text-[#4F772D]">Rise</span>, Liberia · All 15 counties
        </span>
      </div>
    </footer>
  );
};
