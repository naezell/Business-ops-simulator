/**
 * Optimizer entry point (optimization-engine §1). Pure, synchronous and
 * deterministic: the only impure input is the optional `clock`, used solely for
 * `elapsedMs` (0 when no clock is supplied).
 */
import type { CompanyConfig, Id } from '../simulation';
import { diagnoseBottlenecks, type RoutingProbe } from './bottlenecks';
import { generateCandidates, type CandidateDef } from './candidates';
import {
  DEFAULT_MAX_CUSTOMER_LOSS_FRACTION,
  DEFAULT_MAX_MISSED_JOB_RATE,
  DEFAULT_MIN_CASH_FLOOR,
  DEFAULT_MIN_PROBABILITY_OF_IMPROVEMENT,
  staticReasons,
  type ResolvedConstraints,
} from './constraints';
import { Evaluator, distribution, mean, seedsFor, type RunSummary } from './evaluate';
import {
  SCREEN_KEEP,
  SCREEN_SEEDS,
  beamSearch,
  evaluateOption,
  objectiveDelta,
  rankEvaluations,
  singleOption,
  staticallyInfeasible,
  type SearchContext,
} from './search';
import type { CandidateEvaluation, OptimizationProgress, OptimizationRequest, OptimizationResult } from './types';

export const DEFAULT_SEED_COUNT = 5;
export const DEFAULT_MAX_PLAN_SIZE = 3;
export const DEFAULT_BEAM_WIDTH = 3;

const ROUTING_PREFIX = 'policy:routing:';

function positiveInt(x: number | undefined, fallback: number): number {
  return x !== undefined && Number.isFinite(x) && x >= 1 ? Math.floor(x) : fallback;
}

function baselineFacts(company: CompanyConfig, base: RunSummary[]) {
  const jobsCompleted: Record<Id, number> = {};
  const demand: Record<Id, number> = {};
  for (const jt of company.jobTypes) {
    jobsCompleted[jt.id] = mean(base.map((r) => r.jobTypes[jt.id]?.jobsCompleted ?? 0));
    demand[jt.id] = mean(base.map((r) => (r.jobTypes[jt.id]?.jobsCompleted ?? 0) + (r.jobTypes[jt.id]?.jobsCancelled ?? 0)));
  }
  return { jobsCompleted, demand };
}

export function optimize(
  request: OptimizationRequest,
  onProgress?: (p: OptimizationProgress) => void,
  clock?: () => number,
): OptimizationResult {
  const t0 = clock ? clock() : 0;
  const { scenario, catalog, objective } = request;
  const company = scenario.company;
  const K = positiveInt(request.seedCount, DEFAULT_SEED_COUNT);
  const maxPlanSize = positiveInt(request.maxPlanSize, DEFAULT_MAX_PLAN_SIZE);
  const beamWidth = positiveInt(request.beamWidth, DEFAULT_BEAM_WIDTH);
  const constraints: ResolvedConstraints = {
    minCashFloor: request.constraints?.minCashFloor ?? DEFAULT_MIN_CASH_FLOOR,
    maxMissedJobRate: request.constraints?.maxMissedJobRate ?? DEFAULT_MAX_MISSED_JOB_RATE,
    maxCustomerLossFraction: request.constraints?.maxCustomerLossFraction ?? DEFAULT_MAX_CUSTOMER_LOSS_FRACTION,
    minProbabilityOfImprovement: request.constraints?.minProbabilityOfImprovement ?? DEFAULT_MIN_PROBABILITY_OF_IMPROVEMENT,
  };
  const seeds = seedsFor(scenario.seed, K);
  const screenSeeds = seeds.slice(0, Math.min(SCREEN_SEEDS, K));

  // Progress: every simulation run advances `completed` within the current phase.
  const progress: OptimizationProgress = { phase: 'baseline', completed: 0, total: K };
  const report = () => onProgress?.({ ...progress, completed: Math.min(progress.completed, progress.total) });
  const evaluator = new Evaluator(scenario, () => {
    progress.completed += 1;
    report();
  });
  const ctx: SearchContext = { company, horizonDays: scenario.horizonDays, objective, seeds, evaluator, constraints };

  // 1. Baseline.
  report();
  const base = seeds.map((s) => evaluator.baseline(s));

  // 2–3. Candidates and static feasibility.
  const defs = generateCandidates(company, catalog, baselineFacts(company, base));
  const defById = new Map<string, CandidateDef>(defs.map((d) => [d.id, d]));
  const infeasible: CandidateEvaluation[] = [];
  const simulate: CandidateDef[] = [];
  for (const d of defs) {
    const reasons = staticReasons(company, d.actions);
    if (reasons.length > 0) infeasible.push(staticallyInfeasible(ctx, singleOption(d), reasons));
    else simulate.push(d);
  }
  const routing = simulate.filter((d) => d.id.startsWith(ROUTING_PREFIX));
  const others = simulate.filter((d) => !d.id.startsWith(ROUTING_PREFIX));

  // 4. Singles: routing on all K seeds (also the routing bottleneck probe), the rest screened.
  progress.phase = 'singles';
  progress.completed = 0;
  progress.total = routing.length * K + others.length * screenSeeds.length;
  report();
  const evals = new Map<string, CandidateEvaluation>();
  for (const d of routing) evals.set(d.id, evaluateOption(ctx, singleOption(d), seeds));
  const screened = others.map((d) => evaluateOption(ctx, singleOption(d), screenSeeds));
  for (const e of screened) evals.set(e.id, e);

  if (K > screenSeeds.length) {
    const feasibleScreened = rankEvaluations(
      screened.filter((e) => e.feasible),
      objective,
    );
    const keep = new Set<string>();
    feasibleScreened.forEach((e, i) => {
      if (i < SCREEN_KEEP || objectiveDelta(e, objective) > 0) keep.add(e.id);
    });
    const cont = others.filter((d) => keep.has(d.id));
    progress.total += cont.length * (K - screenSeeds.length);
    report();
    for (const d of cont) evals.set(d.id, evaluateOption(ctx, singleOption(d), seeds));
  }

  const singles = simulate.map((d) => evals.get(d.id) as CandidateEvaluation);
  for (const e of singles) if (!e.feasible) infeasible.push(e);
  const candidates = rankEvaluations(
    singles.filter((e) => e.feasible),
    objective,
  );

  // 5. Bottlenecks (routing figure is simulated).
  const probes: RoutingProbe[] = routing.map((d) => ({
    policy: String((d.actions[0].action as { patch: { routing?: string } }).patch.routing),
    deltaNetProfit: (evals.get(d.id) as CandidateEvaluation).deltaNetProfit.mean,
  }));
  const bottlenecks = diagnoseBottlenecks(company, base, scenario.horizonDays, probes);

  // 6. Plans.
  progress.phase = 'plans';
  progress.completed = 0;
  progress.total = 0;
  report();
  const plans = beamSearch(ctx, candidates, defById, beamWidth, maxPlanSize, (done, total) => {
    progress.phase = 'plans';
    progress.total = total * K;
    progress.completed = done * K;
    report();
  });
  infeasible.push(...plans.infeasible);

  const minCash = Math.min(...base.map((r) => r.minCash));
  return {
    objective,
    seeds,
    baseline: {
      netProfit: distribution(base.map((r) => r.netProfit)),
      endingCash: distribution(base.map((r) => r.endingCash)),
      revenue: distribution(base.map((r) => r.revenue)),
      minCash,
      utilization: mean(base.map((r) => r.utilization)),
      missedJobRate: mean(base.map((r) => r.missedJobRate)),
      endCustomers: mean(base.map((r) => r.endActiveCustomers)),
    },
    bottlenecks,
    candidates,
    infeasible,
    bestPlan: plans.bestPlan,
    simulationsRun: evaluator.simulationsRun,
    elapsedMs: clock ? clock() - t0 : 0,
  };
}
