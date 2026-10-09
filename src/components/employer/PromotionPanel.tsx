import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { FeatureEntitlement, Opportunity } from '../../types';
import { opportunityService } from '../../services/opportunityService';
import { useToast } from '../../context/ToastContext';

interface Props {
  opportunities: Opportunity[];
  entitlements: FeatureEntitlement;
  /** Called after a vacancy's featured status changed, so the list can refresh. */
  onChanged: () => void;
  /** Present only when the viewer may open billing. */
  onOpenBilling?: () => void;
}

/**
 * Lets Starter / Pro subscribers use the featured slots included in their plan
 * (Starter 1, Pro 5). The database is what actually enforces the limit
 * (guard_opportunity_promotion), so this panel can only ever ask; it cannot
 * grant. Free organizations are pointed at Starter or at pay-as-you-go.
 */
export const PromotionPanel: React.FC<Props> = ({ opportunities, entitlements, onChanged, onOpenBilling }) => {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const live = opportunities.filter((o) => o.status === 'published');
  const slots = entitlements.maxFeaturedVacancies;
  const used = live.filter((o) => o.isFeatured).length;

  if (!entitlements.jobPromotion) {
    return (
      <div className="bg-[#FEFAE0] border border-[#E8E4D9] rounded-2xl p-4 text-xs text-[#283618] flex flex-wrap items-center justify-between gap-3" data-testid="promotion-teaser">
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#BC6C25]" />
          Want more people to see a job? Promote it: Boost ($3), Featured ($5) or Premium ($10). Or get a featured slot included with Starter.
        </span>
        {onOpenBilling && (
          <button onClick={onOpenBilling} className="px-3 py-1.5 rounded-xl bg-[#283618] text-white font-semibold cursor-pointer">See plans</button>
        )}
      </div>
    );
  }

  if (live.length === 0) return null;

  const toggle = async (opp: Opportunity) => {
    setBusyId(opp.id);
    const res = await opportunityService.update(opp.id, { isFeatured: !opp.isFeatured });
    setBusyId(null);
    if (res.error) {
      showToast(res.error.message, 'error');
      return;
    }
    showToast(opp.isFeatured ? 'Vacancy is no longer featured.' : 'Vacancy is now featured.', 'success');
    onChanged();
  };

  return (
    <div className="bg-white border border-[#E8E4D9] rounded-2xl p-4 space-y-3" data-testid="promotion-panel">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold text-[#283618]">
          <Sparkles className="w-4 h-4 text-[#BC6C25]" /> Promote your vacancies
        </span>
        <span className="text-xs text-stone-500">{used} of {slots} featured slot{slots === 1 ? '' : 's'} used</span>
      </div>
      <ul className="divide-y divide-[#E8E4D9]">
        {live.map((opp) => {
          const full = !opp.isFeatured && used >= slots;
          return (
            <li key={opp.id} className="py-2 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-[#283618] font-medium">
                {opp.title}
                {opp.promotionLevel && (
                  <span className="ml-2 text-[10px] font-bold uppercase text-[#BC6C25]" data-testid="promo-status">
                    {opp.promotionLevel === 'boost' ? 'Boosted' : opp.promotionLevel === 'featured' ? 'Featured' : 'Premium'}
                    {opp.promotionUntil ? ` until ${new Date(opp.promotionUntil).toLocaleDateString()}` : ''}
                    {` · ${opp.viewsCount ?? 0} views · ${opp.applicationsCount ?? 0} applications`}
                  </span>
                )}
              </span>
              <button
                disabled={busyId === opp.id || full || opp.promotionLevel === 'premium'}
                onClick={() => void toggle(opp)}
                title={opp.promotionLevel === 'premium' ? 'Premium vacancies stay featured for the period you paid for.' : full ? 'All featured slots in your plan are in use.' : undefined}
                className="shrink-0 px-3 py-1.5 rounded-xl border border-[#E8E4D9] font-semibold text-[#283618] bg-[#F9F8F6] disabled:opacity-50 cursor-pointer"
              >
                {opp.isFeatured ? 'Remove featured' : 'Feature this job'}
              </button>
            </li>
          );
        })}
      </ul>
      {used >= slots && onOpenBilling && entitlements.maxFeaturedVacancies < 5 && (
        <button onClick={onOpenBilling} className="text-xs font-semibold underline text-[#4F772D] cursor-pointer">Need more featured slots? See Pro</button>
      )}
    </div>
  );
};
