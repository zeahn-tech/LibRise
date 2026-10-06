import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscriptionService } from '../services/subscriptionService';
import { getPlanById } from '../data/subscriptionPlans';
import type { FeatureEntitlement } from '../types';

const NONE: FeatureEntitlement = getPlanById('plan_free')!.entitlements;
const EVERYTHING: FeatureEntitlement = getPlanById('plan_pro')!.entitlements;

/**
 * The active organization's plan benefits (what the subscriber paid for).
 *
 * - platform admins get everything (they operate the platform)
 * - no active organization, or a failed lookup -> Free limits (default deny,
 *   never default-allow, so a paid feature can't leak on an error)
 * - re-fetches when the active organization changes
 */
export function useEntitlements(): { entitlements: FeatureEntitlement; loading: boolean; tierLabel: string } {
  const { activeOrganization, authContext } = useAuth();
  const orgId = activeOrganization?.id;
  const user = authContext.user;
  const isAdmin = !!user && (user.systemRole === 'platform_admin' || user.primaryRole === 'platform_admin');

  const [state, setState] = useState<{ entitlements: FeatureEntitlement; loading: boolean }>({
    entitlements: NONE,
    loading: !!orgId && !isAdmin
  });

  useEffect(() => {
    let cancelled = false;
    if (isAdmin) {
      setState({ entitlements: EVERYTHING, loading: false });
      return;
    }
    if (!orgId) {
      setState({ entitlements: NONE, loading: false });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    subscriptionService.getEntitlements(orgId).then((res) => {
      if (!cancelled) setState({ entitlements: res.data ?? NONE, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, isAdmin]);

  const e = state.entitlements;
  const tierLabel = e.advancedAnalytics ? 'Professional' : e.canViewCandidateContact ? 'Starter' : 'Free';
  return { ...state, tierLabel };
}
