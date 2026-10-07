import { SubscriptionPlan } from '../types';

/**
 * UI metadata for the plans: names, copy, feature lists and entitlements.
 *
 * What a plan COSTS is authoritative in the database (payment_plans, see
 * supabase/migrations/20261008100000_pricing_revision.sql); checkout and the
 * pricing page read it from there. monthlyPrice/annualPrice below are only a
 * display fallback for when that table can't be reached, and a test fails if
 * they drift from the migration. Job/listing/featured LIMITS are enforced in
 * the database by tier_limits() in the same migration -- keep these in sync
 * (a test checks that too).
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan_free',
    tier: 'free',
    name: 'Free',
    description: 'For businesses getting started. Free, with no time limit.',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      'Business / organization profile',
      'Post 1 active job',
      'List 1 business for sale',
      'Basic applicant tracking',
      'View basic candidate profiles',
      'Standard support'
    ],
    entitlements: {
      maxActiveJobs: 1,
      maxActiveListings: 1,
      maxCandidatesViewable: 10,
      canViewCandidateContact: false,
      canUseAI: false,
      prioritySupport: false,
      advancedAnalytics: false,
      jobPromotion: false,
      maxFeaturedVacancies: 0,
      priorityVisibility: false
    }
  },
  {
    id: 'plan_basic',
    tier: 'basic',
    name: 'Starter',
    description: 'Everything a growing business needs to recruit and get discovered.',
    monthlyPrice: 10,
    annualPrice: 100,
    features: [
      'Everything in Free',
      'Up to 10 active jobs',
      'Up to 3 businesses for sale',
      'Job promotion / boost',
      '1 featured vacancy at a time',
      'Full applicant management',
      'Candidate contact info',
      'Improved visibility',
      'Standard support'
    ],
    entitlements: {
      maxActiveJobs: 10,
      maxActiveListings: 3,
      maxCandidatesViewable: 'unlimited',
      canViewCandidateContact: true,
      canUseAI: false,
      prioritySupport: false,
      advancedAnalytics: false,
      jobPromotion: true,
      maxFeaturedVacancies: 1,
      priorityVisibility: false
    },
    stripePriceIdMonthly: process.env.VITE_STRIPE_BASIC_MONTHLY_PRICE_ID || 'price_basic_monthly',
    stripePriceIdAnnual: process.env.VITE_STRIPE_BASIC_ANNUAL_PRICE_ID || 'price_basic_annual'
  },
  {
    id: 'plan_pro',
    tier: 'pro',
    name: 'Pro',
    description: 'More recruiting capacity, greater visibility, and better tools for established businesses.',
    monthlyPrice: 25,
    annualPrice: 250,
    features: [
      'Everything in Starter',
      'Up to 50 active jobs',
      'Up to 10 businesses for sale',
      'Up to 5 featured vacancies at a time',
      'Priority visibility',
      'Advanced analytics',
      'Advanced applicant tools',
      'AI candidate matching',
      'Priority support'
    ],
    entitlements: {
      maxActiveJobs: 50,
      maxActiveListings: 10,
      maxCandidatesViewable: 'unlimited',
      canViewCandidateContact: true,
      canUseAI: true,
      prioritySupport: true,
      advancedAnalytics: true,
      jobPromotion: true,
      maxFeaturedVacancies: 5,
      priorityVisibility: true
    },
    stripePriceIdMonthly: process.env.VITE_STRIPE_PRO_MONTHLY_PRICE_ID || 'price_pro_monthly',
    stripePriceIdAnnual: process.env.VITE_STRIPE_PRO_ANNUAL_PRICE_ID || 'price_pro_annual'
  }
];

export const getPlanById = (id: string): SubscriptionPlan | undefined => {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
};

/**
 * Resolve the UI plan (entitlements, features, name) for a stored subscription.
 *
 * Subscriptions are written under TWO id schemes: the UI plan ids ('plan_pro')
 * and, since manual mobile money payments, the payment plan ids
 * ('plan-sub-pro-annual'). Looking a plan up by id alone therefore returned
 * nothing for every PAID subscriber, so they were shown Free limits and
 * errors instead of their benefits. The `tier` column is authoritative and
 * scheme-independent, so it is used as the fallback.
 */
export const getPlanForSubscription = (
  sub: { planId?: string | null; tier?: string | null } | null | undefined
): SubscriptionPlan => {
  const free = SUBSCRIPTION_PLANS[0];
  if (!sub) return free;
  const byTier = SUBSCRIPTION_PLANS.find((p) => p.tier === sub.tier);
  if (byTier) return byTier;
  return (sub.planId && SUBSCRIPTION_PLANS.find((p) => p.id === sub.planId)) || free;
};

export const getPlanByStripePriceId = (priceIdOrPlanId: string): SubscriptionPlan | undefined => {
  if (!priceIdOrPlanId) return SUBSCRIPTION_PLANS[0];
  
  // Match by exact ID, tier, or price ID
  const match = SUBSCRIPTION_PLANS.find(
    (p) =>
      p.id === priceIdOrPlanId ||
      p.tier === priceIdOrPlanId ||
      p.stripePriceIdMonthly === priceIdOrPlanId ||
      p.stripePriceIdAnnual === priceIdOrPlanId
  );
  
  if (match) return match;

  // Partial match fallback for mock strings
  return SUBSCRIPTION_PLANS.find(
    (p) => priceIdOrPlanId.includes(p.id) || priceIdOrPlanId.includes(p.tier)
  ) || SUBSCRIPTION_PLANS[0];
};
