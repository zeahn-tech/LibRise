import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Receipt } from 'lucide-react';
import { paymentService, formatMinorAmount, PaymentWithContext } from '../../services/paymentService';
import { generateReceiptPdf, receiptFileName } from '../../lib/paymentReceipt';
import { useToast } from '../../context/ToastContext';
import { CurrencyBadge } from './CurrencyBadge';

/** Approved payments of the organization, each with a PDF receipt. The existing in-app payment notifications are unchanged. */
export const PaymentReceipts: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { showToast } = useToast();
  const [items, setItems] = useState<PaymentWithContext[] | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void paymentService.listOrganizationReceipts(organizationId).then((res) => {
      if (!cancelled) setItems(res.data ?? []);
    });
    return () => { cancelled = true; };
  }, [organizationId]);

  const download = useCallback(async (p: PaymentWithContext) => {
    setWorkingId(p.id);
    try {
      const blob = await generateReceiptPdf({
        payment: p,
        planName: p.planName,
        planType: p.planType,
        organizationName: p.organizationName,
        targetTitle: p.opportunityTitle || p.listingTitle || null
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = receiptFileName(p);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      showToast('We could not create this receipt. Please try again.', 'error');
    } finally {
      setWorkingId(null);
    }
  }, [showToast]);

  if (items === null || items.length === 0) return null;

  return (
    <div className="bg-white p-6 md:p-8 rounded-[32px] border border-[#E8E4D9]" data-testid="payment-receipts">
      <div className="flex items-center gap-2">
        <Receipt className="w-5 h-5 text-[#4F772D]" />
        <h3 className="text-xl font-bold font-display text-[#283618] tracking-tight">Payment receipts</h3>
      </div>
      <p className="text-sm text-stone-500 mt-1">Download a PDF receipt for any payment we have verified.</p>
      <ul className="mt-4 divide-y divide-[#E8E4D9]">
        {items.map((p) => (
          <li key={p.id} className="py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#283618] break-words">{p.planName || 'Payment'}</p>
              <p className="text-xs text-stone-500">
                {new Date(p.paidAt || p.reviewedAt || p.createdAt).toLocaleDateString()} · {p.publicPaymentId}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm font-bold text-[#132A13] text-right">
                {formatMinorAmount(p.amountMinor, p.currency)} <CurrencyBadge currency={p.currency} />
              </span>
              <button
                type="button"
                onClick={() => void download(p)}
                disabled={workingId === p.id}
                aria-label={`Download PDF receipt for ${p.publicPaymentId}`}
                className="min-h-11 px-3 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {workingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                PDF
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
