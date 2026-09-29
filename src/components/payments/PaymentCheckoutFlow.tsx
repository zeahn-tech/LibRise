import React, { useCallback, useEffect, useState } from 'react';
import { X, CheckCircle2, Clock, AlertTriangle, Copy, Loader2, Smartphone } from 'lucide-react';
import { Payment, PaymentPlan, PaymentProviderId } from '../../types';
import { paymentService, formatMinorAmount, getMomoInstructions } from '../../services/paymentService';
import { useToast } from '../../context/ToastContext';

/**
 * Recruiter checkout for the MANUAL mobile money payment flow (see
 * src/services/paymentService.ts and docs/PAYMENTS.md).
 *
 * Honesty rules baked into this UI, on purpose:
 *  - Sending the money and submitting the reference is NOT payment
 *    success. The vacancy only publishes after a platform admin checks
 *    the payment against real mobile money records, so the "waiting"
 *    state says exactly that and never claims instant confirmation.
 *  - No specific review-time promise is made -- none has been agreed.
 *  - If the business's real MoMo numbers are not configured, the flow
 *    refuses to show payment instructions rather than showing blanks or
 *    placeholder numbers a recruiter might actually send money to.
 */

type Step = 'loading' | 'plan' | 'instructions' | 'reference' | 'waiting' | 'done' | 'failed';

interface Props {
  opportunityId: string;
  opportunityTitle?: string;
  onClose: () => void;
  /** Called once the backend reports the payment approved (vacancy live). */
  onPublished?: () => void;
}

const PROVIDER_LABEL: Record<PaymentProviderId, string> = {
  manual_momo_mtn: 'MTN Mobile Money',
  manual_momo_orange: 'Orange Money'
};

const POLL_INTERVAL_MS = 20000;

export const PaymentCheckoutFlow: React.FC<Props> = ({
  opportunityId,
  opportunityTitle,
  onClose,
  onPublished
}) => {
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>('loading');
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [provider, setProvider] = useState<PaymentProviderId>('manual_momo_mtn');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [txnId, setTxnId] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const applyPaymentState = useCallback(
    (p: Payment) => {
      setPayment(p);
      if (p.status === 'payment_success') {
        setStep('done');
        onPublished?.();
      } else if (p.status === 'payment_failed' || p.status === 'payment_expired' || p.status === 'cancelled') {
        setStep('failed');
      } else if (p.status === 'payment_pending') {
        setStep('waiting');
      } else {
        setStep('instructions');
      }
    },
    [onPublished]
  );

  // Initial load: plans, and resume any in-progress payment for this vacancy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [plansRes, openRes] = await Promise.all([
        paymentService.getPlans(),
        paymentService.getOpenPaymentForOpportunity(opportunityId)
      ]);
      if (cancelled) return;
      if (plansRes.error) {
        showToast(plansRes.error.message, 'error');
        setStep('plan');
        return;
      }
      const loaded = plansRes.data || [];
      setPlans(loaded);
      if (loaded.length > 0) setSelectedPlanId(loaded[0].id);
      if (openRes.data) {
        setProvider(openRes.data.paymentProvider);
        applyPaymentState(openRes.data);
      } else {
        setStep('plan');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunityId, applyPaymentState, showToast]);

  const refreshStatus = useCallback(async () => {
    if (!payment) return;
    const res = await paymentService.getPayment(payment.id);
    if (res.data) applyPaymentState(res.data);
  }, [payment, applyPaymentState]);

  // While waiting for an admin to review, poll for the outcome.
  useEffect(() => {
    if (step !== 'waiting') return;
    const timer = setInterval(refreshStatus, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [step, refreshStatus]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || null;
  const instructions = getMomoInstructions(provider);

  const handleStartPayment = async () => {
    if (!selectedPlan) return;
    setBusy(true);
    const res = await paymentService.initiatePayment(opportunityId, selectedPlan.id, provider);
    setBusy(false);
    if (res.data) {
      applyPaymentState(res.data);
    } else if (res.error) {
      showToast(res.error.message, 'error');
    }
  };

  const handleSubmitReference = async () => {
    if (!payment) return;
    const cleaned = txnId.trim();
    if (cleaned.length < 4) {
      setFieldError('Enter the transaction ID from your mobile money confirmation message.');
      return;
    }
    setFieldError(null);
    setBusy(true);
    const res = await paymentService.submitPaymentReference(payment.id, cleaned, senderPhone.trim() || undefined);
    setBusy(false);
    if (res.data) {
      applyPaymentState(res.data);
    } else if (res.error) {
      setFieldError(res.error.message);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied', 'info');
    } catch {
      showToast('Could not copy. Please select and copy it manually.', 'error');
    }
  };

  const busyBtn = 'min-h-11 px-5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Pay to publish vacancy">
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[#E8E4D9]">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif font-bold text-xl text-[#132A13] break-words">Publish your vacancy</h2>
            {opportunityTitle && <p className="text-xs text-stone-500 mt-0.5 break-words">{opportunityTitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 shrink-0 rounded-full bg-[#F9F8F4] flex items-center justify-center text-[#283618] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {step === 'loading' && (
            <div className="py-10 flex flex-col items-center gap-3 text-stone-500 text-sm">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading payment options...</span>
            </div>
          )}

          {step === 'plan' && (
            <>
              <p className="text-sm text-stone-600">
                Your plan's free publishing limit is reached, so this vacancy needs a one-time payment to go live.
              </p>
              {plans.length === 0 ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  No payment packages are available right now. Please try again later.
                </p>
              ) : (
                <div className="space-y-2">
                  {plans.map((plan) => (
                    <label key={plan.id} className={`block border rounded-2xl p-4 cursor-pointer ${selectedPlanId === plan.id ? 'border-[#4F772D] bg-[#F4F8EF]' : 'border-[#E8E4D9]'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <input type="radio" name="plan" checked={selectedPlanId === plan.id} onChange={() => setSelectedPlanId(plan.id)} className="w-4 h-4" />
                          <span className="font-bold text-[#132A13] text-sm">{plan.name}</span>
                        </div>
                        <span className="font-bold text-[#132A13]">{formatMinorAmount(plan.amountMinor, plan.currency)}</span>
                      </div>
                      <p className="text-xs text-stone-500 mt-1 ml-7">{plan.description} ({plan.durationDays} days)</p>
                    </label>
                  ))}
                </div>
              )}

              <div>
                <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Pay with</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(PROVIDER_LABEL) as PaymentProviderId[]).map((id) => (
                    <button key={id} onClick={() => setProvider(id)} className={`min-h-11 rounded-xl border text-sm font-semibold cursor-pointer ${provider === id ? 'border-[#4F772D] bg-[#F4F8EF] text-[#283618]' : 'border-[#E8E4D9] text-stone-600'}`}>
                      {PROVIDER_LABEL[id]}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleStartPayment} disabled={busy || !selectedPlan} className={`${busyBtn} w-full bg-[#4F772D] hover:bg-[#283618] text-white`}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Continue</span>
              </button>
            </>
          )}

          {step === 'instructions' && payment && (
            <>
              {!instructions.configured ? (
                <div className="flex gap-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <p>
                    {PROVIDER_LABEL[provider]} payment details are not set up yet, so we can't show where to send
                    your payment. Please contact support, or choose the other network.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex gap-3 items-start">
                    <Smartphone className="w-5 h-5 text-[#4F772D] shrink-0 mt-0.5" />
                    <p className="text-sm text-stone-700">
                      Send exactly <strong>{formatMinorAmount(payment.amountMinor, payment.currency)}</strong> from your
                      {' '}{PROVIDER_LABEL[provider]} account to the number below. Do this in your own mobile money
                      app or via USSD -- never share your PIN with us or anyone.
                    </p>
                  </div>
                  <dl className="bg-[#F9F8F4] rounded-2xl p-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-3 items-center">
                      <dt className="text-stone-500 shrink-0">Send to</dt>
                      <dd className="font-bold text-[#132A13] flex items-center gap-2 min-w-0">
                        <span className="break-all text-right">{instructions.phoneNumber}</span>
                        <button onClick={() => copy(instructions.phoneNumber || '')} aria-label="Copy number" className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-white border border-[#E8E4D9] cursor-pointer"><Copy className="w-4 h-4" /></button>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3"><dt className="text-stone-500 shrink-0">Account name</dt><dd className="font-bold text-[#132A13] min-w-0 break-words text-right">{instructions.accountName}</dd></div>
                    <div className="flex justify-between gap-3 items-center">
                      <dt className="text-stone-500 shrink-0">Reference</dt>
                      <dd className="font-mono font-bold text-[#132A13] flex items-center gap-2 min-w-0">
                        <span className="break-all text-right">{payment.providerReference}</span>
                        <button onClick={() => copy(payment.providerReference)} aria-label="Copy reference" className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-white border border-[#E8E4D9] cursor-pointer"><Copy className="w-4 h-4" /></button>
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-stone-500">
                    Put the reference in the payment note if your app has one. This payment slot is held for 48 hours.
                  </p>
                  <button onClick={() => setStep('reference')} className={`${busyBtn} w-full bg-[#4F772D] hover:bg-[#283618] text-white`}>
                    I've sent the payment
                  </button>
                </>
              )}
            </>
          )}

          {step === 'reference' && payment && (
            <>
              <p className="text-sm text-stone-700">
                Enter the transaction ID from the confirmation message you received after sending. We'll check it
                against our mobile money records.
              </p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="txn" className="text-xs font-bold text-stone-500 uppercase tracking-wider">Transaction ID</label>
                  <input id="txn" value={txnId} onChange={(e) => setTxnId(e.target.value)} className="mt-1 w-full min-h-11 px-3 border border-[#E8E4D9] rounded-xl text-sm font-mono" placeholder="e.g. from your confirmation SMS" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="sender" className="text-xs font-bold text-stone-500 uppercase tracking-wider">Phone number you paid from (optional)</label>
                  <input id="sender" value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} inputMode="tel" className="mt-1 w-full min-h-11 px-3 border border-[#E8E4D9] rounded-xl text-sm" autoComplete="off" />
                </div>
                {fieldError && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{fieldError}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('instructions')} className={`${busyBtn} border border-[#E8E4D9] text-stone-600`}>Back</button>
                <button onClick={handleSubmitReference} disabled={busy} className={`${busyBtn} flex-1 bg-[#4F772D] hover:bg-[#283618] text-white`}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Submit for confirmation</span>
                </button>
              </div>
            </>
          )}

          {step === 'waiting' && payment && (
            <div className="space-y-4">
              <div className="flex gap-3 items-start bg-[#F9F8F4] rounded-2xl p-4">
                <Clock className="w-5 h-5 text-[#BC6C25] shrink-0 mt-0.5" />
                <div className="text-sm text-stone-700 space-y-2">
                  <p className="font-bold text-[#132A13]">We're confirming your payment.</p>
                  <p>
                    A member of our team is checking your transaction against our mobile money records. This is done
                    by hand, so it is not instant. <strong>You don't need to pay again</strong> -- your vacancy will go
                    live as soon as it's confirmed.
                  </p>
                </div>
              </div>
              <p className="text-xs text-stone-500 break-all">Reference: <span className="font-mono">{payment.providerReference}</span></p>
              <div className="flex gap-2">
                <button onClick={refreshStatus} className={`${busyBtn} flex-1 border border-[#E8E4D9] text-stone-700`}>Check status</button>
                <button onClick={onClose} className={`${busyBtn} flex-1 bg-[#4F772D] hover:bg-[#283618] text-white`}>Close</button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="py-6 flex flex-col items-center text-center gap-3">
              <CheckCircle2 className="w-12 h-12 text-[#4F772D]" />
              <p className="font-bold text-[#132A13] text-lg">Payment confirmed</p>
              <p className="text-sm text-stone-600">Your vacancy is now live.</p>
              <button onClick={onClose} className={`${busyBtn} bg-[#4F772D] hover:bg-[#283618] text-white`}>Done</button>
            </div>
          )}

          {step === 'failed' && (
            <div className="space-y-4">
              <div className="flex gap-3 items-start text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-bold">
                    {payment?.status === 'payment_expired' ? 'This payment window expired.' : 'We could not confirm this payment.'}
                  </p>
                  {payment?.failureReason && <p>{payment.failureReason}</p>}
                  <p>If you did send money, please contact support with your reference so we can sort it out.</p>
                </div>
              </div>
              {payment && <p className="text-xs text-stone-500 break-all">Reference: <span className="font-mono">{payment.providerReference}</span></p>}
              <button
                onClick={() => { setPayment(null); setTxnId(''); setFieldError(null); setStep('plan'); }}
                className={`${busyBtn} w-full bg-[#4F772D] hover:bg-[#283618] text-white`}
              >
                Start a new payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
