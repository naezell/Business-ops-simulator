/**
 * Candidate evaluation, ranking and beam search over plans (optimization-engine §2, §5, §6).
 */
import type { CompanyConfig, PlannedAction } from '../simulation';
import type { CandidateDef } from './candidates';
import { conflicts } from './candidates';
import type { ResolvedConstraints } from './constraints';
import { simulatedReasons, staticReasons, upfrontCash } from './constraints';
import type { Evaluator, RunSummary } from './evaluate';
import { confidenceLabel, distribution, mean, objectiveValue, shareImproved } from './evaluate';
import { computeDrivers, explanationSentences, paybackDays } from './explain';
import type { CandidateEvaluation, Objective } from './types';

export const SCREEN_SEEDS = 2;
export const SCREEN_KEEP = 15;
export const POOL_SIZE = 10;
export const MIN_PLAN_GAIN_USD = 100;
export const MIN_PLAN_GAIN_SHARE = 0.01;
export const SMALLER_PLAN_TOLERANCE = 0.02;

export interface SearchContext {
  company: CompanyConfig;
  horizonDays: number;
  objective: Objective;
  seeds: number[];
  evaluator: Evaluator;
  constraints: ResolvedConstraints;
}

/** An action set under evaluation: a single candidate or a plan of several. */
export interface Option {
  key: string;
  label: string;
  category: CandidateDef['category'];
  members: CandidateDef[];
  actions: PlannedAction[];
}

export function singleOption(c: CandidateDef): Option {
  return { key: c.id, label: c.label, category: c.category, members: [c], actions: c.actions };
}

/** Canonical plan: members sorted by id, so equal sets evaluate identically. */
export function planOption(members: CandidateDef[]): Option {
  if (members.length === 1) return singleOption(members[0]);
  const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    key: 'plan:' + sorted.map((m) => m.id).join('+'),
    label: members.map((m) => m.label).join(' + '),
    category: members[0].category,
    members: sorted,
    actions: sorted.flatMap((m) => m.actions),
  };
}

function emptyDist() {
  return { mean: 0, min: 0, max: 0, stdDev: 0 };
}

/** Evaluation for an option that failed a static check (never simulated). */
export function staticallyInfeasible(ctx: SearchContext, opt: Option, reasons: string[]): CandidateEvaluation {
  return {
    id: opt.key,
    label: opt.label,
    category: opt.category,
    actions: opt.actions,
    feasible: false,
    infeasibleReasons: reasons,
    recommended: false,
    seedsEvaluated: 0,
    deltaNetProfit: emptyDist(),
    deltaEndingCash: emptyDist(),
    deltaRevenue: emptyDist(),
    probabilityOfImprovement: 0,
    upfrontCash: upfrontCash(ctx.company, opt.actions),
    minCash: 0,
    paybackDays: null,
    utilization: { before: 0, after: 0 },
    missedJobRate: { before: 0, after: 0 },
    drivers: [],
    explanation: [`Not simulated: ${reasons.join(' ')}`],
    confidence: 'low',
  };
}

/** Simulates `opt` on `seeds` (paired with the cached baseline) and builds its evaluation. */
export function evaluateOption(ctx: SearchContext, opt: Option, seeds: number[]): CandidateEvaluation {
  const { evaluator } = ctx;
  const base: RunSummary[] = seeds.map((s) => evaluator.baseline(s));
  const runs: RunSummary[] = seeds.map((s) => evaluator.run(opt.key, opt.actions, s));
  const dNet = runs.map((r, i) => r.netProfit - base[i].netProfit);
  const dCash = runs.map((r, i) => r.endingCash - base[i].endingCash);
  const dRev = runs.map((r, i) => r.revenue - base[i].revenue);
  const dObj = runs.map((r, i) => objectiveValue(r, ctx.objective) - objectiveValue(base[i], ctx.objective));
  const reasons = simulatedReasons(runs, base, ctx.constraints);
  const feasible = reasons.length === 0;
  const pImp = shareImproved(dObj);
  const objMean = mean(dObj);
  const upfront = upfrontCash(ctx.company, opt.actions);
  const minCash = Math.min(...runs.map((r) => r.minCash));
  const drivers = computeDrivers(runs, base);
  const payback = paybackDays(runs, base, upfront);
  const deltaNetProfit = distribution(dNet);
  return {
    id: opt.key,
    label: opt.label,
    category: opt.category,
    actions: opt.actions,
    feasible,
    infeasibleReasons: reasons,
    recommended: feasible && objMean > 0 && pImp >= ctx.constraints.minProbabilityOfImprovement,
    seedsEvaluated: seeds.length,
    deltaNetProfit,
    deltaEndingCash: distribution(dCash),
    deltaRevenue: distribution(dRev),
    probabilityOfImprovement: pImp,
    upfrontCash: upfront,
    minCash,
    paybackDays: payback,
    utilization: { before: mean(base.map((r) => r.utilization)), after: mean(runs.map((r) => r.utilization)) },
    missedJobRate: { before: mean(base.map((r) => r.missedJobRate)), after: mean(runs.map((r) => r.missedJobRate)) },
    drivers,
    explanation: explanationSentences({
      runs,
      base,
      drivers,
      horizonDays: ctx.horizonDays,
      upfront,
      minCash,
      payback,
      probabilityOfImprovement: pImp,
      deltaNet: deltaNetProfit,
    }),
    confidence: confidenceLabel(dObj),
  };
}

export function objectiveDelta(e: CandidateEvaluation, objective: Objective): number {
  return objective === 'net-profit' ? e.deltaNetProfit.mean : e.deltaEndingCash.mean;
}

/** Mean objective delta desc; ties: lower upfrontCash, then id. */
export function rankEvaluations(list: CandidateEvaluation[], objective: Objective): CandidateEvaluation[] {
  return [...list].sort(
    (a, b) =>
      objectiveDelta(b, objective) - objectiveDelta(a, objective) ||
      a.upfrontCash - b.upfrontCash ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface PlanSearchOutput {
  bestPlan: CandidateEvaluation | null;
  infeasible: CandidateEvaluation[];
}

interface Beam {
  members: CandidateDef[];
  evaluation: CandidateEvaluation;
}

/**
 * Beam search (§6): pool = up to 10 best recommended singles, beams = best
 * `beamWidth`; extend by non-conflicting pool members up to `maxPlanSize`.
 */
export function beamSearch(
  ctx: SearchContext,
  ranked: CandidateEvaluation[],
  defs: Map<string, CandidateDef>,
  beamWidth: number,
  maxPlanSize: number,
  onPlanProgress?: (completed: number, total: number) => void,
): PlanSearchOutput {
  const { objective } = ctx;
  const pool = ranked.filter((e) => e.recommended).slice(0, POOL_SIZE);
  const infeasible: CandidateEvaluation[] = [];
  if (pool.length === 0) return { bestPlan: null, infeasible };
  const poolDefs = pool.map((e) => defs.get(e.id) as CandidateDef);

  let beams: Beam[] = pool.slice(0, Math.max(1, beamWidth)).map((e, i) => ({ members: [poolDefs[i]], evaluation: e }));
  let best: CandidateEvaluation = pool[0];
  const seen = new Set<string>();
  let completed = 0;

  for (let size = 2; size <= maxPlanSize && beams.length > 0; size++) {
    // Children with the parents that generate them (de-duplicated by action-id set).
    const children = new Map<string, { opt: Option; parentGain: number }>();
    for (const b of beams) {
      for (const d of poolDefs) {
        if (b.members.some((m) => m.id === d.id || conflicts(m, d))) continue;
        const opt = planOption([...b.members, d]);
        const parentGain = objectiveDelta(b.evaluation, objective);
        const prev = children.get(opt.key);
        if (prev) prev.parentGain = Math.max(prev.parentGain, parentGain);
        else if (!seen.has(opt.key)) children.set(opt.key, { opt, parentGain });
      }
    }
    const total = completed + children.size;
    const next: Beam[] = [];
    for (const { opt, parentGain } of children.values()) {
      seen.add(opt.key);
      const sReasons = staticReasons(ctx.company, opt.actions);
      completed += 1;
      if (sReasons.length > 0) {
        infeasible.push(staticallyInfeasible(ctx, opt, sReasons));
        onPlanProgress?.(completed, total);
        continue;
      }
      const ev = evaluateOption(ctx, opt, ctx.seeds);
      onPlanProgress?.(completed, total);
      if (!ev.feasible) {
        infeasible.push(ev);
        continue;
      }
      const gain = objectiveDelta(ev, objective);
      const threshold = Math.max(MIN_PLAN_GAIN_USD, MIN_PLAN_GAIN_SHARE * parentGain);
      if (ev.recommended && gain > parentGain + threshold) next.push({ members: opt.members, evaluation: ev });
    }
    next.sort(
      (a, b) =>
        objectiveDelta(b.evaluation, objective) - objectiveDelta(a.evaluation, objective) ||
        (a.evaluation.id < b.evaluation.id ? -1 : 1),
    );
    beams = next.slice(0, beamWidth);
    if (beams.length > 0) {
      const top = beams[0].evaluation;
      const bestGain = objectiveDelta(best, objective);
      if (objectiveDelta(top, objective) > bestGain + SMALLER_PLAN_TOLERANCE * Math.abs(bestGain)) best = top;
    }
  }
  return { bestPlan: best, infeasible };
}

