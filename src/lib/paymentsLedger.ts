/**
 * paymentsLedger.ts — pure helpers for the admin revenue / payments ledger (real rows from public.payments).
 */
import type { AdminPayment } from '../services/adminService';
import { formatMinor } from './adminAnalytics';

export type LedgerStatusFilter = 'all' | 'payment_success' | 'payment_pending' | 'payment_failed' | 'payment_expired' | 'other';

export const STATUS_LABEL: Record<string, string> = {
  payment_success: 'Confirmed',
  payment_pending: 'Awaiting review',
  payment_failed: 'Rejected',
  payment_expired: 'Expired',
  created: 'Not submitted',
  cancelled: 'Cancelled'
};

export const statusLabel = (status: string): string => STATUS_LABEL[status] ?? status.replace(/_/g, ' ');

export function filterPayments(rows: AdminPayment[], status: LedgerStatusFilter, query: string): AdminPayment[] {
  const q = query.trim().toLowerCase();
  return rows.filter((p) => {
    const statusOk =
      status === 'all' ||
      p.status === status ||
      (status === 'other' && !['payment_success', 'payment_pending', 'payment_failed', 'payment_expired'].includes(p.status));
    if (!statusOk) return false;
    if (!q) return true;
    return [p.publicPaymentId, p.organizationName, p.planName, p.providerTransactionId, p.senderPhoneNumber]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
}

const csvCell = (value: unknown): string => {
  let text = value === undefined || value === null ? '' : String(value);
  // Neutralise spreadsheet formulas in user-supplied text (CSV injection).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV of the rows exactly as shown (amounts in major units, ISO dates), with a BOM so Excel reads UTF-8. */
export function paymentsToCsv(rows: AdminPayment[]): string {
  const header = ['Reference', 'Organization', 'Item', 'Amount', 'Currency', 'Status', 'Provider', 'Transaction ID', 'Sender phone', 'Created', 'Paid', 'Reviewed', 'Reviewed by', 'Failure reason'];
  const lines = rows.map((p) =>
    [
      p.publicPaymentId,
      p.organizationName,
      p.planName,
      (p.amountMinor / 100).toFixed(2),
      p.currency,
      statusLabel(p.status),
      p.provider,
      p.providerTransactionId,
      p.senderPhoneNumber,
      p.createdAt,
      p.paidAt,
      p.reviewedAt,
      p.reviewedByName,
      p.failureReason
    ]
      .map(csvCell)
      .join(',')
  );
  return '\uFEFF' + [header.join(','), ...lines].join('\r\n');
}

export { formatMinor };

/** "2026-10" -> "Oct 2026". */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Fills months with no payments with zero so the bar chart shows every month in the window. */
export function monthlySeries(
  monthly: Array<{ month: string; currency: string; confirmedMinor: number }>,
  currency: string,
  months: number,
  now: Date = new Date()
): Array<{ month: string; minor: number; pct: number }> {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const byMonth = new Map(monthly.filter((m) => m.currency === currency).map((m) => [m.month, m.confirmedMinor]));
  const values = keys.map((k) => byMonth.get(k) ?? 0);
  const max = Math.max(0, ...values);
  return keys.map((month, i) => ({ month, minor: values[i], pct: max > 0 ? Math.max(values[i] > 0 ? 3 : 0, Math.round((values[i] / max) * 100)) : 0 }));
}
