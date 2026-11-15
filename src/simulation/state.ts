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
  Scenario,
  SimEvent,
  VehicleSpec,
} from './types';
import { hashString } from './rng';
import { dailyDepreciation, dailyFromMonthly, loanPayment, openingBookValue } from './finance/formulas';

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
  /** randPrefix(seed, ONEOFF_DEMAND, hash(customerId + ':' + jobTypeId)) per job type index (lazily filled). */
  oneOffKeys: number[];
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
  status: OrderStatus;
  started: boolean;
  /** Zoned routing sector (scratch). */
  sector: number;
  /** Cached travel time back to the depot; −1 until computed. */
  tBack: number;
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
}

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

export function initState(scenario: Scenario): SimState {
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
    oneOffKeys: [],
    churnPrefix: NaN,
  }));
  let nfa = 0;
  let loanBalance = 0;
  for (const a of [...vehicles.map((v) => v.a), ...equipment.map((e) => e.a)]) {
    nfa += a.book;
    if (a.loan) loanBalance += a.loan.balance;
  }
  return {
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
  };
}

export function allAssets(st: SimState): AssetS[] {
  const out: AssetS[] = [];
  for (const v of st.vehicles) out.push(v.a);
  for (const e of st.equipment) out.push(e.a);
  return out;
}
