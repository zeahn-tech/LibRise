import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { adminService, type AdminPayment, type RevenueOverview } from '../../../services/adminService';
import { filterPayments, formatMinor, monthLabel, monthlySeries, paymentsToCsv, statusLabel, type LedgerStatusFilter } from '../../../lib/paymentsLedger';

const MONTHS = 6;

const PILL: Record<string, string> = {
  payment_success: 'bg-green-100 text-green-800',
  payment_pending: 'bg-amber-100 text-amber-800',
  payment_failed: 'bg-red-100 text-red-800',
  payment_expired: 'bg-stone-200 text-stone-700'
};

const FILTERS: Array<[LedgerStatusFilter, string]> = [
  ['all', 'All'],
  ['payment_success', 'Confirmed'],
  ['payment_pending', 'Awaiting review'],
  ['payment_failed', 'Rejected'],
  ['payment_expired', 'Expired'],
  ['other', 'Not submitted']
];

/** Revenue overview and payments ledger. Every row and total comes from public.payments; nothing is sample data. */
export const RevenueLedgerPanel: React.FC = () => {
  const [overview, setOverview] = useState<RevenueOverview | null>(null);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<LedgerStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [chartCurrency, setChartCurrency] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, p] = await Promise.all([adminService.getRevenueOverview(MONTHS), adminService.listPayments(500)]);
      setOverview(o);
      setPayments(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load revenue data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => filterPayments(payments, status, query), [payments, status, query]);
  const currencies = overview?.totals.map((t) => t.currency) ?? [];
  const activeCurrency = chartCurrency && currencies.includes(chartCurrency) ? chartCurrency : currencies[0];
  const series = useMemo(() => (overview && activeCurrency ? monthlySeries(overview.monthly, activeCurrency, MONTHS) : []), [overview, activeCurrency]);

  const exportCsv = () => {
    const blob = new Blob([paymentsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `librise-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-2xl text-[#132A13]">Revenue & Payments Ledger</h3>
          <p className="text-stone-500 text-sm">Every payment recorded on the platform. Totals are kept separate for each currency.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl border border-[#E8E4D9] bg-white text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] disabled:opacity-60 cursor-pointer">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error ? (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <span>{error}</span>
          <button type="button" onClick={load} className="px-4 min-h-11 rounded-xl bg-red-600 text-white text-xs font-bold self-start cursor-pointer">Retry</button>
        </div>
      ) : loading && !overview ? (
        <p className="py-10 text-center text-sm text-stone-500">Loading…</p>
      ) : overview && payments.length === 0 && overview.totals.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">No payments have been made on the platform yet. Confirmed payments and revenue will appear here.</p>
      ) : overview ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {overview.totals.map((t) => (
              <div key={t.currency} className="p-5 bg-[#F9F8F6] border border-[#E8E4D9] rounded-2xl space-y-2">
                <span className="text-xs text-stone-400 font-bold uppercase tracking-wider">{t.currency} confirmed revenue</span>
                <div className="text-2xl font-bold font-display text-[#283618]">{formatMinor(t.confirmedMinor, t.currency)}</div>
                <div className="text-[11px] text-stone-500 font-semibold space-y-0.5">
                  <p>{t.confirmedCount} confirmed {t.confirmedCount === 1 ? 'payment' : 'payments'}</p>
                  <p className={t.awaitingCount > 0 ? 'text-[#BC6C25]' : ''}>{formatMinor(t.awaitingMinor, t.currency)} awaiting review ({t.awaitingCount})</p>
                  <p>{t.failedCount} rejected · {t.expiredCount} expired</p>
                </div>
              </div>
            ))}
          </div>

          {currencies.length > 0 && (
            <div className="p-6 bg-white border border-[#E8E4D9] rounded-[24px] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
                <span className="text-sm font-bold text-[#283618]">Confirmed revenue by month</span>
                {currencies.length > 1 && (
                  <div className="flex gap-1.5">
                    {currencies.map((c) => (
                      <button key={c} type="button" onClick={() => setChartCurrency(c)} aria-pressed={c === activeCurrency}
                        className={`min-h-9 px-3 rounded-full text-[11px] font-bold border cursor-pointer ${c === activeCurrency ? 'bg-[#283618] text-white border-[#283618]' : 'bg-white text-stone-600 border-[#E8E4D9]'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-end gap-2 sm:gap-3 h-40" role="img" aria-label={`Confirmed ${activeCurrency} revenue for each of the last ${MONTHS} months`}>
                {series.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full gap-1 min-w-0">
                    <span className="text-[10px] font-bold text-stone-500 truncate max-w-full">{m.minor > 0 ? formatMinor(m.minor, activeCurrency!) : ''}</span>
                    <div className="w-full flex items-end flex-1">
                      <div className={`w-full rounded-t-lg ${m.minor > 0 ? 'bg-[#4F772D]' : 'bg-[#F2F2EC]'}`} style={{ height: m.minor > 0 ? `${m.pct}%` : '3px' }} title={`${monthLabel(m.month)}: ${formatMinor(m.minor, activeCurrency!)}`} />
                    </div>
                    <span className="text-[10px] font-bold text-stone-400">{monthLabel(m.month).split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Payment status filter">
                {FILTERS.map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={status === key} onClick={() => setStatus(key)}
                    className={`shrink-0 min-h-11 px-4 rounded-full text-xs font-bold border cursor-pointer ${status === key ? 'bg-[#283618] text-white border-[#283618]' : 'bg-white text-[#606C38] border-[#E8E4D9] hover:border-[#4F772D]'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1 lg:w-64">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-stone-400" />
                  <input type="text" aria-label="Search payments" placeholder="Search reference, org, transaction…" value={query} onChange={(e) => setQuery(e.target.value)}
                    className="w-full pl-9 pr-3 min-h-11 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]" />
                </div>
                <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-[#283618] hover:bg-[#132A13] text-white text-xs font-bold disabled:opacity-50 cursor-pointer">
                  <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export CSV</span>
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-stone-500">No payments match your filters.</p>
            ) : (
              <>
                <p className="text-[11px] text-stone-500 font-semibold">
                  {rows.length} of {payments.length} payments{payments.length >= 500 ? ' (most recent 500 shown)' : ''}
                </p>
                <div className="md:hidden space-y-3">
                  {rows.map((p) => (
                    <div key={p.id} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-[#283618] text-sm break-words">{p.organizationName}</p>
                          <p className="text-xs text-stone-600">{p.planName}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap ${PILL[p.status] || 'bg-stone-100 text-stone-700'}`}>{statusLabel(p.status)}</span>
                      </div>
                      <p className="text-lg font-bold text-emerald-700">{formatMinor(p.amountMinor, p.currency)}</p>
                      <p className="text-[11px] text-stone-500 font-mono break-all">{p.publicPaymentId}</p>
                      <p className="text-[11px] text-stone-500">{p.provider}{p.providerTransactionId ? ` · ${p.providerTransactionId}` : ''} · {when(p.createdAt)}</p>
                      {p.failureReason && <p className="text-[11px] text-red-700 bg-red-50 rounded-lg px-2 py-1">Reason: {p.failureReason}</p>}
                    </div>
                  ))}
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E8E4D9] bg-[#F9F8F6] text-stone-500 uppercase tracking-wider font-bold whitespace-nowrap">
                        <th className="py-3 px-4">Reference</th>
                        <th className="py-3 px-4">Organization</th>
                        <th className="py-3 px-4">Item</th>
                        <th className="py-3 px-4">Amount</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Provider / Transaction</th>
                        <th className="py-3 px-4">Created</th>
                        <th className="py-3 px-4">Reviewed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E4D9]">
                      {rows.map((p) => (
                        <tr key={p.id} className="hover:bg-stone-50/50 align-top">
                          <td className="py-3 px-4 font-mono text-stone-500 font-bold whitespace-nowrap">{p.publicPaymentId}</td>
                          <td className="py-3 px-4 font-bold text-stone-800">{p.organizationName}</td>
                          <td className="py-3 px-4 text-stone-600">{p.planName}</td>
                          <td className="py-3 px-4 font-bold text-emerald-700 whitespace-nowrap">{formatMinor(p.amountMinor, p.currency)}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap ${PILL[p.status] || 'bg-stone-100 text-stone-700'}`}>{statusLabel(p.status)}</span>
                            {p.failureReason && <p className="text-[10px] text-red-700 mt-1 max-w-[16rem]">{p.failureReason}</p>}
                          </td>
                          <td className="py-3 px-4 text-stone-600">
                            {p.provider}
                            {p.providerTransactionId && <span className="block font-mono text-[10px] text-stone-400">{p.providerTransactionId}</span>}
                          </td>
                          <td className="py-3 px-4 text-stone-500 whitespace-nowrap">{when(p.createdAt)}</td>
                          <td className="py-3 px-4 text-stone-500 whitespace-nowrap">
                            {when(p.reviewedAt)}
                            {p.reviewedByName && <span className="block text-[10px] text-stone-400">{p.reviewedByName}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};
