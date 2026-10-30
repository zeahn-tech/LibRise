import React, { useCallback, useEffect, useState } from 'react';
import { Database, Grid, RefreshCw, ShieldAlert, TrendingUp, UserPlus, Wallet } from 'lucide-react';
import { adminService, type AdminPlatformMetrics } from '../../../services/adminService';
import { buildLineChart, countyBars, formatMinor, percentChange, sumSeries } from '../../../lib/adminAnalytics';

export type AdminTabKey = 'opportunities' | 'verification' | 'reports' | 'payments' | 'users' | 'organizations' | 'businesses' | 'audit';

interface Props {
  onOpenTab?: (tab: AdminTabKey) => void;
}

const DAYS = 7;
const COUNTY_COLORS = ['bg-[#283618]', 'bg-[#606C38]', 'bg-[#BC6C25]', 'bg-[#DDA15E]', 'bg-stone-400'];

/** Real platform analytics: every figure and chart here is computed by the database (admin_platform_metrics). */
export const AnalyticsPanel: React.FC<Props> = ({ onOpenTab }) => {
  const [metrics, setMetrics] = useState<AdminPlatformMetrics | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const started = performance.now();
    try {
      const result = await adminService.getPlatformMetrics(DAYS);
      setLatencyMs(Math.round(performance.now() - started));
      setMetrics(result);
    } catch (err) {
      setLatencyMs(null);
      setError(err instanceof Error ? err.message : 'Could not load platform analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div className="space-y-1">
        <h3 className="font-serif font-bold text-2xl text-[#132A13]">Platform Health & Activity Dashboard</h3>
        <p className="text-stone-500 text-sm">Live figures from the platform database for the last {DAYS} days.</p>
      </div>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl border border-[#E8E4D9] bg-white text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] disabled:opacity-60 cursor-pointer self-start"
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
      </button>
    </div>
  );

  if (!metrics) {
    return (
      <div className="space-y-6">
        {header}
        {error ? (
          <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <span>
              <strong>Database check failed.</strong> {error}
            </span>
            <button type="button" onClick={load} className="px-4 min-h-11 rounded-xl bg-red-600 text-white text-xs font-bold self-start cursor-pointer">
              Retry
            </button>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-stone-500">Loading analytics…</p>
        )}
      </div>
    );
  }

  const queues = metrics.queues;
  const awaiting = queues.paymentsAwaitingReview + queues.verificationPending + queues.reportsOpen + queues.vacanciesNeedingReview;
  const chart = buildLineChart(metrics.daily, ['opportunities', 'applications'], 500, 170, 12);
  const bars = countyBars(metrics.counties);
  const signups = sumSeries(metrics.daily, 'signups');
  const oppsPosted = sumSeries(metrics.daily, 'opportunities');
  const appsLogged = sumSeries(metrics.daily, 'applications');
  const checkedAt = new Date(metrics.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const queueLink = (label: string, count: number, tab: AdminTabKey) => (
    <button
      key={tab}
      type="button"
      onClick={() => onOpenTab?.(tab)}
      className="inline-flex items-center gap-1 min-h-8 px-2 rounded-lg bg-white border border-[#E8E4D9] text-[10px] font-bold text-stone-600 hover:border-[#4F772D] cursor-pointer"
    >
      {label} <span className={count > 0 ? 'text-[#BC6C25]' : 'text-stone-400'}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-8">
      {header}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-[#F9F8F6] border border-[#E8E4D9] rounded-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-stone-400 font-bold uppercase tracking-wider">Database</span>
            <Database className="w-4 h-4 text-stone-400" />
          </div>
          <div className="text-2xl font-bold font-display text-[#283618] mt-1 flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-green-500 rounded-full" aria-hidden="true" /> Connected
          </div>
          <div className="text-[10px] text-stone-500 font-bold mt-1">
            Responded in {latencyMs ?? '—'} ms · checked {checkedAt}
          </div>
        </div>

        <div className="p-5 bg-[#F9F8F6] border border-[#E8E4D9] rounded-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-stone-400 font-bold uppercase tracking-wider">Awaiting review</span>
            <ShieldAlert className={`w-4 h-4 ${awaiting > 0 ? 'text-[#BC6C25]' : 'text-stone-400'}`} />
          </div>
          <div className="text-2xl font-bold font-display text-[#283618] mt-1">{awaiting}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {queueLink('Payments', queues.paymentsAwaitingReview, 'payments')}
            {queueLink('Verification', queues.verificationPending, 'verification')}
            {queueLink('Reports', queues.reportsOpen, 'reports')}
            {queueLink('Vacancies', queues.vacanciesNeedingReview, 'opportunities')}
          </div>
        </div>

        <div className="p-5 bg-[#F9F8F6] border border-[#E8E4D9] rounded-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-stone-400 font-bold uppercase tracking-wider">Revenue · {DAYS} days</span>
            <Wallet className="w-4 h-4 text-emerald-500" />
          </div>
          {metrics.revenue.length === 0 ? (
            <>
              <div className="text-2xl font-bold font-display text-[#283618] mt-1">No payments yet</div>
              <div className="text-[10px] text-stone-500 font-bold mt-1">Confirmed payments will appear here.</div>
            </>
          ) : (
            <div className="mt-1 space-y-1.5">
              {metrics.revenue.map((r) => {
                const change = percentChange(r.currentPeriodMinor, r.previousPeriodMinor);
                return (
                  <div key={r.currency}>
                    <div className="text-2xl font-bold font-display text-[#283618]">{formatMinor(r.currentPeriodMinor, r.currency)}</div>
                    <div className={`text-[10px] font-bold ${change === null ? 'text-stone-500' : change >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {change === null ? `No earlier ${r.currency} payments to compare` : `${change >= 0 ? '+' : ''}${change}% vs previous ${DAYS} days`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-5 bg-[#F9F8F6] border border-[#E8E4D9] rounded-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-stone-400 font-bold uppercase tracking-wider">New sign-ups · {DAYS} days</span>
            <UserPlus className="w-4 h-4 text-[#4F772D]" />
          </div>
          <div className="text-2xl font-bold font-display text-[#283618] mt-1">{signups}</div>
          <div className="text-[10px] text-stone-500 font-bold mt-1">{metrics.totals.users} accounts in total</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="p-6 bg-white border border-[#E8E4D9] rounded-[24px] space-y-4">
          <div className="flex justify-between items-center gap-2 border-b border-stone-100 pb-2">
            <span className="text-sm font-bold text-[#283618] flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-600" /> {DAYS}-Day Marketplace Activity
            </span>
            <span className="text-xs text-stone-400 whitespace-nowrap">Per day</span>
          </div>
          {chart.hasData ? (
            <>
              <svg
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                className="w-full h-auto bg-[#F9F8F6] border border-stone-100 rounded-xl"
                role="img"
                aria-label={`Opportunities posted and applications submitted per day over the last ${DAYS} days`}
              >
                {chart.yTicks.map((t) => (
                  <g key={t.y}>
                    <line x1="0" x2={chart.width} y1={t.y} y2={t.y} stroke="#ECECE6" strokeDasharray="3" />
                    <text x="4" y={t.y - 3} fontSize="9" fill="#A8A29E" fontWeight="700">{t.label}</text>
                  </g>
                ))}
                <path d={chart.series[0].path} fill="none" stroke="#283618" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d={chart.series[1].path} fill="none" stroke="#BC6C25" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" />
                {chart.series.map((s, si) =>
                  s.points.map((p) => (
                    <circle key={`${s.key}-${p.day}`} cx={p.x} cy={p.y} r="3.5" fill={si === 0 ? '#283618' : '#BC6C25'}>
                      <title>{`${p.day}: ${p.value} ${s.key === 'opportunities' ? 'opportunities posted' : 'applications'}`}</title>
                    </circle>
                  ))
                )}
              </svg>
              <div className="flex justify-between text-[10px] text-stone-400 font-bold px-1">
                {chart.xLabels.map((l) => (
                  <span key={l.label}>{l.label}</span>
                ))}
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-stone-500 bg-[#F9F8F6] rounded-xl border border-stone-100">
              No vacancies or applications were recorded in the last {DAYS} days.
            </p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold justify-center pt-1">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-[#283618] inline-block" /> Opportunities posted ({oppsPosted})</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#BC6C25] inline-block" /> Applications submitted ({appsLogged})</span>
          </div>
        </div>

        <div className="p-6 bg-white border border-[#E8E4D9] rounded-[24px] space-y-4">
          <div className="flex justify-between items-center gap-2 border-b border-stone-100 pb-2">
            <span className="text-sm font-bold text-[#283618] flex items-center gap-1.5">
              <Grid className="w-4 h-4 text-[#BC6C25]" /> Published Vacancies by County
            </span>
            <span className="text-xs text-stone-400 whitespace-nowrap">{metrics.totals.publishedOpportunities} live</span>
          </div>
          {bars.length === 0 ? (
            <p className="py-12 text-center text-sm text-stone-500 bg-[#F9F8F6] rounded-xl border border-stone-100">No vacancies are published yet.</p>
          ) : (
            <div className="space-y-3 pt-2">
              {bars.map((bar, idx) => (
                <div key={bar.county} className="space-y-1">
                  <div className="flex justify-between text-xs font-bold text-stone-700">
                    <span>{bar.county === 'Unspecified' ? 'No county set' : `${bar.county} County`}</span>
                    <span>{bar.count} {bar.count === 1 ? 'opening' : 'openings'}</span>
                  </div>
                  <div className="w-full bg-[#F2F2EC] h-2.5 rounded-full overflow-hidden">
                    <div className={`h-full ${COUNTY_COLORS[Math.min(idx, COUNTY_COLORS.length - 1)]} rounded-full`} style={{ width: `${bar.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#F9F8F6] p-6 rounded-[24px] border border-[#E8E4D9] grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
        {[
          ['Total Users', metrics.totals.users],
          ['Organizations', metrics.totals.organizations],
          ['Published Vacancies', metrics.totals.publishedOpportunities],
          ['Applications', metrics.totals.applications],
          ['Business Listings', metrics.totals.businessListings],
          ['Audit Events', metrics.totals.auditEvents]
        ].map(([label, value]) => (
          <div key={label as string}>
            <span className="text-2xl font-bold font-display text-[#283618]">{(value as number).toLocaleString()}</span>
            <span className="text-[10px] text-stone-400 block font-bold uppercase tracking-wider mt-0.5">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
