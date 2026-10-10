import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { paymentService, formatMinorAmount, PaymentWithContext } from '../../services/paymentService';
import { paymentKindLabel } from './PaymentReviewQueue';

/** Provider names as shown to a reviewer. */
const NETWORK: Record<string, string> = { manual_momo_mtn: 'MTN Mobile Money', manual_momo_orange: 'Orange Money' };

/**
 * Read-only history of decided payments (approved / rejected): what it was,
 * for whom, how much, which reference, who decided it and when. Complements
 * the "awaiting review" queue; it changes nothing.
 */
export const PaymentReviewHistory: React.FC = () => {
  const [items, setItems] = useState<PaymentWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'payment_success' | 'payment_failed'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await paymentService.listReviewHistoryWithContext(50);
    if (res.error) setError(res.error.message);
    else {
      setError(null);
      setItems(res.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = items.filter((p) => filter === 'all' || p.status === filter);

  return (
    <section className="space-y-3" aria-label="Payment review history" data-testid="payment-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-[#283618]">Review history</h3>
        <div className="flex items-center gap-2 text-xs">
          {(['all', 'payment_success', 'payment_failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 min-h-9 rounded-xl border font-semibold cursor-pointer ${filter === f ? 'bg-[#283618] text-white border-[#283618]' : 'bg-white text-[#283618] border-[#E8E4D9]'}`}
            >
              {f === 'all' ? 'All' : f === 'payment_success' ? 'Approved' : 'Rejected'}
            </button>
          ))}
          <button onClick={() => void load()} aria-label="Refresh history" className="p-2 rounded-xl border border-[#E8E4D9] bg-white cursor-pointer">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!loading && !error && shown.length === 0 && <p className="text-sm text-stone-500">No decided payments yet.</p>}

      <ul className="space-y-2">
        {shown.map((p) => (
          <li key={p.id} className="bg-white border border-[#E8E4D9] rounded-2xl p-4 text-xs space-y-1.5" data-testid="history-item">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-0.5">
                <div className="font-bold text-sm text-[#283618]">{paymentKindLabel(p)}</div>
                <div className="text-stone-500">
                  {p.organizationName || 'Organization'}
                  {p.planType !== 'subscription' && (p.opportunityTitle || p.listingTitle) ? ` · ${p.opportunityTitle || p.listingTitle}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-sm text-[#132A13]">{formatMinorAmount(p.amountMinor, p.currency)}</div>
                <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-md font-bold uppercase text-[10px] ${p.status === 'payment_success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {p.status === 'payment_success' ? 'Approved' : 'Rejected'}
                </span>
              </div>
            </div>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-0.5 text-stone-600">
              <div className="flex justify-between gap-2"><dt className="text-stone-400">Requested by</dt><dd className="text-right break-words">{p.requesterName || p.requesterEmail || p.createdByUserId}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-stone-400">Network</dt><dd>{NETWORK[p.paymentProvider] ?? p.paymentProvider}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-stone-400">Transaction ID</dt><dd className="font-mono">{p.providerTransactionId || '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-stone-400">Reference</dt><dd className="font-mono">{p.providerReference}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-stone-400">Created</dt><dd>{new Date(p.createdAt).toLocaleString()}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-stone-400">Decided</dt><dd>{p.reviewedAt ? new Date(p.reviewedAt).toLocaleString() : '—'}{p.reviewerName ? ` by ${p.reviewerName}` : ''}</dd></div>
            </dl>
            {p.failureReason && <p className="text-stone-600">Note: {p.failureReason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
};
