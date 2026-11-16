/**
 * Display helpers for the multi-year views. Nothing here computes a business number:
 * yearly figures are read from `result.years` / `result.totals`, and the sampling below only
 * picks which daily records to plot.
 */
import type { PeriodSummary, SimulationResult } from '@/simulation/types';

export interface YearMetric {
  id: string;
  label: string;
  kind: 'money' | 'pct' | 'count';
  /** Which direction counts as an improvement for the change column. */
  better: 'higher' | 'lower';
  hint?: string;
  read: (p: PeriodSummary) => number;
}

export const YEAR_METRICS: YearMetric[] = [
  { id: 'revenue', label: 'Revenue', kind: 'money', better: 'higher', read: (p) => p.income.revenue },
  { id: 'grossProfit', label: 'Gross profit', kind: 'money', better: 'higher', read: (p) => p.income.grossProfit },
  { id: 'ebitda', label: 'EBITDA', kind: 'money', better: 'higher', read: (p) => p.income.ebitda },
  { id: 'netProfit', label: 'Net profit (before income tax)', kind: 'money', better: 'higher', read: (p) => p.income.netProfit },
  { id: 'netMargin', label: 'Net margin', kind: 'pct', better: 'higher', read: (p) => p.netMargin },
  { id: 'ownerDistributions', label: 'Owner distributions', kind: 'money', better: 'higher', hint: 'Cash the owner takes out of the business. Not an expense.', read: (p) => p.cashFlow.ownerDistributions },
  { id: 'endCash', label: 'Ending cash', kind: 'money', better: 'higher', read: (p) => p.balance.cash },
  { id: 'endCustomers', label: 'Ending customers', kind: 'count', better: 'higher', read: (p) => p.endActiveCustomers },
  { id: 'quits', label: 'Employees who quit', kind: 'count', better: 'lower', read: (p) => p.ops.quits },
  { id: 'utilization', label: 'Utilization', kind: 'pct', better: 'higher', hint: 'On-site hours divided by paid hours.', read: (p) => p.utilization },
];

export function yearLabel(p: PeriodSummary): string {
  const days = p.endDay - p.startDay + 1;
  return days < 365 ? `Year ${p.index + 1} (${days} days)` : `Year ${p.index + 1}`;
}

/** Day indexes to plot: every 7th day plus the final day. Sampling only. */
export function weeklyDays(horizonDays: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < horizonDays; d += 7) out.push(d);
  if (horizonDays > 0 && out[out.length - 1] !== horizonDays - 1) out.push(horizonDays - 1);
  return out;
}

export interface LongRunPoint {
  day: number;
  cash: number;
  baselineCash?: number;
  customers: number;
  baselineCustomers?: number;
  /** Running sum of the engine's daily owner distributions up to and including this day. */
  distributions: number;
  baselineDistributions?: number;
}

export function longRunSeries(r: SimulationResult, baseline?: SimulationResult): LongRunPoint[] {
  const cum = (res: SimulationResult) => {
    const out = new Array<number>(res.days.length);
    let run = 0;
    for (let i = 0; i < res.days.length; i++) {
      run += res.days[i].cashFlow.ownerDistributions;
      out[i] = run;
    }
    return out;
  };
  const rc = cum(r);
  const bc = baseline ? cum(baseline) : undefined;
  return weeklyDays(r.days.length).map((d) => ({
    day: d,
    cash: r.days[d].balance.cash,
    baselineCash: baseline ? baseline.days[d]?.balance.cash : undefined,
    customers: r.days[d].activeCustomers,
    baselineCustomers: baseline ? baseline.days[d]?.activeCustomers : undefined,
    distributions: rc[d],
    baselineDistributions: bc ? bc[d] : undefined,
  }));
}
