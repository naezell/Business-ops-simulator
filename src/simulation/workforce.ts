/** Workforce (simulation-engine §6.5, §8): ramp, crew rate, quits, backfill, hires. */
import type { Id } from './types';
import { STREAM, hashString, rand01 } from './rng';
import type { DayCtx, EmpS, SimState } from './state';
import { scaleProbability } from './conditions';

/** ramp = min(1, start + (1 − start) × tenure / rampDays); 1 when rampDays ≤ 0. */
export function rampFactor(tenureDays: number, rampDays: number, rampStartProductivity: number): number {
  if (rampDays <= 0) return 1;
  return Math.min(1, rampStartProductivity + ((1 - rampStartProductivity) * tenureDays) / rampDays);
}

/** max(0.5, 1 − loss × (n − 1)). */
export function coordinationFactor(n: number, coordinationLoss: number): number {
  return Math.max(0.5, 1 - coordinationLoss * (n - 1));
}

/** Standard person-hours per crew clock hour. */
export function crewRate(
  members: { productivity: number; tenureDays: number }[],
  rampDays: number,
  rampStartProductivity: number,
  coordinationLoss: number,
): number {
  let s = 0;
  for (const m of members) s += m.productivity * rampFactor(m.tenureDays, rampDays, rampStartProductivity);
  return s * coordinationFactor(members.length, coordinationLoss);
}

/** Daily hazard from an annual probability: 1 − (1 − a)^(1/365). */
export function dailyHazardFromAnnual(annualRate: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, annualRate)), 1 / 365);
}

export interface HireInput {
  id: Id;
  name: string;
  wage: number;
  skill: number;
  productivity: number;
  crewId: Id | null;
}

/** Start an employee today: hiring cost expensed and paid, tenure 0. */
export function hireEmployee(st: SimState, ctx: DayCtx, h: HireInput): EmpS {
  const e: EmpS = {
    id: h.id,
    name: h.name,
    wage: h.wage,
    skill: h.skill,
    productivity: h.productivity,
    crewId: h.crewId,
    hireDay: ctx.day,
    active: true,
    key: hashString(h.id),
    weekHours: 0,
    absent: false,
    forcedAbsent: false,
  };
  st.employees.push(e);
  ctx.inc.hiringCosts += st.company.workforce.hiringCostPerHire;
  st.events.push({ day: ctx.day, type: 'employee-hired', employeeId: e.id, crewId: e.crewId, name: e.name });
  return e;
}

export function crewIsActive(st: SimState, crewId: Id | null): boolean {
  if (crewId === null) return true;
  return st.crews.some((c) => c.id === crewId && c.active);
}

/** Step 3 of the daily loop. */
export function workforceStep(st: SimState, ctx: DayCtx): void {
  const day = ctx.day;
  const wf = st.company.workforce;
  // Requisitions whose fill day has arrived (in creation order).
  if (st.reqs.length > 0) {
    const keep = [];
    for (const r of st.reqs) {
      if (r.fillDay > day) {
        keep.push(r);
        continue;
      }
      // A requisition for a crew removed in the meantime is dropped.
      if (!crewIsActive(st, r.crewId)) continue;
      hireEmployee(st, ctx, r);
    }
    st.reqs = keep;
  }
  // Quits.
  const h = scaleProbability(dailyHazardFromAnnual(wf.annualTurnoverRate), ctx.m.turnover);
  if (h <= 0) return;
  const n = st.employees.length;
  for (let i = 0; i < n; i++) {
    const e = st.employees[i];
    if (!e.active) continue;
    if (rand01(st.seed, STREAM.QUIT, e.key, day, 0) < h) {
      e.active = false;
      ctx.ops.quits += 1;
      st.events.push({ day, type: 'employee-quit', employeeId: e.id });
      if (st.company.policies.autoBackfill) {
        const k = (st.backfillCount.get(e.id) ?? 0) + 1;
        st.backfillCount.set(e.id, k);
        st.reqs.push({
          fillDay: day + wf.timeToFillDays,
          id: `${e.id}~${k}`,
          name: `${e.name} (backfill)`,
          wage: e.wage,
          skill: e.skill,
          productivity: e.productivity,
          crewId: e.crewId,
        });
      }
    }
  }
}
