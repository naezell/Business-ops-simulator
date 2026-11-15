/** Actions (simulation-engine §10). Applied at the start of their day, in array order. */
import type { Action, EquipmentSpec, Id, NewHireSpec, PlannedAction, Policies, VehicleSpec, AcquisitionMethod } from './types';
import { STREAM, rand01 } from './rng';
import { acquireAsset, disposeAsset } from './assets';
import { churnCustomer, compactOpen, priceMultiplier, priceShockProbability, withdrawCustomer } from './demand';
import { hireEmployee } from './workforce';
import { newCrewStats, type CustomerS, type DayCtx, type SimState } from './state';

function isNonNegFinite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

function activeCrew(st: SimState, id: Id) {
  return st.crews.find((c) => c.id === id && c.active);
}

function hireSpecProblem(h: NewHireSpec): string | null {
  if (!isNonNegFinite(h.hourlyWage) || !isNonNegFinite(h.skill) || !isNonNegFinite(h.productivity)) return 'invalid hire spec';
  return null;
}

function vehicleSpecProblem(s: VehicleSpec): string | null {
  for (const k of ['seats', 'mpg', 'maintenanceCostPerMile', 'purchasePrice', 'usefulLifeYears', 'salvageValue', 'leaseMonthly'] as const) {
    if (!isNonNegFinite(s[k])) return `invalid vehicle spec field ${k}`;
  }
  return null;
}

function equipmentSpecProblem(s: EquipmentSpec): string | null {
  for (const k of ['maintenanceCostPerHour', 'purchasePrice', 'usefulLifeYears', 'salvageValue', 'leaseMonthly'] as const) {
    if (!isNonNegFinite(s[k])) return `invalid equipment spec field ${k}`;
  }
  return null;
}

function policyPatchProblem(p: Partial<Policies>): string | null {
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number' && !isNonNegFinite(v)) return `invalid policy value ${k}`;
  }
  if (p.workDaysPerWeek !== undefined && (p.workDaysPerWeek > 7 || !Number.isInteger(p.workDaysPerWeek))) return 'invalid workDaysPerWeek';
  if (p.routing !== undefined && !['fifo', 'nearest', 'zoned'].includes(p.routing)) return 'invalid routing policy';
  return null;
}

function addVehicle(st: SimState, ctx: DayCtx, id: Id, spec: VehicleSpec, method: AcquisitionMethod) {
  const a = acquireAsset(st, ctx, id, spec, method);
  const v = { id, seats: spec.seats, mpg: spec.mpg, maintPerMile: spec.maintenanceCostPerMile, a, spec };
  st.vehicles.push(v);
  return v;
}

function addEquipment(st: SimState, ctx: DayCtx, id: Id, spec: EquipmentSpec, method: AcquisitionMethod, crewId: Id | null) {
  const a = acquireAsset(st, ctx, id, spec, method);
  st.equipment.push({ id, typeId: spec.equipmentTypeId, crewId, maintPerHour: spec.maintenanceCostPerHour, a, hoursToday: 0, spec });
}

function leave(st: SimState, employeeId: Id): void {
  const e = st.employees.find((x) => x.id === employeeId && x.active);
  if (e) e.active = false;
}

/** Validate and apply one action. Returns a rejection reason, or null if applied. */
export function applyAction(st: SimState, ctx: DayCtx, action: Action, actionIndex: number): string | null {
  const day = ctx.day;
  switch (action.type) {
    case 'hire-employee': {
      if (!activeCrew(st, action.crewId)) return `unknown crew ${action.crewId}`;
      const p = hireSpecProblem(action.hire);
      if (p) return p;
      const id = `h-d${day}-${actionIndex}-0`;
      hireEmployee(st, ctx, {
        id,
        name: action.hire.name ?? id,
        wage: action.hire.hourlyWage,
        skill: action.hire.skill,
        productivity: action.hire.productivity,
        crewId: action.crewId,
      });
      return null;
    }
    case 'remove-employee': {
      if (!st.employees.some((e) => e.id === action.employeeId && e.active)) return `unknown employee ${action.employeeId}`;
      leave(st, action.employeeId);
      return null;
    }
    case 'add-crew': {
      for (const h of action.hires) {
        const p = hireSpecProblem(h);
        if (p) return p;
      }
      const vp = vehicleSpecProblem(action.vehicle.spec);
      if (vp) return vp;
      for (const e of action.equipment) {
        const ep = equipmentSpecProblem(e.spec);
        if (ep) return ep;
      }
      const crewId = `crew-d${day}-${actionIndex}`;
      if (st.crews.some((c) => c.id === crewId)) return `duplicate crew id ${crewId}`;
      const vid = `a-d${day}-${actionIndex}-0`;
      addVehicle(st, ctx, vid, action.vehicle.spec, action.vehicle.method);
      st.crews.push({ id: crewId, name: action.name, vehicleId: vid, active: true, stats: newCrewStats(crewId, action.name) });
      action.equipment.forEach((e, i) => addEquipment(st, ctx, `a-d${day}-${actionIndex}-${i + 1}`, e.spec, e.method, crewId));
      action.hires.forEach((h, k) => {
        const id = `h-d${day}-${actionIndex}-${k}`;
        hireEmployee(st, ctx, { id, name: h.name ?? id, wage: h.hourlyWage, skill: h.skill, productivity: h.productivity, crewId });
      });
      return null;
    }
    case 'remove-crew': {
      const c = activeCrew(st, action.crewId);
      if (!c) return `unknown crew ${action.crewId}`;
      c.active = false;
      for (const e of st.employees) if (e.active && e.crewId === c.id) e.active = false;
      for (const it of st.equipment) if (it.crewId === c.id) it.crewId = null;
      return null;
    }
    case 'acquire-vehicle': {
      const c = action.crewId === null ? null : activeCrew(st, action.crewId);
      if (action.crewId !== null && !c) return `unknown crew ${action.crewId}`;
      const vp = vehicleSpecProblem(action.spec);
      if (vp) return vp;
      const id = `a-d${day}-${actionIndex}-0`;
      addVehicle(st, ctx, id, action.spec, action.method);
      if (c && (c.vehicleId === null || !st.vehicles.some((v) => v.id === c.vehicleId))) c.vehicleId = id;
      return null;
    }
    case 'acquire-equipment': {
      if (action.crewId !== null && !activeCrew(st, action.crewId)) return `unknown crew ${action.crewId}`;
      const ep = equipmentSpecProblem(action.spec);
      if (ep) return ep;
      addEquipment(st, ctx, `a-d${day}-${actionIndex}-0`, action.spec, action.method, action.crewId);
      return null;
    }
    case 'set-price': {
      if (!isNonNegFinite(action.multiplier)) return 'invalid multiplier';
      const pricing = st.company.pricing;
      let delta: number;
      if (action.jobTypeId === 'all') {
        const old = pricing.globalMultiplier;
        pricing.globalMultiplier = action.multiplier;
        delta = old > 0 ? action.multiplier / old - 1 : 0;
      } else {
        const jt = st.jtById.get(action.jobTypeId);
        if (!jt) return `unknown job type ${action.jobTypeId}`;
        const oldP = priceMultiplier(pricing, jt.def.id);
        pricing.byJobType[jt.def.id] = action.multiplier;
        const newP = priceMultiplier(pricing, jt.def.id);
        delta = oldP > 0 ? newP / oldP - 1 : 0;
      }
      const p = priceShockProbability(st.company.market.priceIncreaseShockChurnPerPct, delta);
      if (p > 0) {
        const planIdx = action.jobTypeId === 'all' ? -2 : (st.jtById.get(action.jobTypeId) as { idx: number }).idx;
        for (const c of st.customers) {
          if (!c.active) continue;
          if (planIdx !== -2 && c.planIdx !== planIdx) continue;
          if (rand01(st.seed, STREAM.PRICE_SHOCK, c.key, day, actionIndex) < p) churnCustomer(st, ctx, c);
        }
        compactOpen(st);
      }
      return null;
    }
    case 'set-policy': {
      const p = policyPatchProblem(action.patch);
      if (p) return p;
      Object.assign(st.company.policies, structuredClone(action.patch));
      return null;
    }
    case 'set-marketing-spend': {
      if (!isNonNegFinite(action.monthlySpend)) return 'invalid marketing spend';
      st.company.market.marketingMonthlySpend = action.monthlySpend;
      return null;
    }
    case 'set-job-type-offered': {
      const jt = st.jtById.get(action.jobTypeId);
      if (!jt) return `unknown job type ${action.jobTypeId}`;
      jt.def.offered = action.offered;
      if (!action.offered) {
        for (const o of st.open) {
          if (o.status === 'open' && o.jt === jt) {
            o.status = 'withdrawn';
            ctx.ops.jobsWithdrawn += 1;
          }
        }
        compactOpen(st);
      }
      return null;
    }
    case 'dispose-asset': {
      if (!disposeAsset(st, ctx, action.assetId)) return `unknown asset ${action.assetId}`;
      return null;
    }
    case 'replace-asset': {
      const oldV = st.vehicles.find((v) => v.id === action.assetId);
      const oldE = oldV ? undefined : st.equipment.find((e) => e.id === action.assetId);
      if (!oldV && !oldE) return `unknown asset ${action.assetId}`;
      const isVehicleSpec = 'seats' in action.spec;
      if (oldV && !isVehicleSpec) return 'a vehicle must be replaced by a vehicle';
      if (oldE && isVehicleSpec) return 'equipment must be replaced by equipment';
      const p = oldV ? vehicleSpecProblem(action.spec as VehicleSpec) : equipmentSpecProblem(action.spec as EquipmentSpec);
      if (p) return p;
      const id = `a-d${day}-${actionIndex}-0`;
      if (oldV) {
        const crews = st.crews.filter((c) => c.vehicleId === oldV.id);
        disposeAsset(st, ctx, oldV.id);
        addVehicle(st, ctx, id, action.spec as VehicleSpec, action.method);
        for (const c of crews) c.vehicleId = id;
      } else {
        const e = oldE as NonNullable<typeof oldE>;
        const crewId = e.crewId;
        disposeAsset(st, ctx, e.id);
        addEquipment(st, ctx, id, action.spec as EquipmentSpec, action.method, crewId);
      }
      return null;
    }
    case 'move-employee': {
      const e = st.employees.find((x) => x.id === action.employeeId && x.active);
      if (!e) return `unknown employee ${action.employeeId}`;
      if (action.crewId !== null && !activeCrew(st, action.crewId)) return `unknown crew ${action.crewId}`;
      e.crewId = action.crewId;
      return null;
    }
    case 'set-wage': {
      if (!isNonNegFinite(action.multiplier)) return 'invalid multiplier';
      if (action.employeeId === 'all') {
        for (const e of st.employees) if (e.active) e.wage *= action.multiplier;
        return null;
      }
      const e = st.employees.find((x) => x.id === action.employeeId && x.active);
      if (!e) return `unknown employee ${action.employeeId}`;
      e.wage *= action.multiplier;
      return null;
    }
    case 'drop-customers': {
      const byId = new Map(st.customers.map((c) => [c.id, c]));
      for (const id of action.customerIds) if (!byId.has(id)) return `unknown customer ${id}`;
      for (const id of action.customerIds) withdrawCustomer(st, ctx, byId.get(id) as CustomerS);
      compactOpen(st);
      return null;
    }
    default:
      return 'unknown action type';
  }
}

/** Step 1: apply today's planned actions in array order. */
export function applyActionsForDay(st: SimState, ctx: DayCtx, todays: { pa: PlannedAction; index: number }[]): void {
  for (const { pa, index } of todays) {
    const action = structuredClone(pa.action);
    const reason = applyAction(st, ctx, action, index);
    if (reason === null) st.events.push({ day: ctx.day, type: 'action-applied', action });
    else st.events.push({ day: ctx.day, type: 'action-rejected', action, reason });
  }
}
