/** Public API of the optimization engine. */
export type * from './types';

export { optimize, DEFAULT_SEED_COUNT, DEFAULT_MAX_PLAN_SIZE, DEFAULT_BEAM_WIDTH } from './optimize';
export { seedsFor, distribution, confidenceLabel, shareImproved, SEED_STRIDE, Evaluator, summarizeRun } from './evaluate';
export type { RunSummary } from './evaluate';
export { generateCandidates, conflicts } from './candidates';
export type { CandidateDef, GenerationContext } from './candidates';
export { upfrontCash, staticReasons, simulatedReasons, minEndCustomers, DEFAULT_MAX_CUSTOMER_LOSS_FRACTION } from './constraints';
export type { ResolvedConstraints } from './constraints';
export { diagnoseBottlenecks, cashSeverity } from './bottlenecks';
export { computeDrivers, paybackDays, fmtUsd, DRIVER_LINES, assumptionSentence, explanationSentences, lineChangePhrase } from './explain';
export {
  rankEvaluations,
  planPool,
  beamSearch,
  evaluateOption,
  singleOption,
  isAssumptionSensitive,
  ASSUMPTION_CATEGORIES,
  SCREEN_SEEDS,
  SCREEN_KEEP,
  POOL_SIZE,
} from './search';
export type { SearchContext } from './search';
