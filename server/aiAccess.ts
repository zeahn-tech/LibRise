/**
 * Server-side plan check for the Pro-only AI endpoints. The decision is made by the database function
 * public.my_ai_access() using the CALLER's own token, so it cannot be influenced by anything the browser sends.
 * Failures deny (fail closed) with a distinct message so an operator can tell "not on Pro" from "check broken".
 */

export interface AiAccessDecision {
  allowed: boolean;
  /** 402 = not on the Pro plan, 503 = the check itself could not run. Only set when allowed is false. */
  status?: 402 | 503;
  error?: string;
}

export interface AiAccessDeps {
  /** Calls my_ai_access() as the user identified by `token`. */
  callMyAiAccess: (token: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  now?: () => number;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; allowed: boolean }>();

export function resetAiAccessCache(): void {
  cache.clear();
}

export async function checkAiAccess(deps: AiAccessDeps, userId: string, token: string): Promise<AiAccessDecision> {
  const now = deps.now ? deps.now() : Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at < TTL_MS) {
    return hit.allowed ? { allowed: true } : { allowed: false, status: 402, error: PRO_REQUIRED };
  }

  try {
    const { data, error } = await deps.callMyAiAccess(token);
    if (error) {
      console.error('AI plan check failed:', error.message);
      return { allowed: false, status: 503, error: 'The plan check is unavailable right now. Please try again shortly.' };
    }
    const allowed = data === true;
    cache.set(userId, { at: now, allowed });
    return allowed ? { allowed: true } : { allowed: false, status: 402, error: PRO_REQUIRED };
  } catch (err) {
    console.error('AI plan check threw:', (err as Error).message);
    return { allowed: false, status: 503, error: 'The plan check is unavailable right now. Please try again shortly.' };
  }
}

export const PRO_REQUIRED = 'This AI tool is part of the Professional plan. Upgrade your organization to use it.';
