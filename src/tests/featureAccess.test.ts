import { describe, it, expect } from 'vitest';
import type { AuthorizationContext } from '../core/auth/permissionEngine';
import { canUseAiStudioTool, getFeatureAccess, type AppTab } from '../core/auth/featureAccess';
import { getPlanForSubscription } from '../data/subscriptionPlans';
import type { OrgRole, SystemRole, User, UserCapability, UserRole } from '../types';

function ctx(opts: {
  role?: UserRole;
  system?: SystemRole;
  caps?: UserCapability[];
  orgRole?: OrgRole;
  status?: User['accountStatus'];
  guest?: boolean;
}): AuthorizationContext {
  if (opts.guest) {
    return { user: null, activeOrganization: null, membership: null, capabilities: [], platformRole: 'user', userMemberships: [] };
  }
  const user = {
    id: 'u1',
    primaryRole: opts.role ?? 'job_seeker',
    systemRole: opts.system ?? 'user',
    accountStatus: opts.status ?? 'active',
    capabilities: opts.caps ?? []
  } as unknown as User;
  const memberships = opts.orgRole
    ? [{ id: 'm1', organizationId: 'org1', userId: 'u1', orgRole: opts.orgRole, status: 'active', permissions: [], createdAt: '' }]
    : [];
  return {
    user,
    activeOrganization: opts.orgRole ? ({ id: 'org1' } as never) : null,
    membership: (memberships[0] as never) ?? null,
    capabilities: opts.caps ?? [],
    platformRole: opts.system ?? 'user',
    userMemberships: memberships as never
  };
}

const visible = (c: AuthorizationContext) => {
  const a = getFeatureAccess(c);
  return (Object.keys(a.tabs) as AppTab[]).filter((t) => a.tabs[t].allowed).sort();
};

describe('role-based visibility', () => {
  it('guest: browse only, nothing else', () => {
    const c = ctx({ guest: true });
    const a = getFeatureAccess(c);
    expect(visible(c)).toEqual(['businesses', 'opportunities']);
    expect(a.canPost).toBe(false);
    expect(a.canListBusiness).toBe(false);
    expect(a.showOrgSwitcher).toBe(false);
  });

  it('job seeker: candidate portal + shared tabs, but NO posting / recruiter / billing / admin', () => {
    const c = ctx({ role: 'job_seeker', caps: ['find_opportunities'] });
    const a = getFeatureAccess(c);
    expect(visible(c)).toEqual(['ai-studio', 'businesses', 'candidate', 'messages', 'opportunities']);
    expect(a.canPost).toBe(false);
    expect(a.isEmployer).toBe(false);
    expect(a.canSeeBilling).toBe(false);
    expect(a.canListBusiness).toBe(false);
    expect(a.showOrgSwitcher).toBe(false);
  });

  it('verification hub is invisible to job seekers, freelancers, buyers and guests', () => {
    for (const c of [
      ctx({ guest: true }),
      ctx({ role: 'job_seeker', caps: ['find_opportunities'] }),
      ctx({ role: 'service_provider', caps: ['offer_services'] }),
      ctx({ role: 'buyer', caps: ['find_business'] })
    ]) {
      expect(getFeatureAccess(c).tabs.verification.allowed).toBe(false);
    }
  });

  it('verification hub is visible to employers, org members, sellers and staff', () => {
    for (const c of [
      ctx({ role: 'employer', caps: ['hire_or_recruit'], orgRole: 'owner' }),
      ctx({ role: 'employer', orgRole: 'member' }),
      ctx({ role: 'business_seller', caps: ['sell_business'] }),
      ctx({ role: 'verification_officer', system: 'verification_officer' }),
      ctx({ role: 'platform_admin', system: 'platform_admin' })
    ]) {
      expect(getFeatureAccess(c).tabs.verification.allowed).toBe(true);
    }
  });

  it('freelancer / service provider is treated as a job seeker (cannot post)', () => {
    const c = ctx({ role: 'service_provider', caps: ['offer_services'] });
    const a = getFeatureAccess(c);
    expect(a.canPost).toBe(false);
    expect(a.tabs.recruiter.allowed).toBe(false);
    expect(a.tabs.candidate.allowed).toBe(true);
  });

  it('employer owner: posting, recruiter studio, billing, org switcher; NO candidate portal', () => {
    const c = ctx({ role: 'employer', caps: ['hire_or_recruit'], orgRole: 'owner' });
    const a = getFeatureAccess(c);
    expect(a.canPost).toBe(true);
    expect(a.tabs.recruiter.allowed).toBe(true);
    expect(a.tabs.billing.allowed).toBe(true);
    expect(a.tabs.candidate.allowed).toBe(false);
    expect(a.tabs.admin.allowed).toBe(false);
    expect(a.showOrgSwitcher).toBe(true);
  });

  it('recruiter member: posts and recruits but cannot manage billing', () => {
    const c = ctx({ role: 'recruiter', caps: ['hire_or_recruit'], orgRole: 'recruiter' });
    const a = getFeatureAccess(c);
    expect(a.canPost).toBe(true);
    expect(a.tabs.recruiter.allowed).toBe(true);
    expect(a.tabs.billing.allowed).toBe(false);
  });

  it('plain org member (no posting role): no posting, no recruiter studio', () => {
    const c = ctx({ role: 'employer', caps: ['hire_or_recruit'], orgRole: 'member' });
    const a = getFeatureAccess(c);
    expect(a.canPost).toBe(false);
    expect(a.tabs.recruiter.allowed).toBe(false);
  });

  it('a new employer with no organization yet cannot post, but can reach the org wizard', () => {
    const c = ctx({ role: 'employer', caps: ['hire_or_recruit'] });
    const a = getFeatureAccess(c);
    expect(a.canPost).toBe(false);
    expect(a.showOrgSwitcher).toBe(true);
  });

  it('business seller can list a business; buyer cannot', () => {
    expect(getFeatureAccess(ctx({ role: 'business_seller', caps: ['sell_business'] })).canListBusiness).toBe(true);
    const buyer = getFeatureAccess(ctx({ role: 'buyer', caps: ['find_business'] }));
    expect(buyer.canListBusiness).toBe(false);
    expect(buyer.canPost).toBe(false);
    expect(buyer.tabs.candidate.allowed).toBe(false);
  });

  it('business seller gets Subscriptions like a recruiter (with or without an organization yet)', () => {
    const noOrg = getFeatureAccess(ctx({ role: 'business_seller', caps: ['sell_business'] }));
    expect(noOrg.tabs.billing.allowed).toBe(true);
    expect(noOrg.canSeeBilling).toBe(true);

    const owner = getFeatureAccess(ctx({ role: 'business_seller', caps: ['sell_business'], orgRole: 'owner' }));
    expect(owner.tabs.billing.allowed).toBe(true);
  });

  it('seller subscription access does not leak to buyers or job seekers', () => {
    expect(getFeatureAccess(ctx({ role: 'buyer', caps: ['find_business'] })).tabs.billing.allowed).toBe(false);
    expect(getFeatureAccess(ctx({ role: 'job_seeker', caps: ['find_opportunities'] })).tabs.billing.allowed).toBe(false);
  });

  it('verification officer: trust & safety, no posting/candidate/billing', () => {
    const c = ctx({ role: 'verification_officer', system: 'verification_officer' });
    const a = getFeatureAccess(c);
    expect(a.tabs.admin.allowed).toBe(true);
    expect(a.canPost).toBe(false);
    expect(a.tabs.candidate.allowed).toBe(false);
    expect(a.tabs.billing.allowed).toBe(false);
  });

  it('platform admin sees everything', () => {
    const c = ctx({ role: 'platform_admin', system: 'platform_admin' });
    expect(visible(c)).toHaveLength(9);
    expect(getFeatureAccess(c).canPost).toBe(true);
  });

  it('suspended accounts lose every protected area', () => {
    const c = ctx({ role: 'employer', orgRole: 'owner', status: 'suspended' });
    const a = getFeatureAccess(c);
    expect(a.canPost).toBe(false);
    expect(visible(c)).toEqual(['businesses', 'opportunities']);
  });
});

describe('AI Studio tools by audience', () => {
  it('job seeker gets candidate tools only', () => {
    const c = ctx({ role: 'job_seeker', caps: ['find_opportunities'] });
    expect(canUseAiStudioTool(c, 'cv_parser')).toBe(true);
    expect(canUseAiStudioTool(c, 'recommendations')).toBe(true);
    expect(canUseAiStudioTool(c, 'job_drafter')).toBe(false);
    expect(canUseAiStudioTool(c, 'match')).toBe(false);
    expect(canUseAiStudioTool(c, 'audit_logs')).toBe(false);
  });
  it('employer gets the job drafter and candidate matching, not CV tools or the audit trail', () => {
    const c = ctx({ role: 'employer', caps: ['hire_or_recruit'], orgRole: 'owner' });
    expect(canUseAiStudioTool(c, 'job_drafter')).toBe(true);
    expect(canUseAiStudioTool(c, 'match')).toBe(true);
    expect(canUseAiStudioTool(c, 'cv_parser')).toBe(false);
    expect(canUseAiStudioTool(c, 'audit_logs')).toBe(false);
  });
  it('only staff see the audit trail', () => {
    expect(canUseAiStudioTool(ctx({ role: 'verification_officer', system: 'moderation_officer' }), 'audit_logs')).toBe(true);
    expect(canUseAiStudioTool(ctx({ guest: true }), 'overview')).toBe(false);
  });
});

describe('plan resolution (subscriber gets the plan they paid for)', () => {
  it.each([
    ['plan-sub-pro-annual', 'pro', 'unlimited', true],
    ['plan-sub-basic-monthly', 'basic', 5, false],
    ['plan_pro', 'pro', 'unlimited', true]
  ])('%s -> %s benefits', (planId, tier, jobs, ai) => {
    const plan = getPlanForSubscription({ planId, tier });
    expect(plan.tier).toBe(tier);
    expect(plan.entitlements.maxActiveJobs).toBe(jobs);
    // business sellers get the same limit per tier as recruiters
    expect(plan.entitlements.maxActiveListings).toBe(jobs);
    expect(plan.entitlements.canUseAI).toBe(ai);
  });
  it('unknown / missing subscription falls back to Free', () => {
    expect(getPlanForSubscription(null).tier).toBe('free');
    expect(getPlanForSubscription({ planId: 'zzz', tier: 'zzz' }).tier).toBe('free');
  });
  it('only Pro has advanced analytics and priority support', () => {
    expect(getPlanForSubscription({ tier: 'pro' }).entitlements).toMatchObject({ advancedAnalytics: true, prioritySupport: true });
    expect(getPlanForSubscription({ tier: 'basic' }).entitlements).toMatchObject({ advancedAnalytics: false, prioritySupport: false });
  });
});
