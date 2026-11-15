/**
 * Drivers, payback and template explanations (optimization-engine §7).
 * Every number in the text comes from simulated runs; nothing is estimated here.
 */
import type { IncomeStatement } from '../simulation';
import type { RunSummary } from './evaluate';
import { mean } from './evaluate';
import type { ProfitDriver } from './types';

/** IncomeStatement lines that are not subtotals, with their sign in net profit. */
export const DRIVER_LINES: { line: keyof IncomeStatement; sign: 1 | -1; label: string }[] = [
  { line: 'revenue', sign: 1, label: 'revenue' },
  { line: 'directLabor', sign: -1, label: 'wages' },
  { line: 'payrollBurden', sign: -1, label: 'payroll burden' },
  { line: 'materials', sign: -1, label: 'materials' },
  { line: 'fuel', sign: -1, label: 'fuel' },
  { line: 'maintenance', sign: -1, label: 'maintenance and repairs' },
  { line: 'equipmentLeases', sign: -1, label: 'lease payments' },
  { line: 'overhead', sign: -1, label: 'overhead' },
  { line: 'marketing', sign: -1, label: 'marketing' },
  { line: 'hiringCosts', sign: -1, label: 'hiring costs' },
  { line: 'badDebt', sign: -1, label: 'bad debt' },
  { line: 'depreciation', sign: -1, label: 'depreciation' },
  { line: 'interest', sign: -1, label: 'interest' },
];

/** Whole dollars with thousands separators, e.g. -$12,345. Locale-independent. */
export function fmtUsd(x: number): string {
  const r = Math.round(x);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${r < 0 ? '-' : ''}$${s}`;
}

/** Signed dollars: +$1,200 / -$300. */
export function fmtDelta(x: number): string {
  return Math.round(x) >= 0 ? `+${fmtUsd(x)}` : fmtUsd(x);
}

/** Percentage with one decimal, e.g. 4.3%. */
export function fmtPct(x: number): string {
  return `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
}

/** Seed-mean change of each P&L line as its effect on net profit. Sums to the mean Δ net profit. */
export function computeDrivers(runs: RunSummary[], base: RunSummary[]): ProfitDriver[] {
  return DRIVER_LINES.map(({ line, sign }) => ({
    line,
    delta: sign * mean(runs.map((r, i) => r.income[line] - base[i].income[line])),
  }));
}

/**
 * First day from which the seed-mean Δ(cash − locBalance) stays ≥ 0 until the
 * horizon; null if there is no upfront cost or it never does.
 */
export function paybackDays(runs: RunSummary[], base: RunSummary[], upfront: number): number | null {
  if (!(upfront > 0) || runs.length === 0) return null;
  const n = runs[0].cashSeries.length;
  let first: number | null = null;
  for (let d = n - 1; d >= 0; d--) {
    let s = 0;
    for (let i = 0; i < runs.length; i++) s += runs[i].cashSeries[d] - base[i].cashSeries[d];
    if (s / runs.length >= 0) first = d;
    else break;
  }
  return first;
}

function change(before: number, after: number, fmt: (x: number) => string): string {
  return `${fmt(before)} to ${fmt(after)}`;
}

function count(x: number): string {
  return String(Math.round(x));
}

export interface ExplainInput {
  runs: RunSummary[];
  base: RunSummary[];
  drivers: ProfitDriver[];
  horizonDays: number;
  upfront: number;
  minCash: number;
  payback: number | null;
  probabilityOfImprovement: number;
  deltaNet: { mean: number; min: number; max: number };
}

/** 4 deterministic sentences built only from simulated numbers. */
export function explanationSentences(x: ExplainInput): string[] {
  const { runs, base } = x;
  const k = runs.length;
  const m = (f: (r: RunSummary) => number, rs: RunSummary[]) => mean(rs.map(f));
  const out: string[] = [];

  out.push(
    `Over ${x.horizonDays} days, completed jobs go from ${change(m((r) => r.jobsCompleted, base), m((r) => r.jobsCompleted, runs), count)}, ` +
      `the missed-job rate from ${change(m((r) => r.missedJobRate, base), m((r) => r.missedJobRate, runs), fmtPct)}, ` +
      `crew utilization from ${change(m((r) => r.utilization, base), m((r) => r.utilization, runs), fmtPct)} ` +
      `and active customers at the end from ${change(m((r) => r.endActiveCustomers, base), m((r) => r.endActiveCustomers, runs), count)}.`,
  );

  const revenue = x.drivers.find((d) => d.line === 'revenue')?.delta ?? 0;
  const costs = x.drivers
    .filter((d) => d.line !== 'revenue' && Math.round(d.delta) !== 0)
    .map((d) => ({ ...d, label: DRIVER_LINES.find((l) => l.line === d.line)?.label ?? d.line }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.line < b.line ? -1 : 1))
    .slice(0, 2);
  const costText =
    costs.length === 0
      ? 'no cost line changes materially'
      : costs.map((c) => `${c.label} ${c.delta <= 0 ? 'rise' : 'fall'} by ${fmtUsd(Math.abs(c.delta))}`).join(' and ');
  out.push(
    `Net profit changes by ${fmtDelta(x.deltaNet.mean)} on average: revenue ${revenue >= 0 ? 'rises' : 'falls'} by ${fmtUsd(Math.abs(revenue))}, and ${costText}.`,
  );

  const improved = Math.round(x.probabilityOfImprovement * k);
  out.push(
    `Across ${k} simulated seed${k === 1 ? '' : 's'} the net-profit change ranges from ${fmtDelta(x.deltaNet.min)} to ${fmtDelta(x.deltaNet.max)}; ` +
      `the chosen objective improves in ${improved} of ${k}.`,
  );

  const cashText =
    x.upfront > 0
      ? `It needs ${fmtUsd(x.upfront)} of cash on day 0` +
        (x.payback === null ? ', which is not recovered within the horizon' : `, recovered by day ${x.payback}`)
      : 'It needs no cash up front';
  out.push(`${cashText}; the lowest cash balance in any seed is ${fmtUsd(x.minCash)}.`);
  return out;
}
