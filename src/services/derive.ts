/**
 * Display-side helpers: company patching, a read-only projection of the roster after planned
 * actions, human labels for actions, and reshaping of engine output for charts and tables.
 *
 * Nothing here produces a business number the engine did not already produce; the only
 * arithmetic is sums, differences and ratios of engine fields for presentation.
 */
import { applyActionsAtDayZero, priceMultiplier } from '@/simulation';
import type {
  Action,
  AcquisitionMethod,
  AssetFinance,
  CompanyConfig,
  CrewDayLog,
  Financing,
  Id,
  IncomeStatement,
  JobTypeDef,
  PlannedAction,
  Policies,
  Pricing,
  SimEvent,
  SimulationResult,
} from '@/simulation';
import type { IndustryDefinition } from '@/business/types';
import { money, monthName, num, percent, signedRelative } from './format';

// ───────────────────────── Company patch (facts / assumptions) ─────────────────────────

/** Edits to the company itself, keyed by dot path; array segments are matched by element id. */
export type CompanyPatch = Record<string, number>;

function step(node: unknown, seg: string): unknown {
  if (Array.isArray(node)) return node.find((x) => x && typeof x === 'object' && (x as { id?: string }).id === seg);
  if (node && typeof node === 'object') return (node as Record<string, unknown>)[seg];
  return undefined;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const seg of path.split('.')) {
    cur = step(cur, seg);
    if (cur === undefined) return undefined;
  }
  return cur;
}

function setPath(obj: unknown, path: string, value: number): boolean {
  const segs = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = step(cur, segs[i]);
    if (cur === undefined || cur === null || typeof cur !== 'object') return false;
  }
  const last = segs[segs.length - 1];
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false;
  const rec = cur as Record<string, unknown>;
  if (typeof rec[last] !== 'number') return false;
  rec[last] = value;
  return true;
}

export function applyPatch(company: CompanyConfig, patch: CompanyPatch): CompanyConfig {
  const clone = structuredClone(company);
  for (const [path, value] of Object.entries(patch)) {
    if (Number.isFinite(value)) setPath(clone, path, value);
  }
  return clone;
}

// ───────────────────────── Draft action identity ─────────────────────────

/** Actions with the same key replace each other (one chip per decision). Null = always a new chip. */
export function chipKey(action: Action): string | null {
  switch (action.type) {
    case 'set-price':
      return `price:${action.jobTypeId}`;
    case 'set-policy':
      return `policy:${Object.keys(action.patch).sort().join('+')}`;
    case 'set-marketing-spend':
      return 'marketing';
    case 'set-job-type-offered':
      return `offered:${action.jobTypeId}`;
    case 'remove-employee':
      return `remove-employee:${action.employeeId}`;
    case 'remove-crew':
      return `remove-crew:${action.crewId}`;
    default:
      return null;
  }
}

// ───────────────────────── Roster projection ─────────────────────────

export type Origin = 'base' | 'adopted' | 'draft';

interface Tagged {
  origin: Origin;
  /** Index into the draft list for draft items, otherwise -1. */
  draftIndex: number;
  removed: boolean;
  /** Draft index of the action that removed this item, or -1. */
  removedByDraftIndex: number;
  removedOrigin: Origin | null;
}

export interface PEmployee extends Tagged {
  id: Id;
  name: string;
  hourlyWage: number;
  skill: number;
  productivity: number;
  crewId: Id | null;
  tenureDays: number;
}
export interface PCrew extends Tagged {
  id: Id;
  name: string;
  vehicleId: Id | null;
}
export interface PVehicle extends Tagged {
  id: Id;
  name: string;
  seats: number;
  mpg: number;
  asset: AssetFinance;
}
export interface PEquipment extends Tagged {
  id: Id;
  name: string;
  equipmentTypeId: Id;
  crewId: Id | null;
  asset: AssetFinance;
}

export interface Projection {
  employees: PEmployee[];
  crews: PCrew[];
  vehicles: PVehicle[];
  equipment: PEquipment[];
  pricing: Pricing;
  policies: Policies;
  marketingSpend: number;
  offered: Record<Id, boolean>;
}

const tag = (origin: Origin, draftIndex: number): Tagged => ({
  origin,
  draftIndex,
  removed: false,
  removedByDraftIndex: -1,
  removedOrigin: null,
});

/** Index of the action that created an item, from the engine's id scheme (`h-d{day}-{i}-{k}`, `a-d{day}-{i}-{k}`, `crew-d{day}-{i}`). */
function creatorIndex(id: Id): number {
  const m = /^(?:h|a)-d\d+-(\d+)-\d+$/.exec(id) ?? /^crew-d\d+-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/** Same list with removal actions replaced by a no-op at the same index (keeps every engine id). */
function withoutRemovals(actions: PlannedAction[]): PlannedAction[] {
  return actions.map((pa) =>
    pa.action.type === 'remove-employee' || pa.action.type === 'remove-crew' ? { day: pa.day, action: { type: 'set-policy', patch: {} } } : pa,
  );
}

/**
 * What the roster, pricing and policies look like after `adopted` then `draft` actions, for display.
 * A thin layer over the engine's `applyActionsAtDayZero` (same rules, ids and rejections); it only adds
 * origin tags and keeps removed items listed (marked removed) so the UI can show and undo removals.
 */
export function projectCompany(company: CompanyConfig, adopted: PlannedAction[], draft: PlannedAction[]): Projection {
  const all = [...adopted, ...draft];
  const full = applyActionsAtDayZero(company, all);
  // Everything that ever existed: the same actions with removals disabled.
  const kept = all.some((pa) => pa.action.type === 'remove-employee' || pa.action.type === 'remove-crew')
    ? applyActionsAtDayZero(company, withoutRemovals(all)).company
    : full.company;
  const rejected = new Set(full.rejected.map((r) => r.index));
  const baseIds = new Set<Id>([...company.employees, ...company.crews, ...company.vehicles, ...company.equipment].map((x) => x.id));

  const originOf = (id: Id): Tagged => {
    if (baseIds.has(id)) return tag('base', -1);
    const i = creatorIndex(id);
    return i >= adopted.length ? tag('draft', i - adopted.length) : tag('adopted', -1);
  };
  /** Marks `t` removed by the first applied removal action matching `hit`. */
  const markRemoved = (t: Tagged, hit: (a: Action) => boolean): void => {
    const i = all.findIndex((pa, k) => !rejected.has(k) && hit(pa.action));
    const origin: Origin = i >= adopted.length ? 'draft' : 'adopted';
    Object.assign(t, { removed: true, removedByDraftIndex: origin === 'draft' ? i - adopted.length : -1, removedOrigin: origin });
  };

  // Items created by an action the engine rejects in the real list (possible only with removals disabled) are dropped.
  const created = (id: Id) => !rejected.has(creatorIndex(id));
  const activeCrewIds = new Set(full.company.crews.map((c) => c.id));
  const crews: PCrew[] = kept.crews.filter((c) => created(c.id)).map((c) => {
    const t: PCrew = { id: c.id, name: c.name, vehicleId: c.vehicleId, ...originOf(c.id) };
    if (!activeCrewIds.has(c.id)) markRemoved(t, (a) => a.type === 'remove-crew' && a.crewId === c.id);
    const now = full.company.crews.find((x) => x.id === c.id);
    if (now) t.vehicleId = now.vehicleId;
    return t;
  });

  const activeEmployeeIds = new Set(full.company.employees.map((e) => e.id));
  const employees: PEmployee[] = kept.employees.filter((e) => created(e.id)).map((e) => {
    const t: PEmployee = {
      id: e.id,
      // The engine names an unnamed hire by its id.
      name: !baseIds.has(e.id) && e.name === e.id ? 'New hire' : e.name,
      hourlyWage: e.hourlyWage,
      skill: e.skill,
      productivity: e.productivity,
      crewId: e.crewId,
      tenureDays: e.tenureDays,
      ...originOf(e.id),
    };
    if (!activeEmployeeIds.has(e.id)) {
      markRemoved(
        t,
        (a) => (a.type === 'remove-employee' && a.employeeId === e.id) || (a.type === 'remove-crew' && a.crewId === e.crewId),
      );
    }
    return t;
  });

  const vehicles: PVehicle[] = full.company.vehicles.map((v) => ({ id: v.id, name: v.name, seats: v.seats, mpg: v.mpg, asset: v.asset, ...originOf(v.id) }));
  const equipment: PEquipment[] = full.company.equipment.map((e) => ({
    id: e.id,
    name: e.name,
    equipmentTypeId: e.equipmentTypeId,
    crewId: e.crewId,
    asset: e.asset,
    ...originOf(e.id),
  }));

  const fc = full.company;
  return {
    employees,
    crews,
    vehicles,
    equipment,
    pricing: { globalMultiplier: fc.pricing.globalMultiplier, byJobType: { ...fc.pricing.byJobType } },
    policies: { ...fc.policies },
    marketingSpend: fc.market.marketingMonthlySpend,
    offered: Object.fromEntries(fc.jobTypes.map((j) => [j.id, j.offered])),
  };
}

export function describeFinancing(f: Financing): string {
  switch (f.kind) {
    case 'owned':
      return 'Owned outright';
    case 'loan':
      return `Loan, ${money(f.balance)} left at ${percent(f.annualRate)}, ${num(f.monthsRemaining)} months`;
    case 'lease':
      return `Lease, ${money(f.monthlyPayment)}/month`;
  }
}

export const SKILL_LABEL: Record<number, string> = { 1: 'Laborer', 2: 'Experienced', 3: 'Crew lead' };
export function skillLabel(skill: number): string {
  return SKILL_LABEL[Math.round(skill)] ?? `Skill ${num(skill)}`;
}

export const METHOD_LABEL: Record<AcquisitionMethod, string> = { cash: 'Buy with cash', loan: 'Buy with a loan', lease: 'Lease' };
const METHOD_SHORT: Record<AcquisitionMethod, string> = { cash: 'cash', loan: 'loan', lease: 'lease' };

// ───────────────────────── Action labels ─────────────────────────

const POLICY_LABEL: Record<keyof Policies, string> = {
  shiftHours: 'Shift length',
  workDaysPerWeek: 'Workdays per week',
  maxOvertimeHoursPerDay: 'Max overtime per day',
  minPaidHoursPerShift: 'Minimum paid hours',
  rainoutPaidHours: 'Rainout paid hours',
  routing: 'Routing',
  autoBackfill: 'Auto-backfill vacancies',
  acceptNewCustomers: 'Accept new customers',
};
export const ROUTING_LABEL: Record<Policies['routing'], string> = {
  fifo: 'First in, first out',
  nearest: 'Nearest next stop',
  zoned: 'By zone',
};

function policyValue(key: keyof Policies, v: unknown): string {
  if (key === 'routing') return ROUTING_LABEL[v as Policies['routing']] ?? String(v);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return num(v, 2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return String(v);
}

export interface LabelContext {
  /** Projection of the baseline (adopted actions only): the "before" values. */
  base: Projection;
  /** Projection including the draft: used to resolve names of things the draft creates. */
  full: Projection;
  jobTypes: JobTypeDef[];
}

function signedPct(ratio: number): string {
  const pct = (ratio - 1) * 100;
  const s = num(Math.abs(pct), 1).replace(/\.0$/, '');
  return `${pct < 0 ? '−' : '+'}${s}%`;
}

export function describeAction(action: Action, ctx: LabelContext): string {
  const crewName = (id: Id | null) => (id === null ? 'spare' : (ctx.full.crews.find((c) => c.id === id)?.name ?? id));
  const jtName = (id: Id) => ctx.jobTypes.find((j) => j.id === id)?.name ?? id;
  switch (action.type) {
    case 'hire-employee':
      return `Hire ${(action.hire.name ?? 'crew member').toLowerCase()} → ${crewName(action.crewId)}`;
    case 'remove-employee': {
      const e = ctx.full.employees.find((x) => x.id === action.employeeId);
      return `Remove ${e ? e.name : action.employeeId}`;
    }
    case 'add-crew':
      return `Add crew “${action.name}” (${action.hires.length} people, ${action.vehicle.spec.name.toLowerCase()} by ${METHOD_SHORT[action.vehicle.method]})`;
    case 'remove-crew':
      return `Remove crew ${crewName(action.crewId)}`;
    case 'acquire-vehicle':
      return `${action.method === 'lease' ? 'Lease' : 'Buy'} ${action.spec.name.toLowerCase()} (${METHOD_SHORT[action.method]}) → ${crewName(action.crewId)}`;
    case 'acquire-equipment':
      return `${action.method === 'lease' ? 'Lease' : 'Buy'} ${action.spec.name.toLowerCase()} (${METHOD_SHORT[action.method]}) → ${crewName(action.crewId)}`;
    case 'set-price': {
      if (action.jobTypeId === 'all') {
        const before = ctx.base.pricing.globalMultiplier;
        return before > 0 ? `Prices ${signedPct(action.multiplier / before)}` : `Prices set to ${num(action.multiplier, 2)}×`;
      }
      const before = ctx.base.pricing.byJobType[action.jobTypeId] ?? 1;
      const rel = before > 0 ? signedPct(action.multiplier / before) : `${num(action.multiplier, 2)}×`;
      return `${jtName(action.jobTypeId)} price ${rel}`;
    }
    case 'set-policy': {
      return Object.entries(action.patch)
        .map(([k, v]) => {
          const key = k as keyof Policies;
          const before = ctx.base.policies[key];
          return `${POLICY_LABEL[key] ?? k}: ${policyValue(key, before)} → ${policyValue(key, v)}`;
        })
        .join(', ');
    }
    case 'set-marketing-spend':
      return `Marketing ${money(ctx.base.marketingSpend)} → ${money(action.monthlySpend)}/mo`;
    case 'set-job-type-offered':
      return action.offered ? `Offer ${jtName(action.jobTypeId)}` : `Stop offering ${jtName(action.jobTypeId)}`;
  }
}

/** Effective price per standard visit for a job type under a pricing set (engine function). */
export function effectivePrice(job: JobTypeDef, pricing: Pricing): number {
  return job.basePrice * priceMultiplier(pricing, job.id);
}

// ───────────────────────── KPIs ─────────────────────────

export interface Kpis {
  netProfit: number;
  revenue: number;
  endingCash: number;
  lowestCash: number;
  jobsCompleted: number;
  missedJobRate: number;
  utilization: number;
}

export function kpisOf(r: SimulationResult): Kpis {
  const t = r.totals;
  return {
    netProfit: t.income.netProfit,
    revenue: t.income.revenue,
    endingCash: t.balance.cash,
    lowestCash: t.minCash,
    jobsCompleted: t.ops.jobsCompleted,
    missedJobRate: t.missedJobRate,
    utilization: t.utilization,
  };
}

// ───────────────────────── Operations ─────────────────────────

export interface WeekPoint {
  week: number;
  startDay: number;
  endDay: number;
  jobsCompleted: number;
  backlogHours: number;
  backlogJobs: number;
}

export function weeklySeries(r: SimulationResult): WeekPoint[] {
  const out: WeekPoint[] = [];
  for (let start = 0; start < r.days.length; start += 7) {
    const end = Math.min(r.days.length - 1, start + 6);
    let jobs = 0;
    for (let d = start; d <= end; d++) jobs += r.days[d].ops.jobsCompleted;
    out.push({
      week: start / 7,
      startDay: start,
      endDay: end,
      jobsCompleted: jobs,
      backlogHours: r.days[end].backlogLaborHours,
      backlogJobs: r.days[end].backlogJobs,
    });
  }
  return out;
}

export type EventLane = 'breakdown' | 'quit' | 'hired' | 'shortfall';
export const EVENT_LANES: { id: EventLane; label: string }[] = [
  { id: 'breakdown', label: 'Breakdowns' },
  { id: 'quit', label: 'Quits' },
  { id: 'hired', label: 'Hires' },
  { id: 'shortfall', label: 'Cash shortfall' },
];

export interface TimelineEvent {
  day: number;
  lane: EventLane;
  text: string;
}

export function timelineEvents(r: SimulationResult, nameOf: (id: Id) => string): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const e of r.events as SimEvent[]) {
    switch (e.type) {
      case 'vehicle-breakdown':
        out.push({ day: e.day, lane: 'breakdown', text: `${nameOf(e.vehicleId)} broke down (${num(e.downDays)} days, ${money(e.cost)} repair)` });
        break;
      case 'equipment-breakdown':
        out.push({ day: e.day, lane: 'breakdown', text: `${nameOf(e.equipmentId)} broke down (${num(e.downDays)} days, ${money(e.cost)} repair)` });
        break;
      case 'employee-quit':
        out.push({ day: e.day, lane: 'quit', text: `${nameOf(e.employeeId)} quit` });
        break;
      case 'employee-hired':
        out.push({ day: e.day, lane: 'hired', text: `${nameOf(e.employeeId)} started` });
        break;
      case 'cash-shortfall':
        out.push({ day: e.day, lane: 'shortfall', text: `Cash short by ${money(e.amount)}` });
        break;
    }
  }
  return out;
}

export interface CrewDayView {
  log: CrewDayLog;
  /** Crew clock hours as logged by the engine (CrewDayLog.onSiteHours / travelHours). */
  onSiteHours: number;
  travelHours: number;
  idleHours: number;
  overtimeHours: number;
  revenue: number;
  stopsCompleted: number;
  stopsPartial: number;
}

export function crewDayView(log: CrewDayLog, shiftHours: number): CrewDayView {
  let revenue = 0;
  let done = 0;
  let partial = 0;
  for (const s of log.stops) {
    revenue += s.revenue;
    if (s.completed) done += 1;
    else partial += 1;
  }
  const total = log.endClock;
  return {
    log,
    // Engine-logged crew clock hours (stop overhead counts as travel, §7).
    onSiteHours: log.onSiteHours,
    travelHours: log.travelHours,
    idleHours: Math.max(0, shiftHours - total),
    overtimeHours: Math.max(0, total - shiftHours),
    revenue,
    stopsCompleted: done,
    stopsPartial: partial,
  };
}

export const NOT_DEPLOYED_TEXT: Record<NonNullable<CrewDayLog['notDeployedReason']>, string> = {
  vehicle: 'No working vehicle',
  understaffed: 'Too few people present',
  'no-work': 'No eligible work',
  weather: 'Rainout',
  'not-a-workday': 'Not a workday',
};

// ───────────────────────── Financials ─────────────────────────

export type IncomeLine = keyof IncomeStatement;

export interface IncomeRow {
  key: IncomeLine;
  label: string;
  /** 'cost' rows are shown as positive magnitudes that reduce profit; 'subtotal' rows are bold. */
  kind: 'revenue' | 'cost' | 'subtotal';
}

export const INCOME_ROWS: IncomeRow[] = [
  { key: 'revenue', label: 'Revenue', kind: 'revenue' },
  { key: 'directLabor', label: 'Direct labor (wages incl. overtime)', kind: 'cost' },
  { key: 'payrollBurden', label: 'Payroll burden', kind: 'cost' },
  { key: 'materials', label: 'Materials', kind: 'cost' },
  { key: 'fuel', label: 'Fuel', kind: 'cost' },
  { key: 'maintenance', label: 'Maintenance and repairs', kind: 'cost' },
  { key: 'equipmentLeases', label: 'Equipment leases', kind: 'cost' },
  { key: 'grossProfit', label: 'Gross profit', kind: 'subtotal' },
  { key: 'overhead', label: 'Overhead', kind: 'cost' },
  { key: 'marketing', label: 'Marketing', kind: 'cost' },
  { key: 'hiringCosts', label: 'Hiring costs', kind: 'cost' },
  { key: 'badDebt', label: 'Bad debt', kind: 'cost' },
  { key: 'ebitda', label: 'EBITDA', kind: 'subtotal' },
  { key: 'depreciation', label: 'Depreciation', kind: 'cost' },
  { key: 'operatingProfit', label: 'Operating profit', kind: 'subtotal' },
  { key: 'interest', label: 'Interest', kind: 'cost' },
  { key: 'netProfit', label: 'Net profit (before income tax)', kind: 'subtotal' },
];

/** Chart grouping of cost lines. Each group is a plain sum of engine income-statement fields. */
export const COST_GROUPS: { id: string; label: string; fields: IncomeLine[]; color: string }[] = [
  { id: 'labor', label: 'Labor (wages + burden)', fields: ['directLabor', 'payrollBurden'], color: '#3f6f9a' },
  { id: 'materials', label: 'Materials', fields: ['materials'], color: '#8fb0cc' },
  { id: 'vehicles', label: 'Fuel, maintenance, leases', fields: ['fuel', 'maintenance', 'equipmentLeases'], color: '#d3a95a' },
  { id: 'overhead', label: 'Overhead, marketing, hiring, bad debt', fields: ['overhead', 'marketing', 'hiringCosts', 'badDebt'], color: '#a99884' },
  { id: 'capital', label: 'Depreciation and interest', fields: ['depreciation', 'interest'], color: '#c9d0d4' },
];

export interface MonthPoint {
  key: string;
  label: string;
  income: IncomeStatement;
  [group: string]: number | string | IncomeStatement;
}

export function monthlyPoints(r: SimulationResult): MonthPoint[] {
  return r.months.map((m) => {
    const pt: MonthPoint = { key: String(m.index), label: monthName(m.month), income: m.income };
    for (const g of COST_GROUPS) pt[g.id] = g.fields.reduce((s, f) => s + m.income[f], 0);
    pt.revenue = m.income.revenue;
    pt.netProfit = m.income.netProfit;
    return pt;
  });
}

export interface CashPoint {
  day: number;
  cash: number;
  availableCash: number;
  loc: number;
  baselineCash?: number;
}

export function cashSeries(r: SimulationResult, baseline?: SimulationResult): CashPoint[] {
  return r.days.map((d, i) => ({
    day: d.day,
    cash: d.balance.cash,
    availableCash: d.balance.availableCash,
    loc: d.balance.locBalance,
    baselineCash: baseline ? baseline.days[i]?.balance.cash : undefined,
  }));
}

export function shortfallRanges(r: SimulationResult): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  r.days.forEach((d, i) => {
    if (d.cashShortfall && start < 0) start = i;
    if (!d.cashShortfall && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, r.days.length - 1]);
  return out;
}

export function payrollDays(r: SimulationResult): number[] {
  return r.days.filter((d) => d.cashFlow.payrollPaid > 0).map((d) => d.day);
}

export interface BridgeStep {
  key: string;
  label: string;
  /** Signed contribution to the change in cash. */
  value: number;
  kind: 'in' | 'out' | 'net';
}

export function cashBridge(r: SimulationResult): BridgeStep[] {
  const c = r.totals.cashFlow;
  return [
    { key: 'collections', label: 'Collections', value: c.collections, kind: 'in' },
    { key: 'payroll', label: 'Payroll', value: -c.payrollPaid, kind: 'out' },
    { key: 'operating', label: 'Operating costs', value: -c.operatingCashOut, kind: 'out' },
    { key: 'interest', label: 'Interest', value: -c.interestPaid, kind: 'out' },
    { key: 'capex', label: 'Capex', value: -c.capex, kind: 'out' },
    { key: 'principal', label: 'Loan principal', value: -c.principalPaid + c.loanProceeds, kind: 'out' },
    { key: 'loc', label: 'Line of credit (net)', value: c.locDraw - c.locRepay, kind: 'in' },
    { key: 'net', label: 'Net change in cash', value: c.netCashFlow, kind: 'net' },
  ];
}

export interface JobTypeRow {
  id: Id;
  name: string;
  jobsCompleted: number;
  jobsCancelled: number;
  revenue: number;
  laborCost: number;
  materials: number;
  fuel: number;
  contribution: number;
  margin: number;
  perOnSiteHour: number;
  onSiteHours: number;
}

export function jobTypeRows(r: SimulationResult, jobTypes: JobTypeDef[]): JobTypeRow[] {
  return jobTypes
    .map((j) => r.jobTypeStats[j.id])
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({
      id: s.jobTypeId,
      name: jobTypes.find((j) => j.id === s.jobTypeId)?.name ?? s.jobTypeId,
      jobsCompleted: s.jobsCompleted,
      jobsCancelled: s.jobsCancelled,
      revenue: s.revenue,
      laborCost: s.laborCost,
      materials: s.materials,
      fuel: s.fuel,
      contribution: s.contribution,
      margin: s.revenue > 0 ? s.contribution / s.revenue : 0,
      perOnSiteHour: s.onSiteHours > 0 ? s.contribution / s.onSiteHours : 0,
      onSiteHours: s.onSiteHours,
    }));
}

export function relativeText(a: number, b: number): string {
  return signedRelative(a, b);
}

/** Name lookup for ids that appear in logs and events. */
export function nameLookup(p: Projection, industry: IndustryDefinition, result?: SimulationResult): (id: Id) => string {
  const map = new Map<Id, string>();
  for (const e of p.employees) map.set(e.id, e.name);
  for (const v of p.vehicles) map.set(v.id, v.name);
  for (const e of p.equipment) map.set(e.id, e.name);
  for (const c of p.crews) map.set(c.id, c.name);
  for (const j of industry.jobTypes) map.set(j.id, j.name);
  if (result) for (const s of Object.values(result.crewStats)) if (!map.has(s.crewId)) map.set(s.crewId, s.name);
  return (id) => map.get(id) ?? (id.startsWith('h-') ? 'New hire' : id);
}
