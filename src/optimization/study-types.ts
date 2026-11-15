/**
 * STUDY CONTRACT (optimizer v2, "autonomous optimization") — owned by the architect.
 * Normative semantics: docs/digital-twin/optimization-design.md.
 *
 * A Study is a staged, budgeted, resumable investigation of one scenario. It
 * supersedes `optimize()`; the old entry point stays until the UI has migrated
 * (implementation-plan O9) and its tests keep passing.
 *
 * No runtime code. No React/DOM imports.
 */
import type { Id } from '../simulation/types';
import type { DecisionRule, Shock, TwinAction, TwinScenario } from '../simulation/types-twin';
import type {
  Bottleneck,
  CandidateCategory,
  Distribution,
  Objective,
  OptimizationConstraints,
  OptimizerCatalog,
  ProfitDriver,
} from './types';

// ───────────────────────── Evaluation backend ─────────────────────────

/** Multiply (factor) or set (value) one numeric CompanyConfig field addressed by a ParamMeta-style dot path. */
export interface ParamPatch {
  path: string;
  factor?: number;
  value?: number;
}

/** A complete, self-contained description of the variation applied to the study's base scenario for one run. */
export interface Variant {
  actions?: { day: number; action: TwinAction }[];
  rules?: DecisionRule[];
  shocks?: Shock[];
  patches?: ParamPatch[];
  /** Customer-base multiplier (ScaleCustomerBase). Default 1. */
  customerScale?: number;
  /** Overrides the scenario horizon (long-run validation). */
  horizonDays?: number;
}

export interface EvalJob {
  /** Canonical key of `variant` (stable JSON); identical keys + seeds are never simulated twice. */
  key: string;
  variant: Variant;
  seed: number;
}

/** What one run returns to the study (structured-cloneable, no functions, no typed arrays shared). */
export interface RunDigest {
  key: string;
  seed: number;
  horizonDays: number;
  /** Totals for the whole run. */
  total: PeriodDigest;
  /** Per simulated year (365-day blocks), last may be partial. */
  years: PeriodDigest[];
  /** End-of-day (cash − locBalance), sampled every 7th day plus the last day. */
  cashWeekly: number[];
  minCash: number;
  shortfallDays: number;
  rejected: string[];
  jobTypes: Record<Id, { contribution: number; jobsCompleted: number; jobsCancelled: number; onSiteHours: number }>;
}

export interface PeriodDigest {
  days: number;
  /** Every IncomeStatement line (flows and subtotals), keyed by its name. */
  income: Record<string, number>;
  endingCashNet: number; // cash − locBalance at period end
  jobsCompleted: number;
  jobsCancelled: number;
  jobsLate: number;
  lostRevenue: number;
  paidHours: number;
  onSiteHours: number;
  travelHours: number;
  idleHours: number;
  overtimeHours: number;
  scheduledHours: number;
  completedLaborHours: number;
  absentShifts: number;
  crewDaysNotDeployed: number;
  unserved: Record<string, number>;
  endActiveCustomers: number;
  endActiveEmployees: number;
  quits: number;
}

/**
 * The only way the study touches the simulator. Implementations: in-process
 * (tests, Node) and a Web Worker pool (browser). Must return digests in the
 * order of `jobs`. Results must not depend on batching or worker count.
 */
export type EvaluateBatch = (jobs: EvalJob[]) => Promise<RunDigest[]>;

// ───────────────────────── Request ─────────────────────────

export interface StressCase {
  id: Id;
  label: string;
  shocks: Shock[];
  patches?: ParamPatch[];
}

export interface AssumptionProbe {
  /** ParamMeta path of an illustrative assumption. */
  path: string;
  label: string;
  /** Factors applied one at a time, e.g. [0.7, 1.3]. */
  factors: number[];
}

export interface StudyBudget {
  /**
   * Hard cap on simulation cost for the whole study, in units of one run of the
   * scenario's own horizon (a run of L days costs ceil(L / horizonDays) units). Default 1500.
   */
  maxSimulations: number;
  /** Paired seeds for ranking (K). Default 5. */
  seeds: number;
  /** Seeds used for screening. Default 2. */
  screenSeeds: number;
  /** Seeds for long-run, stress and sensitivity validation. Default 2. */
  validationSeeds: number;
  /** Strategies carried into validation. Default 8. */
  finalists: number;
}

export interface StudyRequest {
  scenario: TwinScenario;
  catalog: OptimizerCatalog;
  objective: Objective;
  constraints?: OptimizationConstraints;
  budget?: Partial<StudyBudget>;
  /** Long-run validation horizon in days. Default max(1095, 3 × scenario.horizonDays). */
  longRunDays?: number;
  /** Default: the standard stress set (optimization-design §8). */
  stressCases?: StressCase[];
  /** Default: the standard assumption probes (optimization-design §9). */
  assumptionProbes?: AssumptionProbe[];
  /** Phases to run. Default all. */
  phases?: StudyPhase[];
}

export type StudyPhase =
  | 'baseline'
  | 'loss-attribution'
  | 'capacity'
  | 'singles'
  | 'refine' // timing + price line search
  | 'interactions' // pairwise screening
  | 'plans' // beam search
  | 'validation'; // long-run, stress, sensitivity

// ───────────────────────── Results ─────────────────────────

/** Value of removing one source of loss entirely — an UPPER BOUND obtained by simulation, not an achievable gain. */
export interface LossSource {
  id: 'weather' | 'absence' | 'turnover' | 'breakdowns' | 'travel' | 'churn' | 'demand-shortfall' | 'collection-delay';
  label: string;
  /** Δ objective (relaxed − baseline) over the horizon. */
  valueIfEliminated: Distribution;
  /** Fraction of baseline revenue. */
  shareOfRevenue: number;
  /** What was changed in the relaxed run, for display. */
  relaxation: string;
}

export interface CapacityPoint {
  /** Customer-base multiplier. */
  scale: number;
  customers: number;
  /** Completed standard labor hours per week (seed mean). */
  throughputHoursPerWeek: number;
  missedJobRate: number;
  lateJobRate: number;
  utilization: number;
  netProfit: number;
}

export interface CapacityReport {
  points: CapacityPoint[];
  /** Largest scale at which the service constraint holds (interpolated between grid points by bisection). */
  effectiveScale: number;
  /** (effectiveScale − 1) × current active customers, floored; may be negative when already over capacity. */
  headroomCustomers: number;
  /** Throughput plateau at the largest scale tested. */
  saturationHoursPerWeek: number;
  /** TheoreticalWeeklyCapacity of the scenario. */
  theoreticalHoursPerWeek: number;
  /**
   * Accounting bridge from theoretical to saturation throughput, in person-hours per week,
   * measured in the saturated run: absence, non-deployment (vehicle/understaffed), weather,
   * travel, idle/fragmentation, productivity (ramp, coordination, fatigue). Sums to the gap.
   */
  lossBridge: { id: string; label: string; hoursPerWeek: number }[];
  /** Scale at which net profit peaks (may differ from effectiveScale). */
  profitMaxScale: number;
  /** Which resource binds first at saturation, by unserved-hours share. */
  bindingConstraint: string;
}

export interface StrategyMember {
  candidateId: Id;
  label: string;
  category: CandidateCategory;
  /** Day the member takes effect (0 = immediately). */
  day: number;
}

export interface LongRunCheck {
  horizonDays: number;
  /** Δ cumulative objective over the long horizon. */
  delta: Distribution;
  /** Annualized Δ inside the planning horizon vs. after it. */
  annualizedInHorizon: number;
  annualizedBeyondHorizon: number;
  /** 'holds' | 'fades' (beyond < 25% of in-horizon) | 'reverses' (long-run delta ≤ 0). */
  verdict: 'holds' | 'fades' | 'reverses';
}

export interface StressCheck {
  cases: { id: Id; label: string; delta: number; feasible: boolean }[];
  /** Share of stress cases with delta > 0 and feasible. */
  robustShare: number;
  worstCase: number;
}

export interface SensitivityCheck {
  probes: { path: string; label: string; factor: number; delta: number }[];
  /** Probes under which the strategy's Δ objective changes sign. */
  flips: { path: string; label: string; factor: number }[];
}

export interface StrategyEvaluation {
  id: Id;
  label: string;
  members: StrategyMember[];
  /** The full variation this strategy applies (so the UI can adopt it into the draft). */
  variant: Variant;
  feasible: boolean;
  infeasibleReasons: string[];
  seedsEvaluated: number;
  deltaNetProfit: Distribution;
  deltaEndingCash: Distribution;
  deltaRevenue: Distribution;
  deltaEndCustomers: Distribution;
  /** Δ missed-job rate, Δ utilization, Δ overtime hours, Δ quits (seed means; after − before). */
  operations: { missedJobRate: [number, number]; utilization: [number, number]; overtimeHours: [number, number]; quits: [number, number] };
  probabilityOfImprovement: number;
  upfrontCash: number;
  minCash: number;
  paybackDays: number | null;
  drivers: ProfitDriver[];
  explanation: string[];
  /** For pairs/plans: joint Δ minus the sum of the members' individual Δ (positive = synergy). */
  interaction?: number;
  assumptionSensitive: boolean;
  /** Present for finalists only. */
  validation?: { longRun: LongRunCheck; stress: StressCheck; sensitivity: SensitivityCheck };
  /**
   * recommended  — feasible, improves, and (if validated) holds long-run, robustShare ≥ 2/3, no sign flip;
   * conditional  — improves in the planning horizon but fails one validation check (reason in `caveats`);
   * not-recommended — does not improve, or reverses long-run.
   */
  verdict: 'recommended' | 'conditional' | 'not-recommended';
  caveats: string[];
  /** True if no other feasible strategy is at least as good on every trade-off axis and better on one. */
  paretoOptimal: boolean;
  /** min(annualized in-horizon Δ, annualized long-run Δ) when validated, else annualized in-horizon Δ. */
  score: number;
}

export interface StudyResult {
  objective: Objective;
  seeds: number[];
  horizonDays: number;
  baseline: { netProfit: Distribution; endingCash: Distribution; revenue: Distribution; minCash: number; utilization: number; missedJobRate: number; endCustomers: number };
  bottlenecks: Bottleneck[];
  lossAttribution: LossSource[];
  capacity: CapacityReport | null;
  /** Feasible strategies, best score first: recommended, then conditional, then not-recommended. */
  strategies: StrategyEvaluation[];
  infeasible: StrategyEvaluation[];
  /** Distinct feasible strategies (single actions, timed variants, pairs, plans) that were simulated. */
  feasibleStrategiesEvaluated: number;
  simulationsRun: number;
  /** Phases completed; a study stopped by budget or cancellation returns what it has. */
  phasesCompleted: StudyPhase[];
  budgetExhausted: boolean;
  elapsedMs: number;
}

export interface StudyProgress {
  phase: StudyPhase;
  completed: number;
  total: number;
  /** A partial result, emitted at the end of each phase so the UI can show findings as they arrive. */
  partial?: StudyResult;
}

export interface StudyControl {
  /** Polled between batches; returning true stops the study and returns the partial result. */
  shouldStop?: () => boolean;
  clock?: () => number;
  onProgress?: (p: StudyProgress) => void;
}

/** Implemented in src/optimization/study/runStudy.ts. Deterministic given the request (excluding elapsedMs). */
export type RunStudy = (request: StudyRequest, evaluate: EvaluateBatch, control?: StudyControl) => Promise<StudyResult>;
