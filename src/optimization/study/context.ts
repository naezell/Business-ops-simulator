/**
 * Study context: resolved request, budgeted access to the evaluation backend, and the paired
 * evaluation of a strategy (optimization-design §2, §9). Every number produced here is a
 * simulation output or arithmetic on simulation outputs.
 */
import type { CompanyConfig, DecisionRule, Id, PlannedAction, Scenario } from '../../simulation';
import {
  DEFAULT_MAX_CUSTOMER_LOSS_FRACTION,
  DEFAULT_MAX_MISSED_JOB_RATE,
  DEFAULT_MIN_CASH_FLOOR,
  DEFAULT_MIN_PROBABILITY_OF_IMPROVEMENT,
  simulatedReasons,
  staticReasons,
  upfrontCash,
  type ResolvedConstraints,
} from '../constraints';
import { distribution, mean, seedsFor, shareImproved, type RunSummary } from '../evaluate';
import { assumptionSentence, computeDrivers, explanationSentences } from '../explain';
import { isAssumptionSensitive } from '../search';
import type { CandidateCategory, Objective } from '../types';
import type {
  EvalJob,
  EvaluateBatch,
  RunDigest,
  StrategyEvaluation,
  StrategyMember,
  StudyBudget,
  StudyControl,
  StudyRequest,
  Variant,
} from '../study-types';
import { cashSampleDays, runCost, variantKey } from './backend';
import { Budget, resolveBudget } from './budget';

/** Thrown when `control.shouldStop()` returns true; runStudy returns the last partial result. */
export class StudyStopped extends Error {
  constructor() {
    super('study stopped');
    this.name = 'StudyStopped';
  }
}

/** A candidate strategy before evaluation. */
export interface StratDef {
  id: Id;
  label: string;
  category: CandidateCategory;
  members: StrategyMember[];
  /** Conflict keys of all members (two strategies sharing a key cannot be combined). */
  conflictKeys: string[];
  actions: PlannedAction[];
  rules: DecisionRule[];
}

export function variantOf(d: { actions: PlannedAction[]; rules: DecisionRule[] }): Variant {
  const v: Variant = {};
  if (d.actions.length > 0) v.actions = d.actions;
  if (d.rules.length > 0) v.rules = d.rules;
  return v;
}

export interface StudyContext {
  req: StudyRequest;
  base: Scenario;
  company: CompanyConfig;
  H: number;
  objective: Objective;
  constraints: ResolvedConstraints;
  budgetCfg: StudyBudget;
  budget: Budget;
  seeds: number[];
  screenSeeds: number[];
  validationSeeds: number[];
  evaluate: EvaluateBatch;
  control?: StudyControl;
  /** key|seed → digest of every run done by this study. */
  digests: Map<string, RunDigest>;
  simulationsRun: number;
}

export function createContext(req: StudyRequest, evaluate: EvaluateBatch, control?: StudyControl): StudyContext {
  const budgetCfg = resolveBudget(req.budget);
  const seeds = seedsFor(req.scenario.seed, budgetCfg.seeds);
  return {
    req,
    base: req.scenario,
    company: req.scenario.company,
    H: req.scenario.horizonDays,
    objective: req.objective,
    constraints: {
      minCashFloor: req.constraints?.minCashFloor ?? DEFAULT_MIN_CASH_FLOOR,
      maxMissedJobRate: req.constraints?.maxMissedJobRate ?? DEFAULT_MAX_MISSED_JOB_RATE,
      maxCustomerLossFraction: req.constraints?.maxCustomerLossFraction ?? DEFAULT_MAX_CUSTOMER_LOSS_FRACTION,
      minProbabilityOfImprovement: req.constraints?.minProbabilityOfImprovement ?? DEFAULT_MIN_PROBABILITY_OF_IMPROVEMENT,
    },
    budgetCfg,
    budget: new Budget(budgetCfg.maxSimulations),
    seeds,
    screenSeeds: seeds.slice(0, budgetCfg.screenSeeds),
    validationSeeds: seeds.slice(0, budgetCfg.validationSeeds),
    evaluate,
    control,
    digests: new Map(),
    simulationsRun: 0,
  };
}

export interface FetchItem {
  variant: Variant;
  seeds: number[];
}

/** Units the missing runs of `items` would cost. */
export function costOf(ctx: StudyContext, items: FetchItem[]): number {
  const seen = new Set<string>();
  let cost = 0;
  for (const it of items) {
    const key = variantKey(it.variant);
    for (const s of it.seeds) {
      const k = `${key}|${s}`;
      if (ctx.digests.has(k) || seen.has(k)) continue;
      seen.add(k);
      cost += runCost(it.variant, ctx.H);
    }
  }
  return cost;
}

/**
 * Digests for every (variant, seed) of `items`, in order, simulating only what this study has not
 * run yet, as one batch. Returns null (and marks the budget cut) when the phase cannot afford it.
 */
export async function fetchRuns(ctx: StudyContext, items: FetchItem[]): Promise<RunDigest[][] | null> {
  if (ctx.control?.shouldStop?.()) throw new StudyStopped();
  const jobs: EvalJob[] = [];
  const seen = new Set<string>();
  let cost = 0;
  const keys = items.map((it) => variantKey(it.variant));
  items.forEach((it, i) => {
    for (const s of it.seeds) {
      const k = `${keys[i]}|${s}`;
      if (ctx.digests.has(k) || seen.has(k)) continue;
      seen.add(k);
      jobs.push({ key: keys[i], variant: it.variant, seed: s });
      cost += runCost(it.variant, ctx.H);
    }
  });
  if (!ctx.budget.canAfford(cost)) {
    ctx.budget.cut();
    return null;
  }
  if (jobs.length > 0) {
    const out = await ctx.evaluate(jobs);
    ctx.budget.charge(cost);
    ctx.simulationsRun += jobs.length;
    jobs.forEach((j, i) => ctx.digests.set(`${j.key}|${j.seed}`, out[i]));
  }
  return items.map((it, i) => it.seeds.map((s) => ctx.digests.get(`${keys[i]}|${s}`) as RunDigest));
}

// ───────────── Digest adapters ─────────────

export function objectiveOf(d: RunDigest, objective: Objective): number {
  return objective === 'net-profit' ? d.total.income.netProfit : d.total.endingCashNet;
}

const ratio = (a: number, b: number) => (b !== 0 ? a / b : 0);

/** The optimizer-v1 RunSummary view of a digest, so constraints, drivers and texts are shared. `cashSeries` is weekly-sampled. */
export function toSummary(d: RunDigest): RunSummary {
  const t = d.total;
  const jobTypes: RunSummary['jobTypes'] = {};
  for (const [id, j] of Object.entries(d.jobTypes)) jobTypes[id] = { contribution: j.contribution, jobsCompleted: j.jobsCompleted, jobsCancelled: j.jobsCancelled };
  return {
    seed: d.seed,
    income: t.income as unknown as RunSummary['income'],
    netProfit: t.income.netProfit,
    endingCash: t.endingCashNet,
    revenue: t.income.revenue,
    minCash: d.minCash,
    shortfallDays: d.shortfallDays,
    utilization: ratio(t.onSiteHours, t.paidHours),
    missedJobRate: ratio(t.jobsCancelled, t.jobsCompleted + t.jobsCancelled),
    jobsCompleted: t.jobsCompleted,
    jobsCancelled: t.jobsCancelled,
    endActiveCustomers: t.endActiveCustomers,
    cashSeries: Float64Array.from(d.cashWeekly),
    rejected: d.rejected,
    unserved: t.unserved as RunSummary['unserved'],
    lostRevenue: t.lostRevenue,
    idleHours: t.idleHours,
    paidHours: t.paidHours,
    jobTypes,
  };
}

/** First sampled day from which the seed-mean Δ(cash − loc) stays ≥ 0; null without upfront cost or if never. */
export function paybackFromDigests(runs: RunDigest[], base: RunDigest[], upfront: number, H: number): number | null {
  if (!(upfront > 0) || runs.length === 0) return null;
  const days = cashSampleDays(H);
  let first: number | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    let s = 0;
    for (let k = 0; k < runs.length; k++) s += runs[k].cashWeekly[i] - base[k].cashWeekly[i];
    if (s / runs.length >= 0) first = days[i];
    else break;
  }
  return first;
}

// ───────────── Paired evaluation ─────────────

/** Static infeasibility of a definition (cash up front, seats, empty crews); rules are not checked statically. */
export function staticCheck(ctx: StudyContext, d: StratDef): string[] {
  return staticReasons(ctx.company, d.actions);
}

/** Builds a StrategyEvaluation from paired runs (runs[i] vs base[i], same seed). Verdict is provisional. */
export function buildEvaluation(ctx: StudyContext, d: StratDef, runs: RunDigest[], base: RunDigest[]): StrategyEvaluation {
  const R = runs.map(toSummary);
  const B = base.map(toSummary);
  const dObj = runs.map((r, i) => objectiveOf(r, ctx.objective) - objectiveOf(base[i], ctx.objective));
  const dNet = R.map((r, i) => r.netProfit - B[i].netProfit);
  const reasons = simulatedReasons(R, B, ctx.constraints);
  const feasible = reasons.length === 0;
  const pImp = shareImproved(dObj);
  const objMean = mean(dObj);
  const upfront = upfrontCash(ctx.company, d.actions);
  const minCash = Math.min(...R.map((r) => r.minCash));
  const drivers = computeDrivers(R, B);
  const payback = paybackFromDigests(runs, base, upfront, ctx.H);
  const deltaNetProfit = distribution(dNet);
  const sensitive = isAssumptionSensitive(d.members);
  const dCust = R.map((r, i) => r.endActiveCustomers - B[i].endActiveCustomers);
  const mOf = (xs: RunDigest[], f: (x: RunDigest) => number) => mean(xs.map(f));
  const explanation = [
    ...explanationSentences({ runs: R, base: B, drivers, horizonDays: ctx.H, upfront, minCash, payback, probabilityOfImprovement: pImp, deltaNet: deltaNetProfit }),
    ...(sensitive ? [assumptionSentence(mean(dCust), ctx.H)] : []),
  ];
  const recommended = feasible && objMean > 0 && pImp >= ctx.constraints.minProbabilityOfImprovement;
  return {
    id: d.id,
    label: d.label,
    members: d.members,
    variant: variantOf(d),
    feasible,
    infeasibleReasons: reasons,
    seedsEvaluated: runs.length,
    deltaNetProfit,
    deltaEndingCash: distribution(R.map((r, i) => r.endingCash - B[i].endingCash)),
    deltaRevenue: distribution(R.map((r, i) => r.revenue - B[i].revenue)),
    deltaEndCustomers: distribution(dCust),
    operations: {
      missedJobRate: [mean(B.map((r) => r.missedJobRate)), mean(R.map((r) => r.missedJobRate))],
      utilization: [mean(B.map((r) => r.utilization)), mean(R.map((r) => r.utilization))],
      overtimeHours: [mOf(base, (x) => x.total.overtimeHours), mOf(runs, (x) => x.total.overtimeHours)],
      quits: [mOf(base, (x) => x.total.quits), mOf(runs, (x) => x.total.quits)],
    },
    probabilityOfImprovement: pImp,
    upfrontCash: upfront,
    minCash,
    paybackDays: payback,
    drivers,
    explanation,
    assumptionSensitive: sensitive,
    verdict: recommended ? 'recommended' : 'not-recommended',
    caveats: [],
    paretoOptimal: false,
    score: (objMean * 365) / ctx.H,
  };
}

/** Evaluation for a definition that failed a static check (never simulated). */
export function staticEvaluation(ctx: StudyContext, d: StratDef, reasons: string[]): StrategyEvaluation {
  const z = { mean: 0, min: 0, max: 0, stdDev: 0 };
  return {
    id: d.id,
    label: d.label,
    members: d.members,
    variant: variantOf(d),
    feasible: false,
    infeasibleReasons: reasons,
    seedsEvaluated: 0,
    deltaNetProfit: z,
    deltaEndingCash: z,
    deltaRevenue: z,
    deltaEndCustomers: z,
    operations: { missedJobRate: [0, 0], utilization: [0, 0], overtimeHours: [0, 0], quits: [0, 0] },
    probabilityOfImprovement: 0,
    upfrontCash: upfrontCash(ctx.company, d.actions),
    minCash: 0,
    paybackDays: null,
    drivers: [],
    explanation: [`Not simulated: ${reasons.join(' ')}`],
    assumptionSensitive: isAssumptionSensitive(d.members),
    verdict: 'not-recommended',
    caveats: [],
    paretoOptimal: false,
    score: 0,
  };
}

/** Mean Δ objective of an evaluation (in-horizon, seeds it was evaluated on). */
export function meanDelta(e: StrategyEvaluation, objective: Objective): number {
  return objective === 'net-profit' ? e.deltaNetProfit.mean : e.deltaEndingCash.mean;
}

/**
 * Evaluates definitions on `seeds` against the baseline variant `baseVariant` (default: unchanged
 * scenario). Statically infeasible ones are returned without simulating. Definitions the budget
 * cannot afford are dropped (the budget is marked cut). Order of the output follows `defs`.
 */
export async function evaluateDefs(
  ctx: StudyContext,
  defs: StratDef[],
  seeds: number[],
  baseVariant: Variant = {},
): Promise<{ evals: StrategyEvaluation[]; dropped: StratDef[] }> {
  const evals: StrategyEvaluation[] = [];
  const dropped: StratDef[] = [];
  const sim: StratDef[] = [];
  for (const d of defs) {
    const r = staticCheck(ctx, d);
    if (r.length > 0) evals.push(staticEvaluation(ctx, d, r));
    else sim.push(d);
  }
  const baseRuns = await fetchRuns(ctx, [{ variant: baseVariant, seeds }]);
  if (!baseRuns) return { evals, dropped: [...dropped, ...sim] };
  // Evaluate in chunks that fit the phase budget; one batch per chunk keeps workers busy.
  let i = 0;
  while (i < sim.length) {
    let j = i;
    const chunk: FetchItem[] = [];
    while (j < sim.length && chunk.length < 64) {
      const v = onTop(baseVariant, sim[j]);
      const next = [...chunk, { variant: v, seeds }];
      if (!ctx.budget.canAfford(costOf(ctx, next))) break;
      chunk.push({ variant: v, seeds });
      j += 1;
    }
    if (chunk.length === 0) {
      ctx.budget.cut();
      dropped.push(...sim.slice(i));
      break;
    }
    const got = (await fetchRuns(ctx, chunk)) as RunDigest[][];
    for (let k = 0; k < chunk.length; k++) evals.push(buildEvaluation(ctx, sim[i + k], got[k], baseRuns[0]));
    i = j;
  }
  // Keep the input order.
  const order = new Map(defs.map((d, k) => [d.id, k]));
  evals.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
  return { evals, dropped };
}

/** Variant of a strategy applied on top of a baseline variant (stress shocks, probe patches, horizon). */
export function onTop(baseVariant: Variant, d: { actions: PlannedAction[]; rules: DecisionRule[] }): Variant {
  return { ...baseVariant, ...variantOf(d) };
}
