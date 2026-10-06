/**
 * Single source of truth for "who sees what" in the UI.
 *
 * Every nav item, call-to-action and workspace guard asks THIS module instead
 * of re-implementing role checks, so the rules cannot drift apart:
 *
 *   guest            -> browse opportunities & businesses only
 *   job seeker /     -> + candidate portal, candidate AI tools, messages,
 *   service provider    verification hub. NO posting, recruiter, billing.
 *   employer / org   -> + Post button, recruiter studio, employer AI tools
 *   member with a       (plan-gated), analytics (plan-gated); billing for
 *   posting role        owners/admins only.
 *   business seller  -> + "List business for sale"
 *   officers / admin -> trust & safety center (+ everything for platform admin)
 *
 * This only controls what is SHOWN. Real enforcement stays server-side
 * (Supabase RLS + the SECURITY DEFINER payment/subscription functions).
 */
import {
  AuthorizationContext,
  WorkspaceAccessResult,
  canAccessWorkspace,
  canPostOpportunities,
  evaluatePermission,
  isCandidateSide,
  isModerationOfficer,
  isPlatformAdmin
} from './permissionEngine';

export type AppTab =
  | 'opportunities'
  | 'businesses'
  | 'verification'
  | 'recruiter'
  | 'candidate'
  | 'ai-studio'
  | 'billing'
  | 'messages'
  | 'admin';

export type RecruiterSubView = 'jobs' | 'pipeline' | 'analytics';
export type AiStudioTool = 'overview' | 'recommendations' | 'match' | 'cv_parser' | 'job_drafter' | 'audit_logs';

const SIGN_IN_REQUIRED: WorkspaceAccessResult = {
  allowed: false,
  reason: "You don't have permission to access this workspace.",
  actionHint: 'Please sign in to access this page.'
};

/** Access decision for one top-level tab/route. */
export function canAccessTab(context: AuthorizationContext, tab: AppTab): WorkspaceAccessResult {
  switch (tab) {
    case 'opportunities':
    case 'businesses':
      return { allowed: true };
    case 'ai-studio':
    case 'messages': {
      if (!context.user) return SIGN_IN_REQUIRED;
      const status = context.user.accountStatus;
      if (status === 'suspended' || status === 'deactivated') {
        return { allowed: false, reason: 'Your account has been restricted.', actionHint: 'Please contact platform trust & safety for assistance.' };
      }
      return { allowed: true };
    }
    default:
      return canAccessWorkspace(context, tab);
  }
}

/** Which AI Studio tools this person may see. */
export function canUseAiStudioTool(context: AuthorizationContext, tool: AiStudioTool): boolean {
  if (!context.user) return false;
  switch (tool) {
    case 'overview':
      return true;
    case 'recommendations':
    case 'cv_parser':
      return isCandidateSide(context);
    // Employer tools. `match` (AI-powered candidate matching) and `job_drafter`
    // are additionally plan-gated by the canUseAI entitlement (Pro) in the UI.
    case 'match':
    case 'job_drafter':
      return canPostOpportunities(context);
    case 'audit_logs':
      return isPlatformAdmin(context) || isModerationOfficer(context);
  }
}

export interface FeatureAccess {
  signedIn: boolean;
  /** Post-vacancy buttons (desktop CTA, mobile FAB, dashboards). */
  canPost: boolean;
  /** "List business for sale". */
  canListBusiness: boolean;
  /** Applications / CV / saved jobs. */
  isCandidate: boolean;
  /** Recruiter studio, employer analytics, employer AI tools. */
  isEmployer: boolean;
  /** Organization switcher / "create organization". */
  showOrgSwitcher: boolean;
  /** Billing teaser + Subscriptions tab. */
  canSeeBilling: boolean;
  tabs: Record<AppTab, WorkspaceAccessResult>;
}

const ALL_TABS: AppTab[] = ['opportunities', 'businesses', 'verification', 'recruiter', 'candidate', 'ai-studio', 'billing', 'messages', 'admin'];

export function getFeatureAccess(context: AuthorizationContext): FeatureAccess {
  const signedIn = !!context.user;
  const canPost = canPostOpportunities(context);
  const caps = context.capabilities || [];
  const tabs = {} as Record<AppTab, WorkspaceAccessResult>;
  for (const t of ALL_TABS) tabs[t] = canAccessTab(context, t);

  return {
    signedIn,
    canPost,
    canListBusiness: signedIn && evaluatePermission(context, 'business.list'),
    isCandidate: isCandidateSide(context),
    isEmployer: canPost,
    showOrgSwitcher:
      signedIn &&
      (isPlatformAdmin(context) ||
        context.userMemberships.some((m) => m.status === 'active') ||
        caps.includes('hire_or_recruit') ||
        caps.includes('sell_business') ||
        caps.includes('seller')),
    canSeeBilling: tabs.billing.allowed,
    tabs
  };
}
