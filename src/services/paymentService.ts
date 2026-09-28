/**
 * paymentService.ts
 *
 * Manual mobile money payments for vacancy publishing -- the interim
 * system built while direct MTN MoMo / Orange Money API access (real
 * KYC, real merchant onboarding) is pursued separately by the business.
 * See supabase/migrations/*_manual_mobile_money_payments.sql for the
 * full schema/RLS/RPC design rationale, and docs/PAYMENTS.md for the
 * end-to-end explanation of why this exists and what it is not.
 *
 * WHAT THIS IS: a recruiter sends a real P2P mobile money payment to the
 * platform's own MoMo number (see getMomoInstructions()), submits the
 * transaction reference they received back, and a platform admin
 * manually confirms it against real MoMo transaction history before the
 * vacancy publishes.
 *
 * WHAT THIS IS NOT: automatic, instant, or provider-verified. There is
 * no webhook here -- admin_review_payment() (the Postgres RPC this calls
 * for approve/reject) is the human-in-the-loop stand-in for one. Never
 * present this flow to a recruiter as instant confirmation; see
 * PaymentStatus and the UI copy in PaymentCheckoutFlow.tsx.
 *
 * Kept provider-agnostic in shape (PaymentProviderId, the payments
 * table's free-text payment_provider column) so a real API integration
 * can be added as a new provider later without a schema or type
 * redesign -- only a new adapter and real webhook routes would be
 * needed, this service's public method signatures shouldn't need to
 * change.
 */

import {
  Payment,
  PaymentEvent,
  PaymentPlan,
  PaymentProviderId,
  PaymentStatus
} from '../types';
import { getSupabaseClient } from '../lib/supabaseClient';
import { apiClient, ApiResponse } from './apiClient';
import { authService } from './authService';
import { envConfig } from '../config/env';
import {
  ForbiddenError,
  NotFoundError,
  PaymentRequiredError,
  UnauthorizedError,
  ValidationError
} from '../core/errors/AppError';

function client() {
  const c = getSupabaseClient();
  if (!c) {
    throw new ForbiddenError('Supabase is not configured; paymentService requires a live backend.');
  }
  return c;
}

function translateError(error: { code?: string; message: string }): never {
  // P0001 is the SQLSTATE used for the plain-language `raise exception`
  // messages in submit_payment_reference()/admin_review_payment() (e.g.
  // "This payment has already had a reference submitted..." or
  // "This payment window has expired..."). Surface those verbatim --
  // they were written to already be recruiter/admin-readable, unlike a
  // raw Postgres error.
  if (error.code === 'P0001') {
    throw new ValidationError(error.message);
  }
  if (error.code === '42501') {
    throw new ForbiddenError('You do not have permission to perform this action on this payment.');
  }
  if (error.code === 'P0002') {
    throw new NotFoundError('Payment');
  }
  if (error.code === '28000') {
    throw new UnauthorizedError();
  }
  throw new Error(error.message);
}

interface PaymentPlanRow {
  id: string;
  name: string;
  description: string;
  amount_minor: number;
  currency: string;
  duration_days: number;
  features: string[];
  active: boolean;
}

function rowToPlan(row: PaymentPlanRow): PaymentPlan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    durationDays: row.duration_days,
    features: row.features || [],
    active: row.active
  };
}

interface PaymentRow {
  id: string;
  public_payment_id: string;
  organization_id: string;
  created_by_user_id: string;
  opportunity_id: string | null;
  plan_id: string;
  payment_provider: PaymentProviderId;
  payment_method: string | null;
  provider_transaction_id: string | null;
  provider_reference: string;
  sender_phone_number: string | null;
  amount_minor: number;
  currency: string;
  description: string | null;
  status: PaymentStatus;
  metadata: Record<string, unknown>;
  failure_reason: string | null;
  expires_at: string;
  paid_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    publicPaymentId: row.public_payment_id,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    opportunityId: row.opportunity_id,
    planId: row.plan_id,
    paymentProvider: row.payment_provider,
    paymentMethod: row.payment_method,
    providerTransactionId: row.provider_transaction_id,
    providerReference: row.provider_reference,
    senderPhoneNumber: row.sender_phone_number,
    amountMinor: row.amount_minor,
    currency: row.currency,
    description: row.description,
    status: row.status,
    metadata: row.metadata || {},
    failureReason: row.failure_reason,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

interface PaymentEventRow {
  id: string;
  payment_id: string;
  event_type: string;
  provider: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

function rowToEvent(row: PaymentEventRow): PaymentEvent {
  return {
    id: row.id,
    paymentId: row.payment_id,
    eventType: row.event_type,
    provider: row.provider,
    actorUserId: row.actor_user_id,
    payload: row.payload || {},
    createdAt: row.created_at
  };
}

/** A short, recruiter-quotable reference code -- included in the P2P
 *  transfer's memo/note field where the recipient app supports one, and
 *  otherwise just used by the recruiter and the reviewing admin to match
 *  the submitted transaction to this specific payment record. Not a
 *  secret; collisions are prevented by the DB, not by this format. */
function generatePaymentReference(): string {
  return `OHL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

function generatePaymentId(): string {
  return `pay-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/** Display-only formatting from integer minor units. All money math in
 *  this system stays in integer minor units; this never divides into a
 *  float that is then used for anything but rendering. */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return currency === 'USD' ? `$${grouped}.${cents}` : `${grouped}.${cents} ${currency}`;
}

export interface PaymentWithContext extends Payment {
  opportunityTitle?: string | null;
  organizationName?: string | null;
}

/** If an unsubmitted payment's window has passed, expire it server-side
 *  (expire_payment_if_stale) and report it as no longer open. Pending
 *  payments are never expired here -- see the migration for why. */
async function dropIfExpired(row: PaymentRow): Promise<PaymentRow | null> {
  if (row.status === 'created' && new Date(row.expires_at).getTime() < Date.now()) {
    const { error } = await client().rpc('expire_payment_if_stale', { p_payment_id: row.id });
    if (error) translateError(error);
    return null;
  }
  return row;
}

/** Real business MoMo numbers must come from configuration -- never
 *  invented or left as a placeholder that looks real. If unset, callers
 *  must show "not yet configured" rather than a blank or fake number,
 *  since showing nothing is honest and showing a wrong number could
 *  send a recruiter's real money nowhere recoverable. */
export interface MomoInstructions {
  provider: PaymentProviderId;
  configured: boolean;
  phoneNumber: string | null;
  accountName: string | null;
}

export function getMomoInstructions(provider: PaymentProviderId): MomoInstructions {
  const phoneNumber =
    provider === 'manual_momo_mtn' ? envConfig.momoMtnNumber : envConfig.momoOrangeNumber;
  const accountName = envConfig.momoAccountName;
  return {
    provider,
    configured: Boolean(phoneNumber && accountName),
    phoneNumber: phoneNumber || null,
    accountName: accountName || null
  };
}

export const paymentService = {
  /** Server-computed pricing -- the client never supplies (or should
   *  ever supply) the final amount; see initiatePayment() below, which
   *  reads the plan's amount server-side via RLS-scoped SELECT rather
   *  than trusting anything the caller passes in. */
  async getPlans(): Promise<ApiResponse<PaymentPlan[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('payment_plans')
        .select('*')
        .eq('active', true)
        .order('amount_minor', { ascending: true });
      if (error) translateError(error);
      return (data as PaymentPlanRow[]).map(rowToPlan);
    });
  },

  /**
   * Starts a payment for a specific vacancy + plan. Reuses an existing
   * non-terminal payment for the same opportunity if one already exists
   * (idempotency for accidental double-clicks on "Pay Now") rather than
   * creating a duplicate -- a payment record with no money moved yet
   * isn't itself a financial-integrity risk, but showing a recruiter two
   * different reference codes for the same vacancy would be confusing
   * and is worth avoiding.
   */
  async initiatePayment(
    opportunityId: string,
    planId: string,
    provider: PaymentProviderId
  ): Promise<ApiResponse<Payment>> {
    return apiClient.execute(async () => {
      const session = authService.getSession();
      if (!session.user) throw new UnauthorizedError('Sign-in required.');

      const { data: opp, error: oppError } = await client()
        .from('opportunities')
        .select('id, organization_id, status')
        .eq('id', opportunityId)
        .maybeSingle();
      if (oppError) translateError(oppError);
      if (!opp) throw new NotFoundError('Opportunity', opportunityId);
      const organizationId = (opp as { organization_id: string }).organization_id;

      const { data: existing, error: existingError } = await client()
        .from('payments')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .in('status', ['created', 'payment_pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) translateError(existingError);
      if (existing) {
        const stillOpen = await dropIfExpired(existing as PaymentRow);
        if (stillOpen) return rowToPayment(stillOpen);
      }

      const { data: plan, error: planError } = await client()
        .from('payment_plans')
        .select('*')
        .eq('id', planId)
        .eq('active', true)
        .maybeSingle();
      if (planError) translateError(planError);
      if (!plan) throw new NotFoundError('Payment plan', planId);
      const planRow = plan as PaymentPlanRow;

      const insertRow = {
        id: generatePaymentId(),
        public_payment_id: generatePaymentId(),
        organization_id: organizationId,
        created_by_user_id: session.user.id,
        opportunity_id: opportunityId,
        plan_id: planRow.id,
        payment_provider: provider,
        provider_reference: generatePaymentReference(),
        // Amount/currency come from the server-side plan row just read,
        // never from a function argument -- see the spec requirement
        // this exists to satisfy: "Never accept the final payment amount
        // directly from the client."
        amount_minor: planRow.amount_minor,
        currency: planRow.currency,
        description: `${planRow.name} -- vacancy publishing`,
        status: 'created'
      };

      const { data: created, error } = await client()
        .from('payments')
        .insert(insertRow)
        .select('*')
        .maybeSingle();
      if (error) {
        // 23505 = unique_violation on uq_payments_one_open_per_opportunity:
        // another request (a double-click, a second tab) created the open
        // payment for this vacancy between our check above and this
        // insert. That is the idempotency guarantee working -- return the
        // payment that won the race instead of surfacing an error.
        if (error.code === '23505') {
          const { data: winner } = await client()
            .from('payments')
            .select('*')
            .eq('opportunity_id', opportunityId)
            .in('status', ['created', 'payment_pending'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (winner) return rowToPayment(winner as PaymentRow);
        }
        translateError(error);
      }

      await client()
        .from('opportunities')
        .update({ status: 'payment_required' })
        .eq('id', opportunityId);

      return rowToPayment(created as PaymentRow);
    });
  },

  /** Recruiter submits the transaction reference from the real P2P
   *  payment they just sent. Delegates entirely to the submit_payment_reference
   *  RPC (see the migration) rather than a plain UPDATE, so the expiry
   *  check and status transition happen atomically server-side. */
  async submitPaymentReference(
    paymentId: string,
    providerTransactionId: string,
    senderPhoneNumber?: string
  ): Promise<ApiResponse<Payment>> {
    return apiClient.execute(async () => {
      const session = authService.getSession();
      if (!session.user) throw new UnauthorizedError('Sign-in required.');

      const { data, error } = await client().rpc('submit_payment_reference', {
        p_payment_id: paymentId,
        p_provider_transaction_id: providerTransactionId,
        p_sender_phone_number: senderPhoneNumber ?? null
      });
      if (error) translateError(error);
      return rowToPayment(data as PaymentRow);
    });
  },

  async getPayment(paymentId: string): Promise<ApiResponse<Payment>> {
    return apiClient.execute(async () => {
      const { data, error } = await client().from('payments').select('*').eq('id', paymentId).maybeSingle();
      if (error) translateError(error);
      if (!data) throw new NotFoundError('Payment', paymentId);
      return rowToPayment(data as PaymentRow);
    });
  },

  /** Recruiter/employer's own dashboard view -- RLS already scopes this
   *  to organizations the caller belongs to with payments.manage, this
   *  just adds the organizationId filter for a specific org's list. */
  async listOrganizationPayments(organizationId: string): Promise<ApiResponse<Payment[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('payments')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) translateError(error);
      return (data as PaymentRow[]).map(rowToPayment);
    });
  },

  async getPaymentEvents(paymentId: string): Promise<ApiResponse<PaymentEvent[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('payment_events')
        .select('*')
        .eq('payment_id', paymentId)
        .order('created_at', { ascending: true });
      if (error) translateError(error);
      return (data as PaymentEventRow[]).map(rowToEvent);
    });
  },

  // -- Platform admin: manual review queue --------------------------

  /** Platform-admin-only (enforced by RLS: only admins can see other
   *  orgs' payments at all, so a non-admin querying this just gets an
   *  empty list rather than an error -- see the migration's "Platform
   *  admins can view all payments" policy). */
  async listPendingReview(): Promise<ApiResponse<Payment[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('payments')
        .select('*')
        .eq('status', 'payment_pending')
        .order('created_at', { ascending: true });
      if (error) translateError(error);
      return (data as PaymentRow[]).map(rowToPayment);
    });
  },

  /** The ONLY path that can mark a payment successful and publish its
   *  vacancy -- see admin_review_payment() in the migration. This
   *  function call either fully succeeds (payment + opportunity update +
   *  audit event, atomically) or fully fails; there is no partial state
   *  a client could observe. */
  async reviewPayment(
    paymentId: string,
    decision: 'approve' | 'reject',
    notes?: string
  ): Promise<ApiResponse<Payment>> {
    return apiClient.execute(async () => {
      const { data, error } = await client().rpc('admin_review_payment', {
        p_payment_id: paymentId,
        p_decision: decision,
        p_notes: notes ?? null
      });
      if (error) translateError(error);
      return rowToPayment(data as PaymentRow);
    });
  },

  /** The recruiter's in-progress payment for a vacancy, if any -- lets
   *  the checkout flow resume where they left off instead of starting a
   *  second payment (which the DB would reject anyway). */
  async getOpenPaymentForOpportunity(opportunityId: string): Promise<ApiResponse<Payment | null>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('payments')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .in('status', ['created', 'payment_pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) translateError(error);
      if (!data) return null;
      const stillOpen = await dropIfExpired(data as PaymentRow);
      return stillOpen ? rowToPayment(stillOpen) : null;
    });
  },

  /** Admin review queue with vacancy title / organization name where the
   *  caller's RLS allows reading them (falls back to ids otherwise). */
  async listPendingReviewWithContext(): Promise<ApiResponse<PaymentWithContext[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('payments')
        .select('*, opportunities(title), organizations(name)')
        .eq('status', 'payment_pending')
        .order('created_at', { ascending: true });
      if (error) translateError(error);
      return (data as Array<PaymentRow & {
        opportunities?: { title?: string } | null;
        organizations?: { name?: string } | null;
      }>).map((row) => ({
        ...rowToPayment(row),
        opportunityTitle: row.opportunities?.title ?? null,
        organizationName: row.organizations?.name ?? null
      }));
    });
  },

  getMomoInstructions
};
