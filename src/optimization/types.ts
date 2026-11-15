/**
 * OPTIMIZER CONTRACT — owned by the architect. See docs/optimization-engine.md.
 * No runtime code, no React/DOM imports.
 */
import type { EquipmentSpec, Id, NewHireSpec, PlannedAction, Scenario, UnservedReason, VehicleSpec } from '../simulation/types';

export type Objective = 'net-profit' | 'ending-cash';

export interface OptimizationConstraints {
  /** Lowest end-of-day cash allowed in any seed. Default 0 (i.e. never beyond the line of credit). */
  minCashFloor?: number;
  /** A plan may not raise the missed-job rate above max(this, baseline rate). Default 0.05. */
  maxMissedJobRate?: number;
  /** Minimum share of seeds in which the plan must beat the baseline to be recommended. Default 0.7. */
  minProbabilityOfImprovement?: number;
}

/**
 * What the business could buy or whom it could hire. Structurally a subset of
 * IndustryDefinition (src/business/types.ts), so an industry can be passed directly.
 */
export interface OptimizerCatalog {
  vehicleCatalog: (VehicleSpec & { id: Id })[];
  equipmentCatalog: (EquipmentSpec & { id: Id })[];
  hireTemplates: (NewHireSpec & { id: Id; title: string })[];
  standardCrew: { hireTemplateIds: Id[]; vehicleCatalogId: Id; equipmentCatalogIds: Id[] };
}

export interface OptimizationRequest {
  scenario: Scenario;
  catalog: OptimizerCatalog;
  objective: Objective;
  /** Number of paired random seeds (K). Default 5. */
  seedCount?: number;
  /** Maximum actions combined into one plan. Default 3. */
  maxPlanSize?: number;
  /** Beam width for plan search. Default 3. */
  beamWidth?: number;
  constraints?: OptimizationConstraints;
}

/** Mean and spread of a quantity across seeds. */
export interface Distribution {
  mean: number;
  min: number;
  max: number;
  /** Sample standard deviation across seeds (0 when K = 1). */
  stdDev: number;
}

export type BottleneckKind =
  | 'crew-capacity'
  | 'weak-demand'
  | 'equipment-availability'
  | 'vehicle-availability'
  | 'staffing-reliability' // absences / vacancies
  | 'skill-gap'
  | 'weather'
  | 'routing-inefficiency'
  | 'unprofitable-job-type'
  | 'cash-constraint';

export interface Bottleneck {
  kind: BottleneckKind;
  /** 0..1, comparable across kinds; bottlenecks are returned sorted by this, descending. */
  severity: number;
  /** Estimated annualized dollars at stake (lost revenue or wasted cost). An ESTIMATE from baseline diagnostics, not a promise of recoverable profit. */
  estimatedAnnualImpact: number;
  /** Deterministic template text. */
  headline: string;
  detail: string;
  /** Raw numbers behind the text, for display and tests. */
  evidence: Record<string, number>;
  relatedJobTypeId?: Id;
  relatedReason?: UnservedReason;
}

export type CandidateCategory =
  | 'staffing'
  | 'crew'
  | 'fleet'
  | 'equipment'
  | 'pricing'
  | 'scheduling'
  | 'marketing'
  | 'service-mix';

/** One P&L line's contribution to the change in net profit. Sum of all drivers = mean Δ net profit. */
export interface ProfitDriver {
  line: string; // IncomeStatement key
  /** Signed effect on net profit (cost increases are negative). */
  delta: number;
}

export interface CandidateEvaluation {
  id: Id;
  label: string;
  category: CandidateCategory;
  actions: PlannedAction[];
  feasible: boolean;
  /** Empty when feasible. Infeasible candidates are never ranked or recommended. */
  infeasibleReasons: string[];
  /** Feasible, mean objective gain > 0 and probabilityOfImprovement >= the configured minimum. */
  recommended: boolean;
  /** Seeds this candidate was evaluated on (screened-out candidates use fewer than K). */
  seedsEvaluated: number;
  /** Paired differences vs. baseline over the horizon (candidate − baseline, same seed). */
  deltaNetProfit: Distribution;
  deltaEndingCash: Distribution;
  deltaRevenue: Distribution;
  /** Share of seeds where the objective improved. */
  probabilityOfImprovement: number;
  /** Cash required on day 0 (down payments, hiring costs). */
  upfrontCash: number;
  /** Lowest end-of-day cash across all seeds under this plan. */
  minCash: number;
  /** First day cumulative Δcash turns and stays >= 0, mean-seed; null if never within the horizon or no upfront cost. */
  paybackDays: number | null;
  /** Before/after operating ratios (seed means). */
  utilization: { before: number; after: number };
  missedJobRate: { before: number; after: number };
  drivers: ProfitDriver[];
  /** Deterministic template sentences explaining cause and effect. */
  explanation: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface OptimizationResult {
  objective: Objective;
  seeds: number[];
  baseline: {
    netProfit: Distribution;
    endingCash: Distribution;
    revenue: Distribution;
    minCash: number;
    utilization: number;
    missedJobRate: number;
  };
  bottlenecks: Bottleneck[];
  /** Feasible single-action candidates, ranked by mean objective improvement, best first. Includes non-improving ones. */
  candidates: CandidateEvaluation[];
  /** Candidates rejected by constraints, with reasons. */
  infeasible: CandidateEvaluation[];
  /** Best multi-action plan found by beam search; null if nothing beats the baseline. */
  bestPlan: CandidateEvaluation | null;
  simulationsRun: number;
  elapsedMs: number;
}

export interface OptimizationProgress {
  phase: 'baseline' | 'singles' | 'plans';
  completed: number;
  total: number;
}

/** Implemented in src/optimization/optimize.ts; pure and synchronous. The UI calls it via a Web Worker (src/services). */
export type Optimize = (
  request: OptimizationRequest,
  onProgress?: (p: OptimizationProgress) => void,
) => OptimizationResult;
