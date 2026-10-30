/**
 * adminAnalytics.ts
 *
 * Pure helpers that turn the real numbers returned by admin_platform_metrics into chart geometry and labels.
 * Nothing here invents data: an empty series stays empty and a missing comparison shows as "no data".
 */
import type { DailyMetric } from '../services/adminService';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-26" -> "Oct 26". */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
}

/** Money stored in minor units (cents) -> "$1,234.50" / "LRD 1,234.50". */
export function formatMinor(minor: number, currency: string): string {
  const major = minor / 100;
  const text = major.toLocaleString('en-US', { minimumFractionDigits: major % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${text}` : `${currency} ${text}`;
}

/** Percentage change, or null when there is no earlier figure to compare against (avoids a made-up "+100%"). */
export function percentChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function sumSeries(daily: DailyMetric[], key: 'opportunities' | 'applications' | 'signups'): number {
  return daily.reduce((total, d) => total + (d[key] || 0), 0);
}

/** Smallest "tidy" axis maximum at or above the data (4, 8, 12, 20, 40, ...), never below 4. */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 4, 5, 8, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

export interface ChartSeriesSpec {
  key: 'opportunities' | 'applications' | 'signups';
}

export interface BuiltChart {
  width: number;
  height: number;
  yMax: number;
  yTicks: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string }>;
  series: Array<{ key: string; path: string; points: Array<{ x: number; y: number; value: number; day: string }> }>;
  hasData: boolean;
}

/** Straight-segment line chart geometry (no smoothing, so the line never implies values that were not measured). */
export function buildLineChart(daily: DailyMetric[], keys: ChartSeriesSpec['key'][], width = 500, height = 150, pad = 10): BuiltChart {
  const n = daily.length;
  const maxValue = Math.max(0, ...daily.flatMap((d) => keys.map((k) => d[k] || 0)));
  const yMax = niceMax(maxValue);
  const innerH = height - pad * 2;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const y = (v: number) => pad + innerH - (v / yMax) * innerH;

  const series = keys.map((key) => {
    const points = daily.map((d, i) => ({ x: x(i), y: y(d[key] || 0), value: d[key] || 0, day: d.day }));
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return { key, path, points };
  });

  const yTicks = [0, 0.5, 1].map((f) => ({ y: y(yMax * f), label: String(Math.round(yMax * f)) }));
  const labelIdx = n <= 1 ? [0] : Array.from(new Set([0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1]));
  const xLabels = labelIdx.filter((i) => daily[i]).map((i) => ({ x: x(i), label: dayLabel(daily[i].day) }));

  return { width, height, yMax, yTicks, xLabels, series, hasData: maxValue > 0 };
}

/** Bar widths (percent of the largest county) for the distribution chart. */
export function countyBars(counties: Array<{ county: string; count: number }>): Array<{ county: string; count: number; pct: number }> {
  const max = Math.max(0, ...counties.map((c) => c.count));
  return counties.map((c) => ({ county: c.county, count: c.count, pct: max > 0 ? Math.max(2, Math.round((c.count / max) * 100)) : 0 }));
}
