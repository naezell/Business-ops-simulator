/**
 * Verdict, score, caveats and the Pareto set (optimization-design §9).
 */
import type { Objective } from '../types';
import type { StrategyEvaluation } from '../study-types';
import { meanDelta } from './context';
import { NOT_VALIDATED_LONG_RUN, customerCaveat, flipCaveats, longRunCaveat, stressCaveats } from './explain';
import { ROBUST_SHARE } from './validate';

/** Sets verdict, score and caveats from the evaluation and its validation (mutates and returns `e`). */
export function applyVerdict(e: StrategyEvaluation, objective: Objective, H: number, minProbability: number): StrategyEvaluation {
  const m = meanDelta(e, objective);
  const improves = e.feasible && m > 0 && e.probabilityOfImprovement >= minProbability;
  const caveats: string[] = [];
  const cust = customerCaveat(e);
  const v = e.validation;
  let verdict: StrategyEvaluation['verdict'] = improves ? 'recommended' : 'not-recommended';
  let score = (m * 365) / H;
  if (v) {
    const lr = v.longRun;
    if (lr) {
      score = Math.min(lr.annualizedInHorizon, (lr.delta.mean * 365) / lr.horizonDays);
      const c = longRunCaveat(lr, H);
      if (c) caveats.push(c);
    } else caveats.push(NOT_VALIDATED_LONG_RUN);
    caveats.push(...stressCaveats(v.stress), ...flipCaveats(v.sensitivity));
    if (improves) {
      if (lr && lr.verdict === 'reverses') verdict = 'not-recommended';
      else if ((lr && lr.verdict === 'fades') || v.stress.robustShare < ROBUST_SHARE || v.sensitivity.flips.length > 0) verdict = 'conditional';
    }
  }
  if (cust) caveats.push(cust);
  e.verdict = verdict;
  e.score = score;
  e.caveats = caveats;
  return e;
}

/** The six trade-off axes, oriented so that larger is better. */
export function paretoAxes(e: StrategyEvaluation, objective: Objective): number[] {
  const worst = objective === 'net-profit' ? e.deltaNetProfit.min : e.deltaEndingCash.min;
  return [meanDelta(e, objective), e.score, worst, e.minCash, -e.upfrontCash, -e.operations.missedJobRate[1]];
}

export function dominates(a: number[], b: number[]): boolean {
  let strictly = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false;
    if (a[i] > b[i]) strictly = true;
  }
  return strictly;
}

/** Marks paretoOptimal on the feasible strategies (none dominates it). */
export function markPareto(list: StrategyEvaluation[], objective: Objective): void {
  const axes = list.map((e) => paretoAxes(e, objective));
  list.forEach((e, i) => {
    e.paretoOptimal = e.feasible && !list.some((o, j) => j !== i && o.feasible && dominates(axes[j], axes[i]));
  });
}

const TIER = { recommended: 0, conditional: 1, 'not-recommended': 2 } as const;

/** Verdict tier, then score descending, then lower upfront cash, then id. */
export function orderStrategies(list: StrategyEvaluation[]): StrategyEvaluation[] {
  return [...list].sort(
    (a, b) => TIER[a.verdict] - TIER[b.verdict] || b.score - a.score || a.upfrontCash - b.upfrontCash || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
