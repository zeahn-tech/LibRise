import React, { Suspense, lazy, useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, Zap, Calendar, AlertCircle } from 'lucide-react';
import { SubscriptionPlan, OrganizationSubscription } from '../types';
import { SUBSCRIPTION_PLANS, getPlanForSubscription } from '../data/subscriptionPlans';
import { APP_METADATA } from '../config/constants';
import { subscriptionService } from '../services/subscriptionService';
import { authService } from '../services/authService';
import { useToast } from '../context/ToastContext';

const PaymentCheckoutFlow = lazy(() => import('./payments/PaymentCheckoutFlow').then((m) => ({ default: m.PaymentCheckoutFlow })));

export const SubscriptionManager: React.FC = () => {
  const { showToast } = useToast();
  const [subscription, setSubscription] = useState<OrganizationSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);

  const session = authService.getSession();
  const orgId = session.activeOrganization?.id;

  useEffect(() => {
    if (orgId) {
      loadSubscription(orgId);
    }
  }, [orgId]);

  const loadSubscription = async (id: string) => {
    setLoading(true);
    const res = await subscriptionService.getOrganizationSubscription(id);
    if (res.data) {
      setSubscription(res.data);
      setBillingCycle(res.data.billingCycle);
    }
    setLoading(false);
  };

  /**
   * Opens the real manual mobile-money checkout flow instead of faking an
   * instant upgrade. subscriptionService.mockFulfillSubscription() (still
   * present, see that file) wrote directly to organization_subscriptions
   * with no payment involved at all -- exactly the gap a user reported:
   * clicking "Upgrade" switched plans with nowhere to actually send
   * money. organization_subscriptions is no longer writable by org
   * admins at all (see supabase/migrations/
   * *_route_subscriptions_through_manual_payments.sql); the ONLY way a
   * subscription becomes active now is a platform admin approving a real
   * payment, same as publishing a paid vacancy. See docs/PAYMENTS.md.
   */
  const handleSubscribe = (plan: SubscriptionPlan) => {
    if (!orgId) return;
    if (plan.tier === 'free') {
      // Free has no payment_plans row (nothing to pay for) and there is
      // no self-service downgrade/cancellation flow yet -- see
      // docs/PAYMENTS.md. Say so plainly rather than opening a paid
      // checkout for a free plan, which initiate() would reject anyway
      // (no matching plan) after a confusing silent fallback.
      showToast('Downgrading to the free plan isn\'t self-service yet -- contact support.', 'info');
      return;
    }
    setCheckoutPlanId(`plan-sub-${plan.tier}-${billingCycle}`);
  };

  if (loading) {
    return <div className="p-8 text-center text-stone-500">Loading subscription status...</div>;
  }

  const currentPlan = getPlanForSubscription(subscription);
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const isPaidTier = !!subscription && subscription.tier !== 'free';
  const isLapsed = isPaidTier && !!periodEnd && periodEnd.getTime() < Date.now();
  const daysLeft = periodEnd ? Math.ceil((periodEnd.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {checkoutPlanId && orgId && (
        <Suspense fallback={null}>
          <PaymentCheckoutFlow
            organizationId={orgId}
            planType="subscription"
            preferredPlanId={checkoutPlanId}
            title="Upgrade your subscription"
            onClose={() => setCheckoutPlanId(null)}
            onPublished={() => { void loadSubscription(orgId); }}
          />
        </Suspense>
      )}
      {/* Current Status Header */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border border-[#E8E4D9]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold font-display text-[#283618] tracking-tight">
              Recruiter Subscription & Billing
            </h2>
            <p className="text-stone-500 text-sm max-w-2xl">
              Manage your employer plans, feature entitlements, and billing history. Upgrade to unlock AI-powered matching and unlimited active vacancies.
            </p>
          </div>

          <div className="bg-[#F9F8F6] p-4 rounded-2xl border border-[#E8E4D9] min-w-[280px]">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Current Plan</span>
              {(subscription?.status === 'active' || subscription?.status === 'trialing') && !isLapsed ? (
                <span className="px-2.5 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  {subscription.status}
                </span>
              ) : (
                <span className="px-2.5 py-0.5 bg-red-100 text-red-800 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  {isLapsed ? 'Expired' : (subscription?.status || 'Inactive')}
                </span>
              )}
            </div>
            <div className="text-xl font-bold text-[#283618] mb-4">{currentPlan.name}</div>
            
            {isPaidTier && periodEnd && (
              <p className={`text-xs mb-3 ${isLapsed ? 'text-red-700 font-semibold' : 'text-stone-500'}`}>
                {isLapsed
                  ? `Expired on ${periodEnd.toLocaleDateString()}. You are back on free-plan limits until you renew.`
                  : `Active until ${periodEnd.toLocaleDateString()}${daysLeft !== null && daysLeft <= 7 ? ` (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)` : ''}.`}
              </p>
            )}
            {isPaidTier && (
              <button
                onClick={() => setCheckoutPlanId(`plan-sub-${subscription!.tier}-${subscription!.billingCycle === 'annual' ? 'annual' : 'monthly'}`)}
                className="w-full px-4 py-2 bg-white border border-[#E8E4D9] rounded-xl text-sm font-semibold text-[#283618] hover:bg-[#F9F8F6] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                {isLapsed ? 'Renew plan' : 'Extend plan'}
              </button>
            )}
            {isPaidTier && !isLapsed && (
              <div className="mt-3 text-xs text-stone-600 bg-[#F9F8F6] border border-[#E8E4D9] rounded-xl px-3 py-2.5" data-testid="support-level">
                {currentPlan.entitlements.prioritySupport ? (
                  <>
                    <span className="font-bold text-[#283618]">Priority support included.</span>{' '}
                    <a
                      href={`mailto:${APP_METADATA.supportEmail}?subject=${encodeURIComponent('[PRIORITY] LibRise support request')}`}
                      className="underline text-[#4F772D] font-semibold"
                    >
                      Email {APP_METADATA.supportEmail}
                    </a>
                    . Requests marked priority are handled first.
                  </>
                ) : (
                  <>
                    <span className="font-bold text-[#283618]">Standard email support included.</span>{' '}
                    <a href={`mailto:${APP_METADATA.supportEmail}`} className="underline text-[#4F772D] font-semibold">
                      Email {APP_METADATA.supportEmail}
                    </a>
                    .
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pricing Plans */}
      <div className="space-y-6">
        <div className="flex justify-center mb-8">
          <div className="bg-[#F9F8F6] p-1 rounded-2xl border border-[#E8E4D9] inline-flex">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer ${
                billingCycle === 'monthly' ? 'bg-white shadow-sm text-[#283618]' : 'text-stone-500 hover:text-[#283618]'
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center gap-2 ${
                billingCycle === 'annual' ? 'bg-white shadow-sm text-[#283618]' : 'text-stone-500 hover:text-[#283618]'
              }`}
            >
              Annual Billing
              <span className="px-2 py-0.5 bg-[#FEFAE0] text-[#BC6C25] rounded-full text-[10px] uppercase tracking-wider border border-[#E8E4D9]">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {SUBSCRIPTION_PLANS.map((plan) => {
            // Compare by tier (planId may be a UI id or a payment-plan id) and
            // treat a lapsed paid plan as Free.
            const TIER_RANK: Record<string, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 };
            const effectiveTier = isLapsed ? 'free' : currentPlan.tier;
            const isCurrent = effectiveTier === plan.tier;
            const isLowerThanCurrent = (TIER_RANK[plan.tier] ?? 0) < (TIER_RANK[effectiveTier] ?? 0);
            const price = billingCycle === 'annual' ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;

            return (
              <div 
                key={plan.id}
                className={`p-6 md:p-8 rounded-[32px] border relative flex flex-col ${
                  plan.tier === 'pro' 
                    ? 'bg-[#283618] border-[#4F772D] text-white shadow-xl scale-100 md:scale-105 z-10'
                    : 'bg-white border-[#E8E4D9] text-[#283618]'
                }`}
              >
                {plan.tier === 'pro' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#BC6C25] text-white rounded-full text-xs font-bold tracking-wider uppercase flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Recommended
                  </div>
                )}
                
                <div className="mb-8">
                  <h3 className={`text-xl font-bold font-display tracking-tight mb-2 ${plan.tier === 'pro' ? 'text-white' : ''}`}>
                    {plan.name}
                  </h3>
                  <p className={`text-sm h-10 ${plan.tier === 'pro' ? 'text-stone-300' : 'text-stone-500'}`}>
                    {plan.description}
                  </p>
                </div>

                <div className="mb-8 flex items-end gap-1">
                  <span className={`text-4xl font-black ${plan.tier === 'pro' ? 'text-white' : 'text-[#283618]'}`}>
                    ${price}
                  </span>
                  <span className={`text-sm pb-1 font-medium ${plan.tier === 'pro' ? 'text-stone-400' : 'text-stone-400'}`}>
                    /mo
                  </span>
                </div>

                <ul className="space-y-4 mb-8 flex-1">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <CheckCircle2 className={`w-5 h-5 shrink-0 ${plan.tier === 'pro' ? 'text-[#A3B18A]' : 'text-[#4F772D]'}`} />
                      <span className={`text-sm font-medium ${plan.tier === 'pro' ? 'text-stone-200' : 'text-stone-600'}`}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                {plan.tier === 'free' || isLowerThanCurrent ? (
                  <div className="w-full py-3.5 rounded-2xl text-sm font-bold text-center bg-[#F9F8F6] text-stone-400 border border-[#E8E4D9]">
                    {isCurrent ? 'Current Plan' : 'Included in your plan'}
                  </div>
                ) : (
                  <button
                    disabled={isCurrent}
                    onClick={() => handleSubscribe(plan)}
                    className={`w-full py-3.5 rounded-2xl text-sm font-bold transition-all cursor-pointer ${
                      isCurrent
                        ? plan.tier === 'pro' ? 'bg-[#4F772D] text-white opacity-80 cursor-default' : 'bg-[#F9F8F6] text-stone-400 border border-[#E8E4D9] cursor-default'
                        : plan.tier === 'pro'
                          ? 'bg-white text-[#283618] hover:bg-stone-100 shadow-md'
                          : 'bg-[#283618] text-white hover:bg-[#3A4D23]'
                    }`}
                  >
                    {isCurrent ? 'Current Plan' : `Upgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
