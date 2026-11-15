/** Private mutable engine state. Created by deep-copying the scenario; never exposed. */
import type {
  CashFlowStatement,
  CompanyConfig,
  CrewStats,
  EquipmentSpec,
  Id,
  IncomeStatement,
  JobTypeDef,
  JobTypeStats,
  OpsMetrics,
  DrawCache,
  Scenario,
  SimEvent,
  VehicleSpec,
} from './types';
import { hashString } from './rng';
import { initialChurnTable, initialOneOffTable, oneOffPrefix, type DrawTable } from './schedule';
import { dailyDepreciation, dailyFromMonthly, loanPayment, openingBookValue } from './finance/formulas';
import { NO_SHOCK, initConditions, type CondState, type ShockMultipliers } from './conditions';

export interface EmpS {
  id: Id;
  name: string;
  wage: number;
  skill: number;
  productivity: number;
  crewId: Id | null;
  /** tenureNow = day − hireDay. */
  hireDay: number;
  active: boolean;
  key: number;
  /** Paid hours in the current overtime week. */
  weekHours: number;
  absent: boolean;
  /** Forced absent today by an `absence` shock (set by the conditions step). */
  forcedAbsent: boolean;
}

export interface LoanS {
  balance: number;
  annualRate: number;
  payment: number;
  monthsRemaining: number;
  /** Payments happen only on first-of-month days strictly after this day. */
  startDay: number;
}

export interface AssetS {
  id: Id;
  key: number;
  purchasePrice: number;
  salvage: number;
  ageYears: number;
  acquiredDay: number;
  leased: boolean;
  leaseDaily: number;
  book: number;
  dailyDep: number;
  /** Unavailable while day < downUntil. */
  downUntil: number;
  loan: LoanS | null;
  /** Unavailable today because of an `outage` shock (set by the conditions step). */
  out: boolean;
}

export interface VehicleS {
  id: Id;
  seats: number;
  mpg: number;
  maintPerMile: number;
  a: AssetS;
  /** Spec of a vehicle acquired by an action (absent for opening assets); used only by applyActionsAtDayZero. */
  spec?: VehicleSpec;
}

export interface EquipS {
  id: Id;
  typeId: Id;
  crewId: Id | null;
  maintPerHour: number;
  a: AssetS;
  /** Equipment hours accrued today (scratch). */
  hoursToday: number;
  /** Spec of an item acquired by an action (absent for opening assets); used only by applyActionsAtDayZero. */
  spec?: EquipmentSpec;
}

export interface CrewS {
  id: Id;
  name: string;
  vehicleId: Id | null;
  active: boolean;
  stats: CrewStats;
}

export interface CustomerS {
  id: Id;
  x: number;
  y: number;
  sizeFactor: number;
  planIdx: number;
  accrual: number;
  failure: number;
  active: boolean;
  key: number;
  acquiredDay: number;
  churnedDay: number | null;
  /**
   * randPrefix(seed, ONEOFF_DEMAND, hash(customerId + ':' + jobTypeId)) per job type index, filled at
   * creation for every one-off job type (0 for recurring types, never read). Packed for the demand hot loop.
   */
  oneOffKeys: Int32Array;
  /** randPrefix(seed, CHURN, key) (lazily filled; NaN = not yet computed). */
  churnPrefix: number;
}

export interface JobTypeS {
  def: JobTypeDef;
  idx: number;
  stats: JobTypeStats;
}

export type OrderStatus = 'open' | 'completed' | 'cancelled' | 'withdrawn';

export interface OrderS {
  id: Id;
  cust: CustomerS;
  jt: JobTypeS;
  x: number;
  y: number;
  price: number;
  labor: number;
  remaining: number;
  materials: number;
  createdDay: number;
  /** createdDay + cancelAfterDays (cached for the routing hot loop). */
  cancelDay: number;
  status: OrderStatus;
  started: boolean;
  /** Zoned routing sector (scratch). */
  sector: number;
  /** Cached travel time back to the depot; −1 until computed. */
  tBack: number;
  /** Road factor tBack was computed with (a travel-time shock changes it). */
  tBackRf: number;
}

export interface InvoiceS {
  amount: number;
  bad: boolean;
}

export interface ReqS {
  fillDay: number;
  id: Id;
  name: string;
  wage: number;
  skill: number;
  productivity: number;
  crewId: Id | null;
}

export interface Balances {
  cash: number;
  ar: number;
  nfa: number;
  accruedPayroll: number;
  loanBalance: number;
  loc: number;
}

/** Per-day flows and counters, reset every day. */
export interface DayCtx {
  day: number;
  month: number;
  inc: IncomeStatement;
  cf: CashFlowStatement;
  ops: OpsMetrics;
  assetAdditions: number;
  newBorrowing: number;
  /** Book value of assets disposed of today (leaves net fixed assets, simulation-design §6). */
  disposedBook: number;
  /** Today's shock multipliers (NO_SHOCK on unshocked days). */
  m: Readonly<ShockMultipliers>;
}

/** All-ones multipliers for contexts built outside the daily loop. */
export const NO_SHOCK_CTX = NO_SHOCK;

export interface SimState {
  seed: number;
  horizon: number;
  company: CompanyConfig;
  jobTypes: JobTypeS[];
  jtById: Map<Id, JobTypeS>;
  employees: EmpS[];
  crews: CrewS[];
  vehicles: VehicleS[];
  equipment: EquipS[];
  customers: CustomerS[];
  /** Open orders in priority order (createdDay asc, id asc). */
  open: OrderS[];
  invoices: Map<number, InvoiceS[]>;
  reqs: ReqS[];
  backfillCount: Map<Id, number>;
  bal: Balances;
  events: SimEvent[];
  /** Optional cross-run draw cache (SimulationOptions.drawCache). */
  drawCache: DrawCache | null;
  /** Active customers (maintained by initState, acquisition and churnCustomer). */
  activeCustomerCount: number;
  /** Active customers per recurring plan, by job type index (maintained like activeCustomerCount). */
  activePlanCounts: number[];
  /** Number of day-0 customers: st.customers[0 … initialCustomers−1] (the list only grows). */
  initialCustomers: number;
  /** Day-0 customers' one-off draws below SCHEDULE_MAX_P, by day (schedule.ts). */
  oneOffTable: DrawTable;
  /** Day-0 customers' churn draws below CHURN_SCHEDULE_MAX_U, by day (schedule.ts). */
  churnTable: DrawTable;
  /** Shock state; null when the scenario has no shocks. */
  cond: CondState | null;
}

export function newCrewStats(id: Id, name: string): CrewStats {
  return {
    crewId: id,
    name,
    daysDeployed: 0,
    daysNotDeployed: 0,
    paidHours: 0,
    onSiteHours: 0,
    travelHours: 0,
    jobsCompleted: 0,
    revenue: 0,
    milesDriven: 0,
  };
}

function newJobTypeStats(id: Id): JobTypeStats {
  return {
    jobTypeId: id,
    jobsCompleted: 0,
    jobsCancelled: 0,
    revenue: 0,
    laborCost: 0,
    materials: 0,
    fuel: 0,
    contribution: 0,
    onSiteHours: 0,
    travelHours: 0,
  };
}

interface FinanceLike {
  purchasePrice: number;
  usefulLifeYears: number;
  salvageValue: number;
  ageYears: number;
  financing: { kind: 'owned' } | { kind: 'loan'; balance: number; annualRate: number; monthsRemaining: number } | { kind: 'lease'; monthlyPayment: number };
}

/** Asset state for an asset present at day 0. */
export function openingAsset(id: Id, f: FinanceLike): AssetS {
  const leased = f.financing.kind === 'lease';
  const a: AssetS = {
    id,
    key: hashString(id),
    purchasePrice: f.purchasePrice,
    salvage: f.salvageValue,
    ageYears: f.ageYears,
    acquiredDay: 0,
    leased,
    leaseDaily: f.financing.kind === 'lease' ? dailyFromMonthly(f.financing.monthlyPayment) : 0,
    book: leased ? 0 : openingBookValue(f.purchasePrice, f.salvageValue, f.usefulLifeYears, f.ageYears),
    dailyDep: leased ? 0 : dailyDepreciation(f.purchasePrice, f.salvageValue, f.usefulLifeYears),
    downUntil: 0,
    loan: null,
    out: false,
  };
  if (f.financing.kind === 'loan') {
    const L = f.financing;
    a.loan = {
      balance: L.balance,
      annualRate: L.annualRate,
      payment: loanPayment(L.balance, L.annualRate, L.monthsRemaining),
      monthsRemaining: L.monthsRemaining,
      startDay: -1,
    };
  }
  return a;
}

/** Per-job-type one-off draw prefixes of a customer (see CustomerS.oneOffKeys). */
export function oneOffKeysFor(seed: number, customerId: Id, jobTypes: JobTypeS[]): Int32Array {
  const out = new Int32Array(jobTypes.length);
  for (const jt of jobTypes) {
    if (jt.def.kind === 'one-off') out[jt.idx] = oneOffPrefix(seed, customerId, jt.def.id);
  }
  return out;
}

export function initState(scenario: Scenario, drawCache?: DrawCache | null): SimState {
  const company = structuredClone(scenario.company);
  const jobTypes: JobTypeS[] = company.jobTypes.map((def, idx) => ({ def, idx, stats: newJobTypeStats(def.id) }));
  const jtById = new Map(jobTypes.map((j) => [j.def.id, j]));
  const employees: EmpS[] = company.employees.map((e) => ({
    id: e.id,
    name: e.name,
    wage: e.hourlyWage,
    skill: e.skill,
    productivity: e.productivity,
    crewId: e.crewId,
    hireDay: -e.tenureDays,
    active: true,
    key: hashString(e.id),
    weekHours: 0,
    absent: false,
    forcedAbsent: false,
  }));
  const crews: CrewS[] = company.crews.map((c) => ({
    id: c.id,
    name: c.name,
    vehicleId: c.vehicleId,
    active: true,
    stats: newCrewStats(c.id, c.name),
  }));
  const vehicles: VehicleS[] = company.vehicles.map((v) => ({
    id: v.id,
    seats: v.seats,
    mpg: v.mpg,
    maintPerMile: v.maintenanceCostPerMile,
    a: openingAsset(v.id, v.asset),
  }));
  const equipment: EquipS[] = company.equipment.map((e) => ({
    id: e.id,
    typeId: e.equipmentTypeId,
    crewId: e.crewId,
    maintPerHour: e.maintenanceCostPerHour,
    a: openingAsset(e.id, e.asset),
    hoursToday: 0,
  }));
  const customers: CustomerS[] = company.customers.map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    sizeFactor: c.sizeFactor,
    planIdx: c.recurringJobTypeId === null ? -1 : (jtById.get(c.recurringJobTypeId)?.idx ?? -1),
    accrual: c.phase,
    failure: 0,
    active: true,
    key: hashString(c.id),
    acquiredDay: 0,
    churnedDay: null,
    oneOffKeys: oneOffKeysFor(scenario.seed, c.id, jobTypes),
    churnPrefix: NaN,
  }));
  let nfa = 0;
  let loanBalance = 0;
  for (const a of [...vehicles.map((v) => v.a), ...equipment.map((e) => e.a)]) {
    nfa += a.book;
    if (a.loan) loanBalance += a.loan.balance;
  }
  const customerIds = customers.map((c) => c.id);
  const activePlanCounts = new Array<number>(jobTypes.length).fill(0);
  for (const c of customers) if (c.planIdx >= 0) activePlanCounts[c.planIdx] += 1;
  const st: SimState = {
    seed: scenario.seed,
    horizon: scenario.horizonDays,
    company,
    jobTypes,
    jtById,
    employees,
    crews,
    vehicles,
    equipment,
    customers,
    open: [],
    invoices: new Map(),
    reqs: [],
    backfillCount: new Map(),
    bal: { cash: company.finance.startingCash, ar: 0, nfa, accruedPayroll: 0, loanBalance, loc: 0 },
    events: [],
    drawCache: drawCache ?? null,
    activeCustomerCount: customers.length,
    activePlanCounts,
    initialCustomers: customers.length,
    oneOffTable: initialOneOffTable(
      scenario.seed,
      customerIds,
      jobTypes.filter((j) => j.def.kind === 'one-off').map((j) => ({ idx: j.idx, id: j.def.id })),
      scenario.horizonDays,
      drawCache,
    ),
    churnTable: initialChurnTable(scenario.seed, customerIds, scenario.horizonDays, drawCache),
    cond: initConditions(scenario.shocks),
  };
  return st;
}

export function allAssets(st: SimState): AssetS[] {
  const out: AssetS[] = [];
  for (const v of st.vehicles) out.push(v.a);
  for (const e of st.equipment) out.push(e.a);
  return out;
}
