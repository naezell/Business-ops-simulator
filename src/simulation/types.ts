/**
 * ENGINE CONTRACT — owned by the architect.
 *
 * Every other module (engine implementation, optimizer, industry configs, UI)
 * is written against these types. Additive changes are fine; renames/removals
 * or semantic changes require an ADR in docs/decisions/.
 *
 * Semantics for every field are specified in docs/simulation-engine.md and
 * docs/financial-model.md. Units: money = USD (float), time = hours unless the
 * name says Days/Months/Years, distance = miles, rates = fractions (0.1 = 10%).
 *
 * This file must stay free of runtime code and of any React/DOM import.
 */

export type Id = string;

/** Twelve values indexed by calendar month, 0 = January. */
export type Monthly = number[];

// ───────────────────────── Provenance ─────────────────────────

/** Where a number comes from. The UI must surface this; see docs/data-model.md. */
export type Provenance =
  | 'verified-calculation' // output of the deterministic engine
  | 'user-provided' // entered or edited by the user
  | 'industry-assumption' // illustrative default; NOT a verified benchmark
  | 'synthetic-demo'; // fabricated sample-company data

export interface ParamMeta {
  /** Dot path into CompanyConfig, e.g. "workforce.absenceRate". */
  path: string;
  label: string;
  description: string;
  unit: 'usd' | 'usd/hour' | 'usd/month' | 'hours' | 'days' | 'miles' | 'mph' | 'fraction' | 'multiplier' | 'count' | 'elasticity' | 'usd/gallon';
  min: number;
  max: number;
  step: number;
  provenance: Provenance;
}

// ───────────────────────── Job types ─────────────────────────

export interface JobTypeDef {
  id: Id;
  name: string;
  kind: 'recurring' | 'one-off';
  /** Person-hours on site at productivity 1.0 for a customer with sizeFactor 1.0. */
  standardLaborHours: number;
  /** Price per visit/job for sizeFactor 1.0 before price multipliers. */
  basePrice: number;
  /** Materials cost per job for sizeFactor 1.0. Does not move with price. */
  materialCost: number;
  /** Gallons of equipment fuel burned per crew on-site hour (not person-hour). */
  equipmentFuelGalPerHour: number;
  /** Equipment type ids that must all be working in the crew's kit. */
  requiredEquipmentTypes: Id[];
  /** At least one deployed crew member must have skill >= this (1..3). */
  minSkill: number;
  /** Minimum deployed crew members to perform this job. */
  minCrewSize: number;
  /** Cannot be worked during rainouts / after the partial-day cutoff. */
  weatherSensitive: boolean;
  /** May be worked across several days (partial progress carries over). */
  splittable: boolean;
  /** Demand index by month. Recurring: visit-frequency multiplier (0 = paused). One-off: arrival-rate multiplier. */
  seasonality: Monthly;
  /** Recurring only: days between visits when seasonality = 1. */
  intervalDays?: number;
  /** One-off only: expected jobs per active customer per year when seasonality = 1. */
  annualRatePerCustomer?: number;
  /** Completed more than this many days after creation counts as late. */
  lateAfterDays: number;
  /** Still pending this many days after creation: cancelled (revenue lost, service failure). */
  cancelAfterDays: number;
  /** If false the company declines this work: no orders are generated. */
  offered: boolean;
}

// ───────────────────────── Assets ─────────────────────────

export type Financing =
  | { kind: 'owned' }
  | { kind: 'loan'; balance: number; annualRate: number; monthsRemaining: number }
  | { kind: 'lease'; monthlyPayment: number };

export interface AssetFinance {
  purchasePrice: number;
  usefulLifeYears: number;
  salvageValue: number;
  /** Age at simulation day 0. Drives opening book value and breakdown hazard. */
  ageYears: number;
  financing: Financing;
}

export interface Vehicle {
  id: Id;
  name: string;
  seats: number;
  mpg: number;
  maintenanceCostPerMile: number;
  asset: AssetFinance;
}

export interface EquipmentItem {
  id: Id;
  name: string;
  equipmentTypeId: Id;
  /** Crew kit this item belongs to; null = unassigned spare. */
  crewId: Id | null;
  maintenanceCostPerHour: number;
  asset: AssetFinance;
}

// ───────────────────────── People ─────────────────────────

export interface Employee {
  id: Id;
  name: string;
  hourlyWage: number;
  /** 1 = laborer, 2 = experienced, 3 = crew lead / specialist. */
  skill: number;
  /** Work-rate multiplier at full ramp; 1.0 = standard. */
  productivity: number;
  crewId: Id | null;
  /** Days employed at simulation day 0 (>= rampDays means fully ramped). */
  tenureDays: number;
}

export interface Crew {
  id: Id;
  name: string;
  /** Normally assigned vehicle; null = none (will borrow a spare if one exists). */
  vehicleId: Id | null;
}

// ───────────────────────── Customers ─────────────────────────

export interface Customer {
  id: Id;
  name: string;
  /** Position in miles relative to the depot at (0, 0). */
  x: number;
  y: number;
  /** Scales labor hours, price and materials of every job at this property. */
  sizeFactor: number;
  /** Recurring plan this customer subscribes to, if any. */
  recurringJobTypeId: Id | null;
  /** Initial visit-accrual in [0, 1): staggers recurring visits across customers. */
  phase: number;
}

// ───────────────────────── Parameters ─────────────────────────

export type RoutingPolicy = 'fifo' | 'nearest' | 'zoned';

export interface Policies extends FloatPolicy {
  shiftHours: number;
  /** 5 = Mon–Fri, 6 = Mon–Sat, 7 = every day. */
  workDaysPerWeek: number;
  /** Crews may run this far past shiftHours to fit work. */
  maxOvertimeHoursPerDay: number;
  /** Present employees on a workday are paid at least this many hours. */
  minPaidHoursPerShift: number;
  /** Paid hours on a full rainout day when the crew did no work. */
  rainoutPaidHours: number;
  routing: RoutingPolicy;
  /** Automatically open a requisition when an employee quits. */
  autoBackfill: boolean;
  /** If false, leads are not converted. */
  acceptNewCustomers: boolean;
}

export interface MarketParams extends CustomerDynamics {
  organicLeadsPerMonth: number;
  marketingMonthlySpend: number;
  /** Asymptotic extra leads per month from marketing at infinite spend. */
  marketingMaxLeadsPerMonth: number;
  /** Spend at which marketing delivers ~63% of marketingMaxLeadsPerMonth. */
  marketingSpendScale: number;
  leadSeasonality: Monthly;
  /** Lead→customer conversion at price index 1.0. */
  baseConversionRate: number;
  /** conversion ∝ priceIndex^(−this). */
  acquisitionPriceElasticity: number;
  baseMonthlyChurn: number;
  /** churn hazard ∝ priceIndex^(this). */
  retentionPriceElasticity: number;
  /**
   * One-off job arrival rate ∝ P_j^(−this), where P_j is that job type's price multiplier.
   * Optional for backward compatibility; missing = 0 (no response). ADR-008.
   */
  oneOffPriceElasticity?: number;
  /** One-time churn probability per +1% price increase, applied when a price rises. */
  priceIncreaseShockChurnPerPct: number;
  /** churn hazard multiplier = 1 + this × serviceFailureScore. */
  serviceFailureChurnWeight: number;
  serviceFailureHalfLifeDays: number;
  newCustomer: {
    serviceRadiusMiles: number;
    sizeFactorMin: number;
    sizeFactorMax: number;
    /** Relative weights over recurring job type ids; weights need not sum to 1. */
    recurringJobTypeMix: Record<Id, number>;
  };
}

export interface WorkforceParams extends WorkforceDynamics {
  /** Employer taxes, workers' comp and benefits as a fraction of gross wages. */
  payrollBurdenRate: number;
  overtimeMultiplier: number;
  overtimeWeeklyThresholdHours: number;
  /** Probability an employee is absent on any given workday. */
  absenceRate: number;
  annualTurnoverRate: number;
  timeToFillDays: number;
  hiringCostPerHire: number;
  rampDays: number;
  rampStartProductivity: number;
  /** Each additional crew member reduces everyone's rate by this fraction. */
  crewSizeCoordinationLoss: number;
  payPeriodDays: number;
}

export interface BreakdownParams extends AssetAging {
  /** Breakdown probability per workday for a new asset. */
  dailyProb: number;
  /** Hazard multiplier = 1 + ageFactorPerYear × current age in years. */
  ageFactorPerYear: number;
  repairDaysMin: number;
  repairDaysMax: number;
  repairCostMin: number;
  repairCostMax: number;
}

export interface ReliabilityParams {
  vehicle: BreakdownParams;
  equipment: BreakdownParams;
}

export interface WeatherParams {
  rainoutProbByMonth: Monthly;
  partialProbByMonth: Monthly;
  /** Fraction of the shift during which weather-sensitive jobs may be started on a partial day. */
  partialDayFraction: number;
}

export interface OverheadItem {
  id: Id;
  name: string;
  monthlyAmount: number;
}

export interface CostParams {
  fuelPricePerGallon: number;
  avgSpeedMph: number;
  /** Road distance = straight-line distance × roadFactor. */
  roadFactor: number;
  /** Fixed non-productive time added at every stop (unload, setup, reload). */
  stopOverheadHours: number;
  overhead: OverheadItem[];
}

export interface FinanceParams extends FinanceDynamics {
  startingCash: number;
  /** Cash the owner wants to keep untouched; subtracted in availableCash. */
  minCashReserve: number;
  lineOfCredit: { limit: number; annualRate: number };
  ar: {
    collectionDaysMean: number;
    /** Collection delay is uniform in mean × [1 − jitter, 1 + jitter]. */
    collectionDaysJitter: number;
    badDebtRate: number;
  };
  /** Terms applied to financed purchases made during the simulation. */
  newLoan: { annualRate: number; termMonths: number; downPaymentFraction: number };
}

export interface Pricing {
  globalMultiplier: number;
  /** Per-job-type multiplier on top of globalMultiplier; missing = 1. */
  byJobType: Record<Id, number>;
}

// ───────────────────────── Company & scenario ─────────────────────────

export interface CompanyConfig {
  industryId: Id;
  name: string;
  /** Calendar month (0–11) of simulation day 0. Day 0 is always a Monday and the 1st of that month. */
  startMonth: number;
  jobTypes: JobTypeDef[];
  employees: Employee[];
  crews: Crew[];
  vehicles: Vehicle[];
  equipment: EquipmentItem[];
  customers: Customer[];
  pricing: Pricing;
  policies: Policies;
  market: MarketParams;
  workforce: WorkforceParams;
  reliability: ReliabilityParams;
  weather: WeatherParams;
  costs: CostParams;
  finance: FinanceParams;
}

export type AcquisitionMethod = 'cash' | 'loan' | 'lease';

export interface NewHireSpec {
  name?: string;
  hourlyWage: number;
  skill: number;
  productivity: number;
}

export interface VehicleSpec {
  name: string;
  seats: number;
  mpg: number;
  maintenanceCostPerMile: number;
  purchasePrice: number;
  usefulLifeYears: number;
  salvageValue: number;
  leaseMonthly: number;
}

export interface EquipmentSpec {
  name: string;
  equipmentTypeId: Id;
  maintenanceCostPerHour: number;
  purchasePrice: number;
  usefulLifeYears: number;
  salvageValue: number;
  leaseMonthly: number;
}

/** A decision. Actions are the ONLY way a scenario differs from its base company over time. */
export type Action =
  | { type: 'hire-employee'; crewId: Id; hire: NewHireSpec }
  | { type: 'remove-employee'; employeeId: Id }
  | {
      type: 'add-crew';
      name: string;
      hires: NewHireSpec[];
      vehicle: { spec: VehicleSpec; method: AcquisitionMethod };
      equipment: { spec: EquipmentSpec; method: AcquisitionMethod }[];
    }
  | { type: 'remove-crew'; crewId: Id }
  | { type: 'acquire-vehicle'; spec: VehicleSpec; method: AcquisitionMethod; crewId: Id | null }
  | { type: 'acquire-equipment'; spec: EquipmentSpec; method: AcquisitionMethod; crewId: Id | null }
  | { type: 'set-price'; jobTypeId: Id | 'all'; multiplier: number }
  | { type: 'set-policy'; patch: Partial<Policies> }
  | { type: 'set-marketing-spend'; monthlySpend: number }
  | { type: 'set-job-type-offered'; jobTypeId: Id; offered: boolean }
  // Digital twin (simulation-design §6), see TwinOnlyAction.
  | TwinOnlyAction;

export interface PlannedAction {
  /** Simulation day on which the action takes effect (start of day). 0 = immediately. */
  day: number;
  action: Action;
}

export interface Scenario {
  id: Id;
  name: string;
  company: CompanyConfig;
  actions: PlannedAction[];
  horizonDays: number;
  seed: number;
  /** Digital twin: programmed decision rules (simulation-design §9). Omit = none. */
  rules?: DecisionRule[];
  /** Digital twin: exogenous conditions (simulation-design §2). Omit = none. */
  shocks?: Shock[];
}

// ───────────────────────── Results ─────────────────────────

export type WeatherState = 'clear' | 'partial' | 'rainout';

/** Why demand that was pending at the end of a workday was not served. */
export type UnservedReason =
  | 'capacity' // eligible crews ran out of hours
  | 'weather'
  | 'vehicle' // no crew could deploy for lack of a working vehicle
  | 'equipment' // no deployed crew had the required working equipment
  | 'skill'
  | 'crew-size' // absences/vacancies left crews below the job's minimum size
  | 'no-crew'; // company has no crew that could ever do this

/** Income-statement flows for a period. All values >= 0 except the profit lines. */
export interface IncomeStatement extends IncomeStatementAdditions {
  revenue: number;
  directLabor: number; // gross wages incl. overtime premium
  payrollBurden: number;
  materials: number;
  fuel: number;
  maintenance: number; // routine maintenance + repairs
  equipmentLeases: number;
  grossProfit: number;
  overhead: number;
  marketing: number;
  hiringCosts: number;
  badDebt: number;
  ebitda: number;
  depreciation: number;
  operatingProfit: number;
  interest: number;
  /** Pre-tax. Income tax is out of scope (ADR-006). */
  netProfit: number;
}

/** Cash movements for a period. Sign convention: inflows and outflows are both positive magnitudes. */
export interface CashFlowStatement extends CashFlowAdditions {
  collections: number;
  payrollPaid: number; // wages + burden actually disbursed
  operatingCashOut: number; // materials, fuel, maintenance, leases, overhead, marketing, hiring
  interestPaid: number;
  capex: number; // cash paid for asset purchases (down payments / full cash price)
  loanProceeds: number; // always 0 in v1: financed purchases are non-cash (see financial-model.md)
  principalPaid: number;
  locDraw: number;
  locRepay: number;
  netCashFlow: number;
}

/** Point-in-time balances at end of day. */
export interface BalanceSheet {
  cash: number;
  /** cash − accruedPayroll − minCashReserve + undrawn line of credit. */
  availableCash: number;
  accountsReceivable: number;
  netFixedAssets: number;
  accruedPayroll: number;
  loanBalance: number;
  locBalance: number;
  /** cash + AR + netFixedAssets − accruedPayroll − loanBalance − locBalance. */
  equity: number;
}

export interface OpsMetrics extends OpsMetricsAdditions {
  jobsCreated: number;
  jobsCompleted: number;
  jobsCancelled: number;
  jobsLate: number;
  /**
   * ADDITIVE (E1): orders removed without counting as missed — the customer churned or the job
   * type was withdrawn (set-job-type-offered false). Needed for the order-conservation invariant.
   */
  jobsWithdrawn: number;
  leads: number;
  newCustomers: number;
  churnedCustomers: number;
  paidHours: number;
  onSiteHours: number; // person-hours
  travelHours: number; // person-hours incl. stop overhead
  idleHours: number; // paid − onSite − travel
  overtimeHours: number; // person-hours above the weekly threshold, booked at week end
  absentShifts: number;
  crewDaysDeployed: number;
  crewDaysNotDeployed: number; // workdays a crew could not deploy (vehicle/understaffed)
  milesDriven: number;
  /** Person-hours of standard labor left pending at end of workday, by blocking reason. */
  unservedHoursByReason: Record<UnservedReason, number>;
  /** Revenue of jobs cancelled in the period. */
  lostRevenue: number;
}

export interface DailyRecord {
  day: number;
  /** 0 = Monday. */
  dayOfWeek: number;
  month: number;
  isWorkday: boolean;
  weather: WeatherState;
  income: IncomeStatement;
  cashFlow: CashFlowStatement;
  balance: BalanceSheet;
  ops: OpsMetrics;
  /** End-of-day stocks. */
  activeCustomers: number;
  activeEmployees: number;
  backlogJobs: number;
  backlogLaborHours: number;
  /** True if cash < 0 after exhausting the line of credit. */
  cashShortfall: boolean;
}

export interface PeriodSummary {
  /** Index of the period (month number within the run, or 0 for totals). */
  index: number;
  startDay: number;
  endDay: number; // inclusive
  /** Calendar month 0–11 for monthly summaries; −1 for totals. */
  month: number;
  income: IncomeStatement;
  cashFlow: CashFlowStatement;
  /** Balance at the end of the period. */
  balance: BalanceSheet;
  ops: OpsMetrics;
  /** Lowest end-of-day cash in the period. */
  minCash: number;
  shortfallDays: number;
  /** Derived ratios; 0 when the denominator is 0. */
  utilization: number; // onSiteHours / paidHours
  travelShare: number; // travelHours / paidHours
  missedJobRate: number; // jobsCancelled / (jobsCompleted + jobsCancelled)
  revenuePerPaidHour: number;
  netMargin: number; // netProfit / revenue
  endActiveCustomers: number;
  endBacklogLaborHours: number;
}

export interface JobTypeStats {
  jobTypeId: Id;
  jobsCompleted: number;
  jobsCancelled: number;
  revenue: number;
  /** Loaded labor (wages × (1 + burden)) for on-site + inbound travel time. Excludes idle time and OT premium. */
  laborCost: number;
  materials: number;
  fuel: number;
  /** revenue − laborCost − materials − fuel. */
  contribution: number;
  onSiteHours: number;
  travelHours: number;
}

export interface CrewStats {
  crewId: Id;
  name: string;
  daysDeployed: number;
  daysNotDeployed: number;
  paidHours: number;
  onSiteHours: number;
  travelHours: number;
  jobsCompleted: number;
  revenue: number;
  milesDriven: number;
}

export interface RouteStop {
  jobId: Id;
  customerId: Id;
  jobTypeId: Id;
  x: number;
  y: number;
  /** Crew clock (hours since shift start) on arrival and departure. */
  arrive: number;
  depart: number;
  completed: boolean;
  revenue: number;
}

export interface CrewDayLog {
  crewId: Id;
  deployed: boolean;
  /** Why the crew did not deploy, if it did not. */
  notDeployedReason?: 'vehicle' | 'understaffed' | 'no-work' | 'weather' | 'not-a-workday';
  vehicleId: Id | null;
  memberIds: Id[];
  absentIds: Id[];
  /** ADDITIVE (E1): equipment items in the crew's kit today (own + borrowed). Empty if not deployed. */
  equipmentIds: Id[];
  stops: RouteStop[];
  /** Crew clock when back at the depot. */
  endClock: number;
  miles: number;
  /** ADDITIVE (O3): crew clock hours on site today (per crew, not per person). 0 if not deployed. */
  onSiteHours: number;
  /** ADDITIVE (O3): crew clock hours travelling today, including per-stop overhead and the return leg. 0 if not deployed. */
  travelHours: number;
}

export type SimEvent =
  | { day: number; type: 'vehicle-breakdown'; vehicleId: Id; downDays: number; cost: number }
  | { day: number; type: 'equipment-breakdown'; equipmentId: Id; downDays: number; cost: number }
  | { day: number; type: 'employee-quit'; employeeId: Id }
  /** `name` (ADDITIVE, O3): the hire's name, so auto-backfill hires can be displayed. */
  | { day: number; type: 'employee-hired'; employeeId: Id; crewId: Id | null; name?: string }
  | { day: number; type: 'cash-shortfall'; amount: number }
  | { day: number; type: 'action-applied'; action: Action }
  | { day: number; type: 'action-rejected'; action: Action; reason: string }
  | TwinSimEvent;

export interface CustomerSnapshot {
  id: Id;
  x: number;
  y: number;
  sizeFactor: number;
  recurringJobTypeId: Id | null;
  /** Negative-or-zero for customers present at day 0. */
  acquiredDay: number;
  churnedDay: number | null;
}

export interface SimulationResult extends SimulationResultAdditions {
  scenarioId: Id;
  seed: number;
  horizonDays: number;
  days: DailyRecord[];
  months: PeriodSummary[];
  totals: PeriodSummary;
  jobTypeStats: Record<Id, JobTypeStats>;
  crewStats: Record<Id, CrewStats>;
  events: SimEvent[];
  /** Present only when options.detail === 'full'. Indexed by day. */
  crewLogs?: CrewDayLog[][];
  /** Present only when options.detail === 'full'. Includes churned and acquired customers. */
  customers?: CustomerSnapshot[];
  /** Non-fatal configuration problems found by validation. */
  warnings: string[];
}

export interface SimulationOptions {
  /** 'summary' skips route logs and customer snapshots (used by the optimizer). Default 'full'. */
  detail?: 'summary' | 'full';
  /**
   * ADDITIVE (E2, performance only): a cache from `createDrawCache()` shared by several runs.
   * Results are bit-identical with or without it; it only avoids recomputing random draws that
   * do not depend on the scenario's decisions (e.g. one-off demand draws per seed and customer).
   */
  drawCache?: DrawCache;
}

/** Opaque cache of pre-computed random draws; create with `createDrawCache()`. */
export interface DrawCache {
  readonly kind: 'draw-cache';
}

/** Public engine entry point, implemented in src/simulation/engine.ts and re-exported from src/simulation/index.ts. */
export type RunSimulation = (scenario: Scenario, options?: SimulationOptions) => SimulationResult;

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

/** Errors make runSimulation throw; warnings are copied to SimulationResult.warnings. */
export type ValidateScenario = (scenario: Scenario) => ValidationIssue[];

// ═════════════════════════ Digital twin (merged from types-twin.ts, task E3) ═════════════════════════
// Semantics: docs/digital-twin/simulation-design.md. Every field optional / 0 when unused.

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
  then: Action[];
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
export type ScaleCustomerBase = (scenario: Scenario, m: number) => Scenario;

/** Theoretical on-site standard labor hours per week with no travel, weather, absence, breakdown or idle time. */
export type TheoreticalWeeklyCapacity = (scenario: Scenario) => number;

/** Keys of IncomeStatement that are flows (not subtotals) after wiring — used by drivers and identity tests. */
export type IncomeFlowKey = Exclude<
  keyof IncomeStatement,
  'grossProfit' | 'ebitda' | 'operatingProfit' | 'netProfit'
>;
