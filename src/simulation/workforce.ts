/** Workforce (simulation-engine §6.5, §8): ramp, crew rate, quits, backfill, hires. */
import type { Id } from './types';
import { STREAM, hashString, rand01 } from './rng';
import type { DayCtx, EmpS, SimState } from './state';
import { scaleProbability } from './conditions';
import {
  fatigueIndex,
  fatigueWindowDays,
  learningFactor,
  marketWage,
  productivityFatigueFactor,
  quitHazard,
  trailingWeeklyHours,
} from './dynamics';

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
    fatigue: 0,
    prodMult: 1,
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
  // Annual raise first (simulation-design §3.1).
  const raise = wf.annualRaiseRate ?? 0;
  if (raise !== 0 && day > 0 && day % 365 === 0) for (const e of st.employees) if (e.active) e.wage *= 1 + raise;
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
  // Fatigue, learning and productivity for today (simulation-design §3).
  if (st.wfDyn) updateDynamics(st, day);
  // Quits.
  if (st.wfDyn) {
    dynamicQuits(st, ctx);
    return;
  }
  const h = scaleProbability(dailyHazardFromAnnual(wf.annualTurnoverRate), ctx.m.turnover);
  if (h <= 0) return;
  const n = st.employees.length;
  for (let i = 0; i < n; i++) {
    const e = st.employees[i];
    if (!e.active) continue;
    if (rand01(st.seed, STREAM.QUIT, e.key, day, 0) < h) quit(st, ctx, e);
  }
}

function quit(st: SimState, ctx: DayCtx, e: EmpS): void {
  const day = ctx.day;
  const wf = st.company.workforce;
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

/** Today's fatigue and productivity multiplier per active employee; opens today's paid-hours slot. */
function updateDynamics(st: SimState, day: number): void {
  const wf = st.company.workforce;
  const theta = wf.fatigueThresholdHours;
  const slot = day % 28;
  for (const e of st.employees) {
    if (!e.active) continue;
    let f = 0;
    if (theta !== undefined) {
      const hist = (e.hist ??= new Float64Array(28));
      const n = fatigueWindowDays(day, e.hireDay);
      let sum = 0;
      for (let k = 1; k <= n; k++) sum += hist[(day - k + 28 * 2) % 28];
      f = fatigueIndex(trailingWeeklyHours(sum, n), theta);
      hist[slot] = 0;
    }
    e.fatigue = f;
    e.prodMult = learningFactor(day - e.hireDay, wf.learningGain, wf.learningDays) * productivityFatigueFactor(f, wf.productivityFatigueLoss);
  }
}

/** Quits with per-employee hazards (simulation-design §3). Same QUIT draw per employee and day. */
function dynamicQuits(st: SimState, ctx: DayCtx): void {
  const day = ctx.day;
  const wf = st.company.workforce;
  const h0 = dailyHazardFromAnnual(wf.annualTurnoverRate);
  if (h0 <= 0) return;
  const n = st.employees.length;
  for (let i = 0; i < n; i++) {
    const e = st.employees[i];
    if (!e.active) continue;
    const h = quitHazard(
      h0,
      e.fatigue,
      wf.quitFatigueWeight,
      e.wage,
      marketWage(wf.marketWageBySkill, e.skill),
      wf.wageQuitElasticity,
      day - e.hireDay,
      wf.earlyTenureQuitBoost,
      ctx.m.turnover,
    );
    if (h > 0 && rand01(st.seed, STREAM.QUIT, e.key, day, 0) < h) quit(st, ctx, e);
  }
}
