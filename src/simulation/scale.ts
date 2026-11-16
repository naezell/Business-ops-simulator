/**
 * Customer-base scaling and theoretical capacity (digital-twin simulation-design §8).
 * Pure helpers used by the capacity experiment; they never run the simulation.
 */
import type { Customer, ScaleCustomerBase, Scenario, TheoreticalWeeklyCapacity } from './types';
import { STREAM, fmix, hashString, rand01 } from './rng';
import { crewRate } from './workforce';
import { learningFactor } from './dynamics';

/**
 * r(x) = fmix32(hashString(x)) / 2³² ∈ [0, 1). The murmur3 finalizer spreads FNV-1a's high bits,
 * which barely change for short ids differing only in their last characters (ADR-018).
 */
export function hashRank(x: string): number {
  return fmix(hashString(x)) / 4294967296;
}

/** Offset ≤ 0.15 miles and phase shift of a clone, from seed-independent CLONE draws. */
export function cloneOf(c: Customer, cloneId: string): Customer {
  const key = hashString(cloneId);
  const u1 = rand01(0, STREAM.CLONE, key, 0, 0);
  const u2 = rand01(0, STREAM.CLONE, key, 0, 1);
  const u3 = rand01(0, STREAM.CLONE, key, 0, 2);
  const r = 0.15 * u1;
  const th = 2 * Math.PI * u2;
  return {
    ...c,
    id: cloneId,
    name: `${c.name} (clone ${cloneId.slice(cloneId.lastIndexOf('#') + 1)})`,
    x: c.x + r * Math.cos(th),
    y: c.y + r * Math.sin(th),
    phase: (c.phase + u3) % 1,
  };
}

/**
 * m ≤ 1: keep customer c iff r(c.id) < m. m > 1: keep all and add clone `${id}#k` for
 * k = 1 … ⌈m − 1⌉ iff k ≤ ⌊m − 1⌋ or r(`${id}#k`) < m − ⌊m⌋. Nested in m; m = 1 is the identity.
 */
export const scaleCustomerBase: ScaleCustomerBase = (scenario: Scenario, m: number): Scenario => {
  if (!(m >= 0) || !Number.isFinite(m)) throw new Error(`scaleCustomerBase: invalid multiplier ${m}`);
  const out = structuredClone(scenario);
  const src = out.company.customers;
  if (m === 1) return out;
  if (m < 1) {
    out.company.customers = src.filter((c) => hashRank(c.id) < m);
    return out;
  }
  const whole = Math.floor(m - 1);
  const top = Math.ceil(m - 1);
  const frac = m - Math.floor(m);
  const all: Customer[] = [];
  for (const c of src) {
    all.push(c);
    for (let k = 1; k <= top; k++) {
      const id = `${c.id}#${k}`;
      if (k <= whole || hashRank(id) < frac) all.push(cloneOf(c, id));
    }
  }
  out.company.customers = all;
  return out;
};

/**
 * Σ over crews with a vehicle of crewRate(day-0 members, by skill, capped at seats) × shiftHours ×
 * workDaysPerWeek, with ramp and learning at day-0 tenure and no fatigue. An upper bound.
 */
export const theoreticalWeeklyCapacity: TheoreticalWeeklyCapacity = (scenario: Scenario): number => {
  const co = scenario.company;
  const wf = co.workforce;
  const pol = co.policies;
  let total = 0;
  for (const crew of co.crews) {
    if (crew.vehicleId === null) continue;
    const v = co.vehicles.find((x) => x.id === crew.vehicleId);
    if (!v) continue;
    const members = co.employees.filter((e) => e.crewId === crew.id).sort((a, b) => b.skill - a.skill);
    const seated = members.slice(0, Math.max(0, Math.floor(v.seats)));
    if (seated.length === 0) continue;
    const rate = crewRate(
      seated.map((e) => ({ productivity: e.productivity * learningFactor(e.tenureDays, wf.learningGain, wf.learningDays), tenureDays: e.tenureDays })),
      wf.rampDays,
      wf.rampStartProductivity,
      wf.crewSizeCoordinationLoss,
    );
    total += rate * pol.shiftHours * pol.workDaysPerWeek;
  }
  return total;
};
