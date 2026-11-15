/**
 * DIGITAL-TWIN ENGINE CONTRACT — owned by the architect.
 *
 * Additive extensions to `types.ts`. Semantics are normative in
 * docs/digital-twin/simulation-design.md; wiring instructions (which type each
 * block is merged into) are in docs/digital-twin/implementation-contracts.md §2.
 *
 * Golden rule for every field in this file: it is OPTIONAL, and a scenario that
 * omits it must produce a result that is bit-identical to the engine before the
 * extension existed (tested by the golden-master regression, contracts §6).
 *
 * No runtime code. No React/DOM imports.
 */
import type {
  AcquisitionMethod,
  Action,
  EquipmentSpec,
  Id,
  IncomeStatement,
  PeriodSummary,
  Scenario,
  VehicleSpec,
  WeatherState,
} from './types';

// ───────────────────────── 1. Exogenous conditions (shocks) ─────────────────────────

/** Quantities a multiplier shock can scale. Each maps to exactly one engine formula (simulation-design §2). */
export type ShockTarget =
  | 'demand' // recurring accrual rate, one-off arrival probability
  | 'leads' // daily lead rate λ
  | 'churn' // monthly churn rate c (before clamp)
  | 'fuel-price'
  | 'materials-cost'
  | 'absence' // absence probability
  | 'turnover' // daily quit hazard
  | 'vehicle-breakdown' // breakdown probability
  | 'equipment-breakdown'
  | 'repair-cost' // repair cost of breakdowns
  | 'maintenance-cost' // routine per-mile / per-hour maintenance
  | 'travel-time' // travel() result (not stop overhead)
  | 'collection-days'; // collection delay

export type Shock =
  /** target × factor on days fromDay ≤ day < toDay. Overlapping multipliers on one target multiply. */
  | { type: 'multiplier'; target: ShockTarget; factor: number; fromDay: number; toDay: number }
  /** The asset is unavailable (not a breakdown: no repair cost, no event draw consumed). */
  | { type: 'outage'; assetId: Id; fromDay: number; toDay: number }
  /** The employees are absent (unpaid) on workdays in the window. */
  | { type: 'absence'; employeeIds: Id[]; fromDay: number; toDay: number }
  /** Weather is forced to `state` in the window (the WEATHER draw is ignored, not shifted). */
  | { type: 'weather'; state: WeatherState; fromDay: number; toDay: number };

// ───────────────────────── 2. Decision rules (programmed behaviour) ─────────────────────────

/** Things a rule can observe. All are computed from state at the END of the previous day. */
export type Observable =
  | 'day' // simulation day
  | 'month' // calendar month 0–11 of the current day
  | 'cash'
  | 'available-cash'
  | 'backlog-hours' // pending standard labor hours
  | 'active-customers'
  | 'active-employees'
  | 'missed-rate-28d' // cancelled / (completed + cancelled), trailing 28 days
  | 'utilization-28d' // onSite / paid, trailing 28 days
  | 'idle-share-28d' // idle / paid, trailing 28 days
  | 'overtime-hours-28d'
  // scoped observables — require `scope`
  | 'crew-size' // active members of scope.crewId
  | 'asset-age-years'
  | 'asset-down-days-90d' // days unavailable (breakdown or outage) in trailing 90 days
  | 'asset-upkeep-365d'; // routine maintenance + repairs booked to the asset, trailing 365 days

export interface RuleCondition {
  observable: Observable;
  /** Entity for scoped observables. The literal id '$each' refers to the rule's forEach binding. */
  scope?: { assetId?: Id; crewId?: Id };
  op: '<' | '<=' | '>' | '>=' | '==' | '!=';
  value: number;
}

export interface DecisionRule {
  id: Id;
  name: string;
  /** If set, the rule is instantiated once per entity of that kind; '$each' in conditions/actions is replaced by its id. */
  forEach?: 'vehicle' | 'equipment' | 'crew';
  /** All conditions must hold (conjunction). Use several rules for a disjunction. */
  when: RuleCondition[];
  /** Applied in order on the day the rule fires, through the same code path as PlannedActions. */
  then: TwinAction[];
  /** Minimum days between firings (per forEach entity). */
  cooldownDays: number;
  /** Maximum firings per run (per forEach entity). */
  maxFirings: number;
  activeFromDay?: number;
  activeToDay?: number;
}

// ───────────────────────── 3. New actions ─────────────────────────

export type TwinOnlyAction =
  /** Sell/scrap an asset (financial-model addendum, simulation-design §6). */
  | { type: 'dispose-asset'; assetId: Id }
  /** Dispose + acquire; the new asset inherits the old one's crew assignment and role. */
  | { type: 'replace-asset'; assetId: Id; spec: VehicleSpec | EquipmentSpec; method: AcquisitionMethod }
  /** Reassign an employee (crewId null = unassigned). */
  | { type: 'move-employee'; employeeId: Id; crewId: Id | null }
  /** Multiply hourly wage; 'all' = every active employee. */
  | { type: 'set-wage'; employeeId: Id | 'all'; multiplier: number }
  /** Stop serving these customers (withdrawn, not churned: no missed-job or failure accounting). */
  | { type: 'drop-customers'; customerIds: Id[] };

/** The action union after wiring: `Action` in types.ts becomes this. */
export type TwinAction = Action | TwinOnlyAction;

// ───────────────────────── 4. Dynamics parameters ─────────────────────────

/** Merged into WorkforceParams as optional fields. Missing/0 ⇒ mechanism off. simulation-design §3. */
export interface WorkforceDynamics {
  /** Productivity gain at infinite tenure, e.g. 0.15. */
  learningGain?: number;
  /** Tenure (days) at which ~63% of learningGain is reached. */
  learningDays?: number;
  /** Trailing-28-day average weekly paid hours above which fatigue accrues. */
  fatigueThresholdHours?: number;
  /** quit hazard × (1 + this × fatigue). */
  quitFatigueWeight?: number;
  /** absence probability × (1 + this × fatigue). */
  absenceFatigueWeight?: number;
  /** productivity × max(0.7, 1 − this × fatigue). */
  productivityFatigueLoss?: number;
  /** quit hazard × (wage / marketWageBySkill[skill])^(−this). */
  wageQuitElasticity?: number;
  /** Reference wage per skill level (index = skill). Required if wageQuitElasticity > 0. */
  marketWageBySkill?: number[];
  /** quit hazard × (1 + this × exp(−tenureDays / 180)). */
  earlyTenureQuitBoost?: number;
  /** Applied to every active employee's wage on days where day mod 365 == 0 and day > 0. */
  annualRaiseRate?: number;
}

/** Merged into MarketParams as optional fields. simulation-design §4. */
export interface CustomerDynamics {
  /** Extra leads per active customer per year at perfect service. */
  referralsPerCustomerYear?: number;
  /** Addressable customers in the service area; lead rate × max(0, 1 − active / marketSize). */
  marketSize?: number;
  /** churn rate × (1 + this × exp(−tenureDays / 180)). */
  newCustomerChurnBoost?: number;
}

/** Merged into BreakdownParams as an optional field. simulation-design §5. */
export interface AssetAging {
  /** Routine maintenance rate × (1 + this × current age in years). */
  maintenanceAgeFactorPerYear?: number;
}

/** Merged into Policies as an optional field. simulation-design §7. */
export interface FloatPolicy {
  /** Present members of crews that cannot deploy (and seat-overflow members) fill free seats on deployed crews. */
  floatIdleWorkers?: boolean;
}

/** Merged into FinanceParams as optional fields. simulation-design §6. */
export interface FinanceDynamics {
  /** Sale proceeds = salvage + this × max(0, bookValue − salvage). Default 0.8 when disposal is used. */
  resaleShareOfBookValue?: number;
  /** On first-of-month days, cash above this amount is paid out to the owner. Omit = never. */
  ownerDistributionCashAbove?: number;
}

// ───────────────────────── 5. Scenario and result extensions ─────────────────────────

/** `Scenario` after wiring. */
export interface TwinScenario extends Omit<Scenario, 'actions'> {
  actions: { day: number; action: TwinAction }[];
  rules?: DecisionRule[];
  shocks?: Shock[];
}

/** Added to IncomeStatement (operating section, after depreciation). Positive = gain. Always present after wiring; 0 if unused. */
export interface IncomeStatementAdditions {
  gainOnDisposal: number;
}

/** Added to CashFlowStatement. Always present after wiring; 0 if unused. */
export interface CashFlowAdditions {
  assetSaleProceeds: number;
  ownerDistributions: number;
}

/** Added to OpsMetrics. Always present after wiring. */
export interface OpsMetricsAdditions {
  /** Person-hours scheduled: for each workday, active employees × shiftHours (before absence). */
  scheduledHours: number;
  /** Standard labor hours of work performed (order.laborHours worked off, including partial progress on split jobs). */
  completedLaborHours: number;
  /** Employees who quit in the period. */
  quits: number;
}

export interface CustomerStats {
  customerId: Id;
  jobsCompleted: number;
  jobsCancelled: number;
  revenue: number;
  /** Same definition as JobTypeStats.laborCost, per customer. */
  laborCost: number;
  materials: number;
  fuel: number;
  contribution: number;
  onSiteHours: number;
  travelHours: number;
}

export type TwinSimEvent =
  | { day: number; type: 'rule-fired'; ruleId: Id; entityId?: Id }
  | { day: number; type: 'asset-disposed'; assetId: Id; proceeds: number; bookValue: number }
  | { day: number; type: 'shock-started'; shockIndex: number }
  | { day: number; type: 'shock-ended'; shockIndex: number }
  | { day: number; type: 'owner-distribution'; amount: number };

/** Added to SimulationResult. */
export interface SimulationResultAdditions {
  /** One summary per simulated year (365-day blocks from day 0); the last may be partial. */
  years: PeriodSummary[];
  /** detail 'full' only. */
  customerStats?: Record<Id, CustomerStats>;
}

// ───────────────────────── 6. Pure helpers exported by the engine ─────────────────────────

/**
 * Deterministically scale the customer base for capacity experiments.
 * m < 1 keeps the customers whose hash rank is below m·N (nested: a smaller m is a subset of a larger m);
 * m > 1 adds clones `${id}#${k}` at a deterministic offset ≤ 0.15 miles, same size/plan, phase shifted by hash.
 * m = 1 returns the customers unchanged. simulation-design §8.
 */
export type ScaleCustomerBase = (scenario: TwinScenario, m: number) => TwinScenario;

/** Theoretical on-site standard labor hours per week with no travel, weather, absence, breakdown or idle time. */
export type TheoreticalWeeklyCapacity = (scenario: TwinScenario) => number;

/** Keys of IncomeStatement that are flows (not subtotals) after wiring — used by drivers and identity tests. */
export type IncomeFlowKey = Exclude<
  keyof (IncomeStatement & IncomeStatementAdditions),
  'grossProfit' | 'ebitda' | 'operatingProfit' | 'netProfit'
>;
