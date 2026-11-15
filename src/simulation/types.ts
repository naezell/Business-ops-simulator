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

export interface Policies {
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

export interface MarketParams {
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

export interface WorkforceParams {
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

export interface BreakdownParams {
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

export interface FinanceParams {
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
  | { type: 'set-job-type-offered'; jobTypeId: Id; offered: boolean };

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
export interface IncomeStatement {
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
export interface CashFlowStatement {
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

export interface OpsMetrics {
  jobsCreated: number;
  jobsCompleted: number;
  jobsCancelled: number;
  jobsLate: number;
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
  stops: RouteStop[];
  /** Crew clock when back at the depot. */
  endClock: number;
  miles: number;
}

export type SimEvent =
  | { day: number; type: 'vehicle-breakdown'; vehicleId: Id; downDays: number; cost: number }
  | { day: number; type: 'equipment-breakdown'; equipmentId: Id; downDays: number; cost: number }
  | { day: number; type: 'employee-quit'; employeeId: Id }
  | { day: number; type: 'employee-hired'; employeeId: Id; crewId: Id | null }
  | { day: number; type: 'cash-shortfall'; amount: number }
  | { day: number; type: 'action-applied'; action: Action }
  | { day: number; type: 'action-rejected'; action: Action; reason: string };

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

export interface SimulationResult {
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
