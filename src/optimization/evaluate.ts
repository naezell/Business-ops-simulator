/**
 * Multi-seed paired evaluation (optimization-engine §2).
 *
 * Every run goes through `Evaluator.run`, which caches per-seed summaries so a
 * baseline or a candidate is never simulated twice on the same seed.
 */
import { runSimulation } from '../simulation';
import type {
  Id,
  IncomeStatement,
  PlannedAction,
  Scenario,
  SimulationResult,
  UnservedReason,
} from '../simulation';
import type { Distribution, Objective } from './types';

/** Seed spacing between paired runs: seed_k = scenario.seed + SEED_STRIDE × k. */
export const SEED_STRIDE = 7919;

export function seedsFor(baseSeed: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => baseSeed + SEED_STRIDE * i);
}

/** What the optimizer keeps from one simulation run (summary mode). */
export interface RunSummary {
  seed: number;
  income: IncomeStatement;
  netProfit: number;
  /** Final cash − line-of-credit balance. */
  endingCash: number;
  revenue: number;
  minCash: number;
  shortfallDays: number;
  utilization: number;
  missedJobRate: number;
  jobsCompleted: number;
  jobsCancelled: number;
  endActiveCustomers: number;
  /** End-of-day cash − locBalance, indexed by day. */
  cashSeries: Float64Array;
  /** Reasons of `action-rejected` events. */
  rejected: string[];
  unserved: Record<UnservedReason, number>;
  lostRevenue: number;
  idleHours: number;
  paidHours: number;
  jobTypes: Record<Id, { contribution: number; jobsCompleted: number; jobsCancelled: number }>;
}

export function summarizeRun(r: SimulationResult): RunSummary {
  const t = r.totals;
  const cashSeries = new Float64Array(r.days.length);
  for (let i = 0; i < r.days.length; i++) cashSeries[i] = r.days[i].balance.cash - r.days[i].balance.locBalance;
  const rejected: string[] = [];
  for (const e of r.events) if (e.type === 'action-rejected') rejected.push(`${e.action.type}: ${e.reason}`);
  const jobTypes: RunSummary['jobTypes'] = {};
  for (const [id, s] of Object.entries(r.jobTypeStats)) {
    jobTypes[id] = { contribution: s.contribution, jobsCompleted: s.jobsCompleted, jobsCancelled: s.jobsCancelled };
  }
  return {
    seed: r.seed,
    income: { ...t.income },
    netProfit: t.income.netProfit,
    endingCash: t.balance.cash - t.balance.locBalance,
    revenue: t.income.revenue,
    minCash: t.minCash,
    shortfallDays: t.shortfallDays,
    utilization: t.utilization,
    missedJobRate: t.missedJobRate,
    jobsCompleted: t.ops.jobsCompleted,
    jobsCancelled: t.ops.jobsCancelled,
    endActiveCustomers: t.endActiveCustomers,
    cashSeries,
    rejected,
    unserved: { ...t.ops.unservedHoursByReason },
    lostRevenue: t.ops.lostRevenue,
    idleHours: t.ops.idleHours,
    paidHours: t.ops.paidHours,
    jobTypes,
  };
}

export function objectiveValue(s: RunSummary, objective: Objective): number {
  return objective === 'net-profit' ? s.netProfit : s.endingCash;
}

/** Mean, min, max and sample standard deviation (0 for fewer than two values; all 0 for none). */
export function distribution(values: number[]): Distribution {
  const n = values.length;
  if (n === 0) return { mean: 0, min: 0, max: 0, stdDev: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  const stdDev = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  return { mean, min, max, stdDev };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Share of values strictly greater than 0. */
export function shareImproved(deltas: number[]): number {
  if (deltas.length === 0) return 0;
  let n = 0;
  for (const d of deltas) if (d > 0) n += 1;
  return n / deltas.length;
}

/**
 * Confidence label (§2): high if every seed improved and |mean| > 2·sd/√K with K ≥ 3;
 * medium if probabilityOfImprovement ≥ 0.7; otherwise low.
 */
export function confidenceLabel(deltas: number[]): 'high' | 'medium' | 'low' {
  const k = deltas.length;
  const p = shareImproved(deltas);
  const d = distribution(deltas);
  if (k >= 3 && p === 1 && Math.abs(d.mean) > (2 * d.stdDev) / Math.sqrt(k)) return 'high';
  if (p >= 0.7) return 'medium';
  return 'low';
}

/** Runs and caches simulations of `scenario` + extra day-0 actions, per seed. */
export class Evaluator {
  readonly scenario: Scenario;
  simulationsRun = 0;
  private readonly cache = new Map<string, RunSummary>();
  private readonly onRun?: () => void;

  constructor(scenario: Scenario, onRun?: () => void) {
    this.scenario = scenario;
    this.onRun = onRun;
  }

  /** Summary for `key` (a canonical id of `actions`; '' = baseline) on `seed`. */
  run(key: string, actions: PlannedAction[], seed: number): RunSummary {
    const cacheKey = `${key}|${seed}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return hit;
    const sc: Scenario = { ...this.scenario, seed, actions: [...this.scenario.actions, ...actions] };
    const summary = summarizeRun(runSimulation(sc, { detail: 'summary' }));
    this.simulationsRun += 1;
    this.cache.set(cacheKey, summary);
    this.onRun?.();
    return summary;
  }

  has(key: string, seed: number): boolean {
    return this.cache.has(`${key}|${seed}`);
  }

  baseline(seed: number): RunSummary {
    return this.run('', [], seed);
  }
}
