import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { adminService, type AdminSubscription, type SubscriptionTier } from '../../../services/adminService';
import { useToast } from '../../../context/ToastContext';

const TIER_LABEL: Record<SubscriptionTier, string> = { free: 'Free', basic: 'Starter', pro: 'Pro' };
const TIER_STYLE: Record<SubscriptionTier, string> = {
  free: 'bg-stone-100 text-stone-700 border-stone-200',
  basic: 'bg-[#ECF3E9] text-[#4F772D] border-[#D9E3D5]',
  pro: 'bg-[#FEFAE0] text-[#BC6C25] border-[#E8D9A8]'
};

const periodInfo = (s: AdminSubscription) => {
  if (s.tier === 'free') return { text: 'No expiry', expired: false };
  if (!s.currentPeriodEnd) return { text: '—', expired: false };
  const end = new Date(s.currentPeriodEnd);
  const expired = end.getTime() < Date.now();
  return { text: `${expired ? 'Ended' : 'Renews by'} ${end.toLocaleDateString([], { dateStyle: 'medium' })}`, expired };
};

/** Every organization's real plan (from organization_subscriptions) with an audited admin action to change it. */
export const SubscriptionsPanel: React.FC = () => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AdminSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<{ sub: AdminSubscription; tier: SubscriptionTier } | null>(null);
  const [days, setDays] = useState(30);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await adminService.listSubscriptions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load subscriptions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && setTarget(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, saving]);

  const q = query.trim().toLowerCase();
  const list = useMemo(() => rows.filter((r) => !q || r.organizationName.toLowerCase().includes(q) || r.industry.toLowerCase().includes(q)), [rows, q]);
  const counts = useMemo(
    () => ({ free: rows.filter((r) => r.tier === 'free').length, basic: rows.filter((r) => r.tier === 'basic').length, pro: rows.filter((r) => r.tier === 'pro').length }),
    [rows]
  );

  const confirm = async () => {
    if (!target || saving) return;
    setSaving(true);
    try {
      await adminService.setSubscription(target.sub.organizationId, target.tier, days);
      showToast(`${target.sub.organizationName} is now on the ${TIER_LABEL[target.tier]} plan. Their team has been notified.`, 'success');
      setTarget(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not change the plan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const planButtons = (s: AdminSubscription) => (
    <div className="flex flex-wrap gap-2 justify-end">
      {(['free', 'basic', 'pro'] as SubscriptionTier[])
        .filter((t) => t !== s.tier)
        .map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setDays(30);
              setTarget({ sub: s, tier: t });
            }}
            className={`px-3 min-h-11 rounded-lg font-bold border text-[11px] cursor-pointer hover:opacity-80 ${TIER_STYLE[t]}`}
          >
            {t === 'free' ? 'Move to Free' : `Grant ${TIER_LABEL[t]}`}
          </button>
        ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-2xl text-[#132A13]">Recruiter Corporate SaaS Subscriptions</h3>
          <p className="text-stone-500 text-sm">Each organization’s actual plan. Changing a plan is recorded in the audit trail and the organization is notified.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-3 w-4 h-4 text-stone-400" />
            <input type="text" aria-label="Search organizations" placeholder="Search organizations…" value={query} onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 min-h-11 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]" />
          </div>
          <button type="button" onClick={load} disabled={loading} aria-label="Refresh" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl border border-[#E8E4D9] bg-white hover:bg-[#F9F8F6] disabled:opacity-60 cursor-pointer">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <span>{error}</span>
          <button type="button" onClick={load} className="px-4 min-h-11 rounded-xl bg-red-600 text-white text-xs font-bold self-start cursor-pointer">Retry</button>
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">No organizations have been created yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            {(['free', 'basic', 'pro'] as SubscriptionTier[]).map((t) => (
              <span key={t} className={`px-3 py-1 rounded-full border ${TIER_STYLE[t]}`}>{TIER_LABEL[t]}: {counts[t]}</span>
            ))}
          </div>
          {list.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-500">No organizations match your search.</p>
          ) : (
            <>
              <div className="md:hidden space-y-3">
                {list.map((s) => {
                  const p = periodInfo(s);
                  return (
                    <div key={s.organizationId} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-[#283618] text-sm break-words">{s.organizationName}</p>
                          <p className="text-[11px] text-stone-500">{s.industry || 'No industry set'}</p>
                        </div>
                        <span className={`px-2.5 py-1 border rounded-lg text-[10px] font-extrabold uppercase ${TIER_STYLE[s.tier]}`}>{TIER_LABEL[s.tier]}</span>
                      </div>
                      <p className={`text-[11px] font-semibold ${p.expired ? 'text-red-700' : 'text-stone-500'}`}>{p.text}{s.cancelAtPeriodEnd ? ' · cancels at period end' : ''}</p>
                      {planButtons(s)}
                    </div>
                  );
                })}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E8E4D9] bg-[#F9F8F6] text-stone-500 uppercase tracking-wider font-bold whitespace-nowrap">
                      <th className="py-3 px-4">Organization</th>
                      <th className="py-3 px-4">Industry</th>
                      <th className="py-3 px-4">Plan</th>
                      <th className="py-3 px-4">Period</th>
                      <th className="py-3 px-4 text-right">Change plan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E4D9]">
                    {list.map((s) => {
                      const p = periodInfo(s);
                      return (
                        <tr key={s.organizationId} className="hover:bg-stone-50/50 align-top">
                          <td className="py-3.5 px-4 font-bold text-stone-800">{s.organizationName}</td>
                          <td className="py-3.5 px-4 text-stone-600">{s.industry || '—'}</td>
                          <td className="py-3.5 px-4"><span className={`px-2.5 py-1 border rounded-lg text-[10px] font-extrabold uppercase ${TIER_STYLE[s.tier]}`}>{TIER_LABEL[s.tier]}</span></td>
                          <td className={`py-3.5 px-4 whitespace-nowrap ${p.expired ? 'text-red-700 font-semibold' : 'text-stone-500'}`}>{p.text}{s.cancelAtPeriodEnd ? ' · cancels' : ''}</td>
                          <td className="py-3.5 px-4">{planButtons(s)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {target && (
        <div role="dialog" aria-modal="true" aria-label="Change plan" className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
          <div className="bg-white w-full max-w-md rounded-3xl border border-[#E8E4D9] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto overscroll-contain">
            <div>
              <h3 className="font-serif font-bold text-lg text-[#132A13]">
                {target.tier === 'free' ? 'Move to the Free plan' : `Grant the ${TIER_LABEL[target.tier]} plan`}
              </h3>
              <p className="text-xs text-stone-600 mt-0.5 break-words">{target.sub.organizationName} · currently {TIER_LABEL[target.sub.tier]}</p>
              <p className="text-xs text-stone-500 mt-2">
                This changes their plan immediately without a payment, is recorded in the audit trail, and the organization’s owners and admins are notified.
                {target.tier === 'free' && ' Paid features stop right away.'}
              </p>
            </div>
            {target.tier !== 'free' && (
              <div>
                <label htmlFor="grant-days" className="block text-xs font-bold text-[#283618] mb-1">Duration (days)</label>
                <input id="grant-days" type="number" inputMode="numeric" min={1} max={366} value={days}
                  onChange={(e) => setDays(Math.min(366, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-full min-h-11 px-3 text-sm bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D]" />
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" disabled={saving} onClick={() => setTarget(null)} className="min-h-11 px-4 text-xs font-bold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer">Cancel</button>
              <button type="button" disabled={saving} onClick={confirm} className="min-h-11 px-5 text-xs font-bold text-white rounded-xl bg-[#283618] hover:bg-[#132A13] cursor-pointer disabled:opacity-50">
                {saving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
