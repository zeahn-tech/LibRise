import React, { Suspense, lazy, useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, Zap, Building2 } from 'lucide-react';
import { SubscriptionPlan, OrganizationSubscription, PaymentPlan } from '../types';
import { SUBSCRIPTION_PLANS, getPlanForSubscription } from '../data/subscriptionPlans';
import { APP_METADATA } from '../config/constants';
import { subscriptionService } from '../services/subscriptionService';
import { paymentService, formatMinorAmount } from '../services/paymentService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { evaluatePermission, canPostOpportunities } from '../core/auth/permissionEngine';
import { OrganizationWizardModal } from './organization/OrganizationWizardModal';

const PaymentCheckoutFlow = lazy(() => import('./payments/PaymentCheckoutFlow').then((m) => ({ default: m.PaymentCheckoutFlow })));

interface SubscriptionManagerProps {
  /** Present when the viewer can post jobs: starts a new job with that pay-as-you-go option selected. */
  onPostJob?: (planId: string) => void;
  /** Present when the viewer can post jobs: opens the new-job form (the free Basic post). */
  onPostFree?: () => void;
}

export const SubscriptionManager: React.FC<SubscriptionManagerProps> = ({ onPostJob, onPostFree }) => {
  const { showToast } = useToast();
  const [subscription, setSubscription] = useState<OrganizationSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);

  const [isOrgWizardOpen, setIsOrgWizardOpen] = useState(false);
  // Authoritative prices (payment_plans). Falls back to the plan metadata's
  // display prices only if this can't be loaded; the checkout always uses the
  // database amount regardless.
  const [subPlans, setSubPlans] = useState<PaymentPlan[]>([]);
  const [vacancyPlans, setVacancyPlans] = useState<PaymentPlan[]>([]);

  const { activeOrganization, authContext } = useAuth();
  const orgId = activeOrganization?.id;

  // Sellers and recruiters share the same plans; only the copy differs.
  const isSeller = evaluatePermission(authContext, 'business.list');
  const isRecruiter = canPostOpportunities(authContext);
  const audience: 'seller' | 'recruiter' | 'both' =
    isSeller && isRecruiter ? 'both' : isSeller ? 'seller' : 'recruiter';
  const heading =
    audience === 'seller' ? 'Seller Subscription & Billing'
      : audience === 'both' ? 'Recruiter & Seller Subscription & Billing'
      : 'Recruiter Subscription & Billing';
  const blurb =
    audience === 'seller'
      ? 'Manage your seller plan, feature entitlements, and billing history. Upgrade to list more businesses for sale and reach more buyers.'
      : audience === 'both'
        ? 'Manage your plan, feature entitlements, and billing history. Find employees faster, reach more customers, and make your business more visible.'
        : 'Manage your plan, feature entitlements, and billing history. Find employees faster and make your business more visible.';

  useEffect(() => {
    let cancelled = false;
    void Promise.all([paymentService.getPlans('subscription'), paymentService.getPlans('vacancy')]).then(([subs, vacs]) => {
      if (cancelled) return;
      if (subs.data) setSubPlans(subs.data);
      if (vacs.data) setVacancyPlans(vacs.data);
    });
    return () => { cancelled = true; };
  }, []);

  /** Price in whole currency units for a tier+cycle: database first, display fallback second. */
  const priceFor = (plan: SubscriptionPlan, cycle: 'monthly' | 'annual'): number => {
    const row = subPlans.find((p) => p.subscriptionTier === plan.tier && p.billingCycle === cycle);
    if (row) return row.amountMinor / 100;
    return cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
  };
  const annualSavings = (plan: SubscriptionPlan): number =>
    Math.max(0, Math.round((priceFor(plan, 'monthly') * 12 - priceFor(plan, 'annual')) * 100) / 100);

  useEffect(() => {
    if (orgId) {
      loadSubscription(orgId);
    } else {
      setSubscription(null);
      setLoading(false);
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

  if (!orgId) {
    // Subscriptions belong to an organization. A seller (or recruiter) who has
    // not created theirs yet is walked through it instead of seeing a blank page.
    return (
      <div className="max-w-xl mx-auto bg-white p-8 rounded-[32px] border border-[#E8E4D9] text-center" data-testid="billing-needs-org">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#FEFAE0] text-[#BC6C25] flex items-center justify-center mb-4">
          <Building2 className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold font-display text-[#283618] tracking-tight">{heading}</h2>
        <p className="text-sm text-stone-500 mt-2">
          Plans are attached to your organization profile. Create yours (it takes a minute) to see plans and upgrade.
        </p>
        <button
          onClick={() => setIsOrgWizardOpen(true)}
          className="mt-6 px-5 min-h-11 rounded-xl bg-[#283618] text-white text-sm font-semibold cursor-pointer"
        >
          Create organization profile
        </button>
        <OrganizationWizardModal isOpen={isOrgWizardOpen} onClose={() => setIsOrgWizardOpen(false)} />
      </div>
    );
  }

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
              {heading}
            </h2>
            <p className="text-stone-500 text-sm max-w-2xl">
              {blurb}
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
                Save up to ${Math.max(0, ...SUBSCRIPTION_PLANS.map(annualSavings))}
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
            const price = priceFor(plan, billingCycle);
            const savings = plan.tier === 'free' ? 0 : annualSavings(plan);

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

                <div className="mb-8">
                  <div className="flex items-end gap-1">
                    <span className={`text-4xl font-black ${plan.tier === 'pro' ? 'text-white' : 'text-[#283618]'}`}>
                      ${price}
                    </span>
                    <span className={`text-sm pb-1 font-medium ${plan.tier === 'pro' ? 'text-stone-400' : 'text-stone-400'}`}>
                      {plan.tier === 'free' ? 'forever' : billingCycle === 'annual' ? '/ year' : '/ month'}
                    </span>
                  </div>
                  {billingCycle === 'annual' && savings > 0 && (
                    <p className={`text-xs font-semibold mt-1 ${plan.tier === 'pro' ? 'text-[#A3B18A]' : 'text-[#4F772D]'}`} data-testid={`savings-${plan.tier}`}>
                      Save ${savings} annually
                    </p>
                  )}
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

      {/* Plan comparison (generated from the same entitlements the app enforces) */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border border-[#E8E4D9] overflow-x-auto" data-testid="plan-matrix">
        <h3 className="text-xl font-bold font-display text-[#283618] tracking-tight mb-4">Compare plans</h3>
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-stone-400">
              <th className="py-2 pr-4 font-bold">Feature</th>
              {SUBSCRIPTION_PLANS.map((pl) => <th key={pl.id} className="py-2 px-2 font-bold">{pl.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E4D9] text-[#283618]">
            {([
              ['Business profile', () => '✓'],
              ['Active jobs', (e: SubscriptionPlan['entitlements']) => String(e.maxActiveJobs)],
              ['Businesses for sale', (e: SubscriptionPlan['entitlements']) => String(e.maxActiveListings)],
              ['Applicant management', () => '✓'],
              ['Job promotion', (e: SubscriptionPlan['entitlements']) => (e.jobPromotion ? '✓' : 'Optional ($3–$10)')],
              ['Featured vacancies at once', (e: SubscriptionPlan['entitlements']) => (e.maxFeaturedVacancies > 0 ? String(e.maxFeaturedVacancies) : 'Optional ($5)')],
              ['Priority visibility', (e: SubscriptionPlan['entitlements']) => (e.priorityVisibility ? '✓' : '—')],
              ['Advanced analytics', (e: SubscriptionPlan['entitlements']) => (e.advancedAnalytics ? '✓' : '—')],
              ['AI candidate matching', (e: SubscriptionPlan['entitlements']) => (e.canUseAI ? '✓' : '—')],
              ['Support', (e: SubscriptionPlan['entitlements']) => (e.prioritySupport ? 'Priority' : 'Standard')]
            ] as Array<[string, (e: SubscriptionPlan['entitlements']) => string]>).map(([label, cell]) => (
              <tr key={label}>
                <td className="py-2.5 pr-4 font-medium">{label}</td>
                {SUBSCRIPTION_PLANS.map((pl) => <td key={pl.id} className="py-2.5 px-2">{cell(pl.entitlements)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Free post + optional promotions */}
      {vacancyPlans.length > 0 && audience !== 'seller' && (
        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-[#E8E4D9]" data-testid="pay-as-you-go">
          <h3 className="text-xl font-bold font-display text-[#283618] tracking-tight">Post free. Promote only if you want to.</h3>
          <p className="text-sm text-stone-500 mt-1 max-w-2xl">
            If you only need one basic vacancy, LibRise is free. Promotions are optional and only add visibility. Recruit often?
            Upgrade to Starter or Pro above.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <div className="border-2 border-[#4F772D] rounded-2xl p-4 bg-[#F4F8EF]" data-testid="payg-basic-free">
              <div className="font-bold text-[#283618]">Basic — Free</div>
              <div className="text-2xl font-black text-[#283618] mt-1">$0</div>
              <ul className="mt-3 space-y-1">
                {['1 active vacancy', 'Standard visibility', 'Normal application management'].map((f) => (
                  <li key={f} className="text-xs text-stone-600 flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0 text-[#4F772D]" />{f}</li>
                ))}
              </ul>
              {onPostFree ? (
                <button onClick={onPostFree} data-testid="payg-post-free" className="mt-4 w-full min-h-11 rounded-xl bg-[#4F772D] text-white text-sm font-semibold cursor-pointer">
                  Post Free
                </button>
              ) : (
                <p className="mt-4 text-[11px] text-stone-400">Available when you post a job.</p>
              )}
            </div>

            {vacancyPlans.map((vp) => (
              <div key={vp.id} className="border border-[#E8E4D9] rounded-2xl p-4 bg-[#F9F8F6]">
                <div className="font-bold text-[#283618]">{vp.name}</div>
                <div className="text-2xl font-black text-[#283618] mt-1">{formatMinorAmount(vp.amountMinor, vp.currency)}</div>
                <p className="text-xs text-stone-500 mt-1">{vp.description}</p>
                <ul className="mt-3 space-y-1">
                  {vp.features.map((f) => (
                    <li key={f} className="text-xs text-stone-600 flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0 text-[#4F772D]" />{f}</li>
                  ))}
                </ul>
                {onPostJob ? (
                  <button
                    onClick={() => onPostJob(vp.id)}
                    data-testid={`payg-post-${vp.promotionLevel ?? vp.id}`}
                    className="mt-4 w-full min-h-11 rounded-xl bg-[#283618] text-white text-sm font-semibold cursor-pointer"
                  >
                    {vp.promotionLevel === 'boost' ? 'Boost' : vp.promotionLevel === 'featured' ? 'Feature' : 'Go Premium'} — {formatMinorAmount(vp.amountMinor, vp.currency)}
                  </button>
                ) : (
                  <p className="mt-4 text-[11px] text-stone-400">Choose this when you post a job.</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-stone-500">
            Promotions are paid with MTN Mobile Money or Orange Money. After you send the payment and enter the transaction ID,
            we verify it and the promotion switches on. A promotion ends on its own; your vacancy stays live as a normal listing.
          </p>
        </div>
      )}
    </div>
  );
};
