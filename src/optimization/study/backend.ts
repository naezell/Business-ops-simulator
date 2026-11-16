/**
 * Evaluation backend (optimization-design §2, implementation-contracts §4–§5).
 *
 * A Variant is applied to the study's base scenario to give one simulated scenario; a run is
 * reduced to a structured-cloneable RunDigest. The in-process backend runs jobs synchronously
 * and is the reference: the worker pool must return identical digests.
 */
import { createDrawCache, runSimulation, scaleCustomerBase } from '../../simulation';
import type { DrawCache, Scenario, SimulationResult } from '../../simulation';
import type { EvalJob, EvaluateBatch, ParamPatch, PeriodDigest, RunDigest, Variant } from '../study-types';

// ───────────── Canonical keys ─────────────

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** JSON with object keys sorted (array order kept). */
export function stableJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

/**
 * Canonical key of a variant: stable under object key order, and under the order of shocks
 * and patches (not semantic); sensitive to the order of actions and rules (semantic).
 * Defaults (empty lists, scale 1, no horizon) are omitted, so {} and { customerScale: 1 } match.
 */
export function variantKey(v: Variant): string {
  const c: Record<string, unknown> = {};
  if (v.actions && v.actions.length > 0) c.actions = v.actions;
  if (v.rules && v.rules.length > 0) c.rules = v.rules;
  if (v.shocks && v.shocks.length > 0) c.shocks = v.shocks.map(stableJson).sort();
  if (v.patches && v.patches.length > 0) c.patches = v.patches.map(stableJson).sort();
  if (v.customerScale !== undefined && v.customerScale !== 1) c.customerScale = v.customerScale;
  if (v.horizonDays !== undefined) c.horizonDays = v.horizonDays;
  return stableJson(c);
}

/** Cost in units of one run of the base horizon H: ⌈L / H⌉. */
export function runCost(variant: Variant, baseHorizon: number): number {
  const L = variant.horizonDays ?? baseHorizon;
  return Math.max(1, Math.ceil(L / baseHorizon));
}

// ───────────── Applying a variant ─────────────

/** Reads the numeric value at a ParamMeta-style dot path (array indices allowed); undefined if absent. */
export function readPath(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'number' ? cur : undefined;
}

/** Applies a patch in place to a CompanyConfig-shaped object; a missing path is left alone. */
export function applyPatch(company: unknown, p: ParamPatch): void {
  const parts = p.path.split('.');
  let cur: unknown = company;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur === null || typeof cur !== 'object') return;
  const last = parts[parts.length - 1];
  const obj = cur as Record<string, unknown>;
  const old = obj[last];
  if (p.value !== undefined) obj[last] = p.value;
  else if (p.factor !== undefined && typeof old === 'number') obj[last] = old * p.factor;
}

/** The scenario one job simulates: base + patches, customer scale, shocks, rules, actions, horizon, seed. */
export function scenarioFor(base: Scenario, variant: Variant, seed: number): Scenario {
  let s: Scenario = structuredClone(base);
  for (const p of variant.patches ?? []) applyPatch(s.company, p);
  if (variant.customerScale !== undefined && variant.customerScale !== 1) s = scaleCustomerBase(s, variant.customerScale);
  if (variant.shocks && variant.shocks.length > 0) s.shocks = [...(s.shocks ?? []), ...variant.shocks];
  if (variant.rules && variant.rules.length > 0) s.rules = [...(s.rules ?? []), ...variant.rules];
  if (variant.actions && variant.actions.length > 0) s.actions = [...s.actions, ...variant.actions];
  if (variant.horizonDays !== undefined) s.horizonDays = variant.horizonDays;
  s.seed = seed;
  return s;
}

// ───────────── Digest ─────────────

function periodDigest(p: SimulationResult['totals'], days: number): PeriodDigest {
  const o = p.ops;
  return {
    days,
    income: { ...p.income } as unknown as Record<string, number>,
    endingCashNet: p.balance.cash - p.balance.locBalance,
    jobsCompleted: o.jobsCompleted,
    jobsCancelled: o.jobsCancelled,
    jobsLate: o.jobsLate,
    lostRevenue: o.lostRevenue,
    paidHours: o.paidHours,
    onSiteHours: o.onSiteHours,
    travelHours: o.travelHours,
    idleHours: o.idleHours,
    overtimeHours: o.overtimeHours,
    scheduledHours: o.scheduledHours,
    completedLaborHours: o.completedLaborHours,
    absentShifts: o.absentShifts,
    crewDaysNotDeployed: o.crewDaysNotDeployed,
    unserved: { ...o.unservedHoursByReason },
    endActiveCustomers: p.endActiveCustomers,
    endActiveEmployees: 0,
    quits: o.quits,
  };
}

/** The one function that turns a SimulationResult into a RunDigest (IC §4). */
export function digestOf(r: SimulationResult, key: string): RunDigest {
  const H = r.days.length;
  const total = periodDigest(r.totals, H);
  total.endActiveEmployees = H > 0 ? r.days[H - 1].activeEmployees : 0;
  const years = r.years.map((y) => {
    const d = periodDigest(y, y.endDay - y.startDay + 1);
    d.endActiveEmployees = r.days[y.endDay].activeEmployees;
    return d;
  });
  const cashWeekly: number[] = [];
  for (const d of cashSampleDays(H)) cashWeekly.push(r.days[d].balance.cash - r.days[d].balance.locBalance);
  const rejected: string[] = [];
  for (const e of r.events) if (e.type === 'action-rejected') rejected.push(`${e.action.type}: ${e.reason}`);
  const jobTypes: RunDigest['jobTypes'] = {};
  for (const [id, s] of Object.entries(r.jobTypeStats)) {
    jobTypes[id] = { contribution: s.contribution, jobsCompleted: s.jobsCompleted, jobsCancelled: s.jobsCancelled, onSiteHours: s.onSiteHours };
  }
  return {
    key,
    seed: r.seed,
    horizonDays: H,
    total,
    years,
    cashWeekly,
    minCash: r.totals.minCash,
    shortfallDays: r.totals.shortfallDays,
    rejected,
    jobTypes,
  };
}

/** Days sampled into `cashWeekly`: 0, 7, 14, … plus the last day. */
export function cashSampleDays(H: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < H; d += 7) out.push(d);
  if (H > 0 && out[out.length - 1] !== H - 1) out.push(H - 1);
  return out;
}

// ───────────── In-process backend ─────────────

/** Runs one job (shared by the in-process backend and the worker). */
export function runJob(base: Scenario, job: EvalJob, draws: DrawCache): RunDigest {
  const r = runSimulation(scenarioFor(base, job.variant, job.seed), { detail: 'summary', drawCache: draws });
  return digestOf(r, job.key);
}

/**
 * Synchronous in-process EvaluateBatch with a key|seed result cache. `batchSize` only splits
 * the work into awaited chunks (to exercise batching in tests); results do not depend on it.
 */
export function createInProcessBackend(base: Scenario, opts: { batchSize?: number } = {}): EvaluateBatch & { runs: () => number } {
  const draws = createDrawCache();
  const cache = new Map<string, RunDigest>();
  let runs = 0;
  const one = (job: EvalJob): RunDigest => {
    const k = `${job.key}|${job.seed}`;
    let d = cache.get(k);
    if (!d) {
      d = runJob(base, job, draws);
      runs += 1;
      cache.set(k, d);
    }
    return d;
  };
  const fn = (async (jobs: EvalJob[]) => {
    const size = opts.batchSize ?? jobs.length;
    const out: RunDigest[] = [];
    for (let i = 0; i < jobs.length; i += Math.max(1, size)) {
      for (const j of jobs.slice(i, i + Math.max(1, size))) out.push(one(j));
      if (opts.batchSize !== undefined) await Promise.resolve();
    }
    return out;
  }) as EvaluateBatch & { runs: () => number };
  fn.runs = () => runs;
  return fn;
}
