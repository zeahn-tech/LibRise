import { describe, it, expect } from 'vitest';
import { buildLineChart, countyBars, dayLabel, formatMinor, niceMax, percentChange, sumSeries } from '../lib/adminAnalytics';

const day = (d: string, o = 0, a = 0, s = 0) => ({ day: d, opportunities: o, applications: a, signups: s });

describe('admin analytics helpers', () => {
  it('labels days and formats money in minor units', () => {
    expect(dayLabel('2026-10-26')).toBe('Oct 26');
    expect(dayLabel('2026-01-05')).toBe('Jan 5');
    expect(dayLabel('garbage')).toBe('garbage');
    expect(formatMinor(12000, 'USD')).toBe('$120');
    expect(formatMinor(12050, 'USD')).toBe('$120.50');
    expect(formatMinor(2400000, 'LRD')).toBe('LRD 24,000');
  });

  it('only reports a percentage change when there is an earlier figure (no invented growth)', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it('picks tidy axis maxima that always cover the data', () => {
    for (const v of [0, 1, 4, 5, 9, 13, 47, 130, 999, 1001]) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
    expect(niceMax(0)).toBe(4);
    expect(niceMax(9)).toBe(10);
    expect(niceMax(47)).toBe(50);
  });

  it('builds chart geometry from real values and flags an empty series', () => {
    const daily = [day('2026-10-20', 2, 5), day('2026-10-21', 0, 0), day('2026-10-22', 4, 10)];
    const c = buildLineChart(daily, ['opportunities', 'applications'], 500, 150, 10);
    expect(c.hasData).toBe(true);
    expect(c.yMax).toBe(10);
    const opp = c.series[0].points;
    expect(opp.map((p) => p.value)).toEqual([2, 0, 4]);
    expect(opp[1].y).toBeGreaterThan(opp[0].y); // zero sits lower than 2
    expect(opp[2].y).toBeLessThan(opp[0].y); // 4 sits higher than 2
    expect(c.series[1].points[2].y).toBe(10); // the tallest value touches the top padding
    expect(c.xLabels[0].label).toBe('Oct 20');
    expect(c.xLabels[c.xLabels.length - 1].label).toBe('Oct 22');

    const empty = buildLineChart([day('2026-10-20'), day('2026-10-21')], ['opportunities']);
    expect(empty.hasData).toBe(false);
    expect(buildLineChart([], ['signups']).series[0].path).toBe('');
  });

  it('sums a series and scales county bars to the largest county', () => {
    expect(sumSeries([day('a', 1, 2, 3), day('b', 4, 5, 6)], 'applications')).toBe(7);
    const bars = countyBars([{ county: 'Montserrado', count: 8 }, { county: 'Nimba', count: 2 }, { county: 'Bong', count: 1 }]);
    expect(bars.map((b) => b.pct)).toEqual([100, 25, 13]);
    expect(countyBars([])).toEqual([]);
    expect(countyBars([{ county: 'X', count: 0 }])[0].pct).toBe(0);
  });
});
