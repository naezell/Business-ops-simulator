/** Public API of the optimization engine. */
export type * from './types';

export { optimize, DEFAULT_SEED_COUNT, DEFAULT_MAX_PLAN_SIZE, DEFAULT_BEAM_WIDTH } from './optimize';
export { seedsFor, distribution, confidenceLabel, shareImproved, SEED_STRIDE, Evaluator, summarizeRun } from './evaluate';
export type { RunSummary } from './evaluate';
export { generateCandidates, conflicts } from './candidates';
export type { CandidateDef, GenerationContext } from './candidates';
export { upfrontCash, staticReasons, simulatedReasons } from './constraints';
export { diagnoseBottlenecks } from './bottlenecks';
export { computeDrivers, paybackDays, fmtUsd, DRIVER_LINES } from './explain';
export { rankEvaluations, SCREEN_SEEDS, SCREEN_KEEP, POOL_SIZE } from './search';
