/**
 * Candidate generation (optimization-engine §4). Single actions built from the
 * company and the catalog, independent of the bottleneck list.
 */
import type { CompanyConfig, Employee, Id, PlannedAction, Policies, RoutingPolicy } from '../simulation';
import { fmtUsd } from './explain';
import type { CandidateCategory, OptimizerCatalog } from './types';

export interface CandidateDef {
  id: Id;
  label: string;
  category: CandidateCategory;
  actions: PlannedAction[];
  /** Two candidates with the same key cannot be combined; `price:all` also conflicts with every `price:*`. */
  conflictKey: string;
}

/** Baseline facts the generator needs (seed means). */
export interface GenerationContext {
  /** Mean completed jobs per job type in the baseline. */
  jobsCompleted: Record<Id, number>;
  /** Mean completed + cancelled jobs per job type in the baseline. */
  demand: Record<Id, number>;
}

export const GLOBAL_PRICE_FACTORS = [0.9, 0.95, 1.05, 1.1, 1.15];
export const JOB_PRICE_FACTORS = [0.9, 1.1, 1.2];
export const OVERTIME_OPTIONS = [0, 1, 2];
export const MARKETING_FACTORS = [0, 0.5, 1.5, 2];
export const MARKETING_SCALE_FACTORS = [0.5, 1];
/** Equipment cheaper than this is bought for cash, otherwise with a loan. */
export const EQUIPMENT_CASH_LIMIT = 2000;
const ROUTINGS: RoutingPolicy[] = ['fifo', 'nearest', 'zoned'];

export function conflicts(a: CandidateDef, b: CandidateDef): boolean {
  if (a.conflictKey === b.conflictKey) return true;
  const pa = a.conflictKey.startsWith('price:');
  const pb = b.conflictKey.startsWith('price:');
  return pa && pb && (a.conflictKey === 'price:all' || b.conflictKey === 'price:all');
}

function day0(action: PlannedAction['action']): PlannedAction {
  return { day: 0, action };
}

function pct(f: number): string {
  return `${Math.round(Math.abs(f - 1) * 100)}%`;
}

/** Rounds a multiplier to 6 decimals so ids and multipliers stay stable. */
function r6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function crewMembers(company: CompanyConfig, crewId: Id): Employee[] {
  return company.employees.filter((e) => e.crewId === crewId);
}

/** Seats available to a crew: its vehicle's seats; without one, the largest unassigned vehicle it could borrow. */
export function crewSeats(company: CompanyConfig, crewId: Id): number {
  const crew = company.crews.find((c) => c.id === crewId);
  if (!crew) return 0;
  if (crew.vehicleId !== null) return company.vehicles.find((v) => v.id === crew.vehicleId)?.seats ?? 0;
  const assigned = new Set(company.crews.map((c) => c.vehicleId).filter((v): v is Id => v !== null));
  let best = 0;
  for (const v of company.vehicles) if (!assigned.has(v.id) && v.seats > best) best = v.seats;
  return best;
}

/** Lowest skill, then lowest productivity, then config order. */
function weakestMember(members: Employee[]): Employee {
  let w = members[0];
  for (const e of members) {
    if (e.skill < w.skill || (e.skill === w.skill && e.productivity < w.productivity)) w = e;
  }
  return w;
}

/** Crew with the highest-skilled member (ties: config order); null if no crew has members. */
function strongestCrew(company: CompanyConfig): Id | null {
  let best: Id | null = null;
  let bestSkill = -Infinity;
  for (const c of company.crews) {
    for (const e of crewMembers(company, c.id)) {
      if (e.skill > bestSkill) {
        bestSkill = e.skill;
        best = c.id;
      }
    }
  }
  return best;
}

export function generateCandidates(company: CompanyConfig, catalog: OptimizerCatalog, ctx: GenerationContext): CandidateDef[] {
  const out: CandidateDef[] = [];
  const crewName = (id: Id) => company.crews.find((c) => c.id === id)?.name ?? id;
  const jobName = (id: Id) => company.jobTypes.find((j) => j.id === id)?.name ?? id;

  // Staffing.
  for (const crew of company.crews) {
    const members = crewMembers(company, crew.id);
    if (members.length < crewSeats(company, crew.id)) {
      for (const t of catalog.hireTemplates) {
        out.push({
          id: `hire:${t.id}:${crew.id}`,
          label: `Hire a ${t.title.toLowerCase()} into ${crew.name}`,
          category: 'staffing',
          actions: [
            day0({ type: 'hire-employee', crewId: crew.id, hire: { name: t.name ?? t.title, hourlyWage: t.hourlyWage, skill: t.skill, productivity: t.productivity } }),
          ],
          conflictKey: `crew:${crew.id}:staff`,
        });
      }
    }
  }
  for (const crew of company.crews) {
    const members = crewMembers(company, crew.id);
    if (members.length >= 2) {
      const e = weakestMember(members);
      out.push({
        id: `remove:${e.id}`,
        label: `Let ${e.name} go from ${crew.name}`,
        category: 'staffing',
        actions: [day0({ type: 'remove-employee', employeeId: e.id })],
        conflictKey: `crew:${crew.id}:staff`,
      });
    }
  }

  // Crews.
  const std = catalog.standardCrew;
  const stdVehicle = catalog.vehicleCatalog.find((v) => v.id === std.vehicleCatalogId);
  const stdHires = std.hireTemplateIds.map((id) => catalog.hireTemplates.find((t) => t.id === id));
  const stdEquip = std.equipmentCatalogIds.map((id) => catalog.equipmentCatalog.find((e) => e.id === id));
  if (stdVehicle && stdHires.every((h) => h) && stdEquip.every((e) => e) && stdHires.length > 0) {
    for (const method of ['loan', 'lease'] as const) {
      const { id: _vid, ...vspec } = stdVehicle;
      out.push({
        id: `add-crew:${method}`,
        label: method === 'loan' ? 'Add a standard crew (truck and equipment bought with a loan)' : 'Add a standard crew (truck and equipment leased)',
        category: 'crew',
        actions: [
          day0({
            type: 'add-crew',
            name: 'New crew',
            hires: stdHires.map((t) => ({ name: t!.name ?? t!.title, hourlyWage: t!.hourlyWage, skill: t!.skill, productivity: t!.productivity })),
            vehicle: { spec: vspec, method },
            equipment: stdEquip.map((e) => {
              const { id: _eid, ...spec } = e!;
              return { spec, method };
            }),
          }),
        ],
        conflictKey: 'crew:add',
      });
    }
  }
  for (const crew of company.crews) {
    out.push({
      id: `remove-crew:${crew.id}`,
      label: `Close down ${crew.name}`,
      category: 'crew',
      actions: [day0({ type: 'remove-crew', crewId: crew.id })],
      conflictKey: `crew:${crew.id}:staff`,
    });
  }

  // Fleet.
  for (const v of catalog.vehicleCatalog) {
    const { id: _vid, ...spec } = v;
    for (const method of ['loan', 'lease'] as const) {
      out.push({
        id: `vehicle:${v.id}:${method}`,
        label: method === 'loan' ? `Buy a spare ${v.name.toLowerCase()} with a loan` : `Lease a spare ${v.name.toLowerCase()}`,
        category: 'fleet',
        actions: [day0({ type: 'acquire-vehicle', spec, method, crewId: null })],
        conflictKey: 'fleet:spare',
      });
    }
  }

  // Equipment.
  const ownedTypes = new Set(company.equipment.filter((e) => e.crewId !== null).map((e) => e.equipmentTypeId));
  const strongest = strongestCrew(company);
  for (const item of catalog.equipmentCatalog) {
    const { id: _eid, ...spec } = item;
    const method = item.purchasePrice < EQUIPMENT_CASH_LIMIT ? 'cash' : 'loan';
    const how = method === 'cash' ? 'for cash' : 'with a loan';
    out.push({
      id: `equip:${item.id}:spare`,
      label: `Buy a spare ${item.name.toLowerCase()} ${how}`,
      category: 'equipment',
      actions: [day0({ type: 'acquire-equipment', spec, method, crewId: null })],
      conflictKey: `equip:${item.equipmentTypeId}`,
    });
    if (!ownedTypes.has(item.equipmentTypeId) && strongest !== null) {
      out.push({
        id: `equip:${item.id}:${strongest}`,
        label: `Buy a ${item.name.toLowerCase()} for ${crewName(strongest)} ${how}`,
        category: 'equipment',
        actions: [day0({ type: 'acquire-equipment', spec, method, crewId: strongest })],
        conflictKey: `equip:${item.equipmentTypeId}`,
      });
    }
  }

  // Pricing.
  const g = company.pricing.globalMultiplier;
  for (const f of GLOBAL_PRICE_FACTORS) {
    out.push({
      id: `price:all:${f}`,
      label: `${f > 1 ? 'Raise' : 'Lower'} all prices by ${pct(f)}`,
      category: 'pricing',
      actions: [day0({ type: 'set-price', jobTypeId: 'all', multiplier: r6(g * f) })],
      conflictKey: 'price:all',
    });
  }
  for (const jt of company.jobTypes) {
    if (!jt.offered || !((ctx.jobsCompleted[jt.id] ?? 0) > 0)) continue;
    const cur = company.pricing.byJobType[jt.id] ?? 1;
    for (const f of JOB_PRICE_FACTORS) {
      out.push({
        id: `price:${jt.id}:${f}`,
        label: `${f > 1 ? 'Raise' : 'Lower'} ${jt.name.toLowerCase()} prices by ${pct(f)}`,
        category: 'pricing',
        actions: [day0({ type: 'set-price', jobTypeId: jt.id, multiplier: r6(cur * f) })],
        conflictKey: `price:${jt.id}`,
      });
    }
  }

  // Scheduling.
  const pol = company.policies;
  const policy = (field: keyof Policies, value: Policies[keyof Policies], label: string): CandidateDef => ({
    id: `policy:${field}:${value}`,
    label,
    category: 'scheduling',
    actions: [day0({ type: 'set-policy', patch: { [field]: value } as Partial<Policies> })],
    conflictKey: `policy:${field}`,
  });
  for (const r of ROUTINGS) if (r !== pol.routing) out.push(policy('routing', r, `Switch crew routing to "${r}"`));
  for (const ot of OVERTIME_OPTIONS) {
    if (ot === pol.maxOvertimeHoursPerDay) continue;
    out.push(policy('maxOvertimeHoursPerDay', ot, ot === 0 ? 'Stop daily overtime' : `Allow up to ${ot} h of overtime per day`));
  }
  if (pol.workDaysPerWeek === 5) out.push(policy('workDaysPerWeek', 6, 'Work six days a week'));
  if (pol.workDaysPerWeek === 6) out.push(policy('workDaysPerWeek', 5, 'Work five days a week'));
  for (const d of [-1, 1]) {
    const h = pol.shiftHours + d;
    if (h >= 6 && h <= 10) out.push(policy('shiftHours', h, `${d > 0 ? 'Lengthen' : 'Shorten'} shifts to ${h} h`));
  }

  // Marketing.
  const mk = company.market;
  const spends =
    mk.marketingMonthlySpend > 0
      ? MARKETING_FACTORS.map((f) => mk.marketingMonthlySpend * f)
      : mk.marketingSpendScale > 0
        ? MARKETING_SCALE_FACTORS.map((f) => mk.marketingSpendScale * f)
        : [];
  for (const s of spends) {
    const spend = Math.round(s * 100) / 100;
    out.push({
      id: `marketing:${spend}`,
      label: spend === 0 ? 'Stop paid marketing' : `Set marketing spend to ${fmtUsd(spend)} per month`,
      category: 'marketing',
      actions: [day0({ type: 'set-marketing-spend', monthlySpend: spend })],
      conflictKey: 'marketing',
    });
  }

  // Service mix.
  for (const jt of company.jobTypes) {
    if (!jt.offered || !((ctx.demand[jt.id] ?? 0) > 0)) continue;
    out.push({
      id: `offer:${jt.id}:off`,
      label: `Stop offering ${jobName(jt.id).toLowerCase()}`,
      category: 'service-mix',
      actions: [day0({ type: 'set-job-type-offered', jobTypeId: jt.id, offered: false })],
      conflictKey: `price:${jt.id}`,
    });
  }

  return out;
}
