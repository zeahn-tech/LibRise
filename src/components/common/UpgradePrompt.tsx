import React from 'react';
import { Lock } from 'lucide-react';

interface UpgradePromptProps {
  title: string;
  description: string;
  planName: string;
  /** Only organization owners/admins can open billing; others are told to ask them. */
  onUpgrade?: () => void;
}

/** Plan-gated feature the current subscription does not include. */
export const UpgradePrompt: React.FC<UpgradePromptProps> = ({ title, description, planName, onUpgrade }) => (
  <div className="bg-white border border-[#E8E4D9] rounded-3xl p-8 text-center max-w-xl mx-auto" data-testid="upgrade-prompt">
    <div className="w-12 h-12 mx-auto rounded-2xl bg-[#FEFAE0] text-[#BC6C25] flex items-center justify-center mb-4">
      <Lock className="w-6 h-6" />
    </div>
    <h3 className="text-base font-bold text-[#132A13]">{title}</h3>
    <p className="text-sm text-[#606C38] mt-2">{description}</p>
    <p className="text-xs font-bold text-[#BC6C25] mt-3 uppercase tracking-wider">Included in {planName}</p>
    {onUpgrade ? (
      <button onClick={onUpgrade} className="mt-5 px-5 min-h-11 rounded-xl bg-[#283618] text-white text-sm font-semibold cursor-pointer">
        View plans
      </button>
    ) : (
      <p className="text-xs text-[#606C38] mt-4">Ask your organization owner to upgrade the plan.</p>
    )}
  </div>
);
