import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { paymentService, formatMinorAmount, PaymentWithContext } from '../../services/paymentService';
import { useToast } from '../../context/ToastContext';

/**
 * Platform-admin queue for manually confirming mobile money payments.
 *
 * Approving here is the ONLY thing that publishes a paid vacancy (it
 * calls the admin_review_payment RPC, which checks the caller is a
 * platform admin server-side and does payment + vacancy + audit event
 * atomically). Approving is a statement that the admin personally
 * verified the money arrived, so the checklist below is deliberately in
 * the way: the reviewer should have the business MoMo app / statement
 * open and compare, not click through.
 */
export const PaymentReviewQueue: React.FC = () => {
  const { showToast } = useToast();
  const [items, setItems] = useState<PaymentWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  // Per-payment verification ticks. Approve stays disabled until all three are
  // ticked, so approving takes a deliberate comparison against the statement.
  const [checks, setChecks] = useState<Record<string, { amount?: boolean; txn?: boolean; sender?: boolean }>>({});
  const toggle = (id: string, key: 'amount' | 'txn' | 'sender') =>
    setChecks((prev) => ({ ...prev, [id]: { ...prev[id], [key]: !prev[id]?.[key] } }));

  const load = useCallback(async () => {
    setLoading(true);
    const res = await paymentService.listPendingReviewWithContext();
    setLoading(false);
    if (res.data) setItems(res.data);
    else if (res.error) showToast(res.error.message, 'error');
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (item: PaymentWithContext) => {
    const ok = window.confirm(
      `Approve ${formatMinorAmount(item.amountMinor, item.currency)} and ${item.opportunityId ? 'publish this vacancy' : 'activate this subscription'}?\n\n` +
        `Only approve if you have confirmed in the mobile money records that this exact amount, ` +
        `transaction ID (${item.providerTransactionId}) and sender arrived.`
    );
    if (!ok) return;
    setWorkingId(item.id);
    const res = await paymentService.reviewPayment(item.id, 'approve');
    setWorkingId(null);
    if (res.data) {
      showToast(item.opportunityId ? 'Payment approved and vacancy published.' : 'Payment approved and subscription activated.', 'success');
      setItems((prev) => prev.filter((p) => p.id !== item.id));
    } else if (res.error) {
      showToast(res.error.message, 'error');
    }
  };

  const reject = async (item: PaymentWithContext) => {
    const notes = rejectNotes.trim();
    if (notes.length < 5) {
      showToast('Add a short reason so the recruiter knows what went wrong.', 'error');
      return;
    }
    setWorkingId(item.id);
    const res = await paymentService.reviewPayment(item.id, 'reject', notes);
    setWorkingId(null);
    if (res.data) {
      showToast('Payment rejected.', 'info');
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      setRejectingId(null);
      setRejectNotes('');
    } else if (res.error) {
      showToast(res.error.message, 'error');
    }
  };

  const btn = 'min-h-11 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <section className="space-y-4" aria-label="Manual payments awaiting review">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-2xl text-[#132A13]">Payments awaiting review</h3>
          <p className="text-stone-500 text-sm">
            Recruiter-submitted mobile money payments. Nothing publishes until you approve it here.
          </p>
        </div>
        <button onClick={load} disabled={loading} className={`${btn} border border-[#E8E4D9] text-stone-700 shrink-0`}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex gap-3 text-xs text-stone-700 bg-[#FEFAE0] border border-[#E8E4D9] rounded-2xl p-4">
        <ShieldCheck className="w-5 h-5 text-[#BC6C25] shrink-0" />
        <p>
          Before approving, open the business mobile money app or statement and confirm all of: the
          <strong> amount</strong> matches, the <strong>transaction ID</strong> exists and is unused elsewhere, the
          money came from the <strong>sender number</strong> given, and it landed on the right network account. If you
          can't confirm it, reject with a reason -- don't guess.
        </p>
      </div>

      {loading && items.length === 0 ? (
        <div className="py-10 flex justify-center text-stone-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-stone-500 bg-[#F9F8F4] rounded-2xl p-6 text-center">No payments are waiting for review.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="border border-[#E8E4D9] rounded-2xl p-4 space-y-3 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#132A13] text-sm break-words">
                    {item.opportunityTitle || (item.opportunityId ? item.opportunityId : `Subscription: ${item.planName || 'plan upgrade'}`)}
                  </p>
                  <p className="text-xs text-stone-500 break-words">{item.organizationName || item.organizationId}</p>
                </div>
                <p className="font-bold text-lg text-[#132A13] shrink-0">{formatMinorAmount(item.amountMinor, item.currency)}</p>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div className="flex justify-between gap-2"><dt className="text-stone-500 shrink-0">Network</dt><dd className="font-semibold min-w-0 break-words text-right">{item.paymentProvider === 'manual_momo_mtn' ? 'MTN Mobile Money' : 'Orange Money'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-stone-500 shrink-0">Transaction ID</dt><dd className="font-mono font-bold break-all text-right min-w-0">{item.providerTransactionId}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-stone-500 shrink-0">Sender number</dt><dd className="font-semibold min-w-0 break-words text-right">{item.senderPhoneNumber || 'Not provided'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-stone-500 shrink-0">Our reference</dt><dd className="font-mono min-w-0 break-all text-right">{item.providerReference}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-stone-500 shrink-0">Submitted</dt><dd className="min-w-0 text-right">{new Date(item.updatedAt).toLocaleString()}</dd></div>
              </dl>

              {rejectingId === item.id ? (
                <div className="space-y-2">
                  <label htmlFor={`reject-${item.id}`} className="text-xs font-bold text-stone-500 uppercase tracking-wider">Reason shown to the recruiter</label>
                  <textarea id={`reject-${item.id}`} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-[#E8E4D9] rounded-xl text-sm" placeholder="e.g. Transaction ID not found in our records" />
                  <div className="flex gap-2">
                    <button onClick={() => { setRejectingId(null); setRejectNotes(''); }} className={`${btn} border border-[#E8E4D9] text-stone-600`}>Cancel</button>
                    <button onClick={() => reject(item)} disabled={workingId === item.id} className={`${btn} bg-red-700 hover:bg-red-800 text-white flex-1`}>
                      {workingId === item.id && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Confirm rejection</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <fieldset className="space-y-1.5 text-xs text-stone-700">
                    <legend className="font-bold text-stone-500 uppercase tracking-wider mb-1">I confirmed in the MoMo statement that</legend>
                    {([
                      ['amount', `the amount received is exactly ${formatMinorAmount(item.amountMinor, item.currency)}`],
                      ['txn', 'this transaction ID exists, on the right network account, and is not used elsewhere'],
                      ['sender', `it came from the sender number above (${item.senderPhoneNumber || 'not provided'})`]
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-start gap-2 cursor-pointer min-h-8">
                        <input type="checkbox" checked={!!checks[item.id]?.[key]} onChange={() => toggle(item.id, key)} className="mt-0.5 w-4 h-4 shrink-0" />
                        <span>{label}</span>
                      </label>
                    ))}
                    <p className="text-stone-500 pt-0.5">If the statement shows our reference <span className="font-mono">{item.providerReference}</span> in the note, that is extra confirmation, but it is not required.</p>
                  </fieldset>
                <div className="flex gap-2">
                  <button onClick={() => setRejectingId(item.id)} disabled={workingId === item.id} className={`${btn} border border-red-200 text-red-700 flex-1`}>
                    <XCircle className="w-4 h-4" /><span>Reject</span>
                  </button>
                  <button onClick={() => approve(item)} disabled={workingId === item.id || !(checks[item.id]?.amount && checks[item.id]?.txn && checks[item.id]?.sender)} className={`${btn} bg-[#4F772D] hover:bg-[#283618] text-white flex-1`}>
                    {workingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>Verified — approve</span>
                  </button>
                </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
