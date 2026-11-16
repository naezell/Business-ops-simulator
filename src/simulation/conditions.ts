/**
 * Exogenous conditions — shocks (digital-twin simulation-design §2).
 *
 * A shock describes the world, not a decision: a multiplier on one engine quantity,
 * an asset outage, forced employee absences or forced weather, each over a day window
 * [fromDay, toDay). Shocks only scale the threshold an existing draw is compared with
 * (or skip a draw entirely); they never change which draw an event uses.
 */
import type { Id, WeatherState } from './types';
import type { Shock, ShockTarget } from './types';

export const SHOCK_TARGETS: readonly ShockTarget[] = [
  'demand',
  'leads',
  'churn',
  'fuel-price',
  'materials-cost',
  'absence',
  'turnover',
  'vehicle-breakdown',
  'equipment-breakdown',
  'repair-cost',
  'maintenance-cost',
  'travel-time',
  'collection-days',
];

/** Today's multiplier per target (1 when no shock covers the day). */
export type ShockMultipliers = Record<ShockTarget, number>;

function ones(): ShockMultipliers {
  const m = {} as ShockMultipliers;
  for (const t of SHOCK_TARGETS) m[t] = 1;
  return m;
}

/** Shared all-ones multipliers for days (and runs) without multiplier shocks. Never mutated. */
export const NO_SHOCK: Readonly<ShockMultipliers> = Object.freeze(ones());

// ───────────── Pure formulas ─────────────

/** True if `day` is inside the half-open window [fromDay, toDay). */
export function inWindow(day: number, fromDay: number, toDay: number): boolean {
  return fromDay <= day && day < toDay;
}

/** M_T(day) = Π factor over multiplier shocks on `target` covering `day`; 1 if none. */
export function shockMultiplier(shocks: readonly Shock[], target: ShockTarget, day: number): number {
  let m = 1;
  for (const s of shocks) if (s.type === 'multiplier' && s.target === target && inWindow(day, s.fromDay, s.toDay)) m *= s.factor;
  return m;
}

/** A probability scaled by a shock multiplier and clamped to [0, 1]. Exactly p when M = 1. */
export function scaleProbability(p: number, m: number): number {
  if (m === 1) return p;
  const q = p * m;
  return q > 1 ? 1 : q < 0 ? 0 : q;
}

/** Collection delay of an invoice issued under a `collection-days` shock: round(delay × M). Exactly delay when M = 1. */
export function shockedCollectionDelay(delay: number, m: number): number {
  return m === 1 ? delay : Math.max(0, Math.round(delay * m));
}

// ───────────── Engine state ─────────────

/** Per-run shock state; null on SimState when the scenario has no shocks. */
export interface CondState {
  shocks: Shock[];
  multiplierShocks: boolean;
  /** Outage windows by asset id. */
  outages: Map<Id, [number, number][]>;
  /** Forced-absence windows by employee id. */
  absences: Map<Id, [number, number][]>;
}

export function initConditions(shocks: Shock[] | undefined): CondState | null {
  if (!shocks || shocks.length === 0) return null;
  const outages = new Map<Id, [number, number][]>();
  const absences = new Map<Id, [number, number][]>();
  const push = (m: Map<Id, [number, number][]>, id: Id, w: [number, number]) => {
    let l = m.get(id);
    if (!l) m.set(id, (l = []));
    l.push(w);
  };
  let multiplierShocks = false;
  for (const s of shocks) {
    if (s.type === 'multiplier') multiplierShocks = true;
    else if (s.type === 'outage') push(outages, s.assetId, [s.fromDay, s.toDay]);
    else if (s.type === 'absence') for (const id of s.employeeIds) push(absences, id, [s.fromDay, s.toDay]);
  }
  return { shocks: structuredClone(shocks), multiplierShocks, outages, absences };
}

export function coveredBy(windows: [number, number][] | undefined, day: number): boolean {
  if (!windows) return false;
  for (const [a, b] of windows) if (a <= day && day < b) return true;
  return false;
}

/** Today's multipliers (NO_SHOCK when no multiplier shock exists in the run). */
export function multipliersForDay(cond: CondState | null, day: number): Readonly<ShockMultipliers> {
  if (!cond || !cond.multiplierShocks) return NO_SHOCK;
  let m: ShockMultipliers | null = null;
  for (const s of cond.shocks) {
    if (s.type !== 'multiplier' || !inWindow(day, s.fromDay, s.toDay)) continue;
    if (!m) m = ones();
    m[s.target] *= s.factor;
  }
  return m ?? NO_SHOCK;
}

/** Weather forced by a weather shock today (last matching shock in array order wins), else null. */
export function forcedWeather(cond: CondState | null, day: number): WeatherState | null {
  if (!cond) return null;
  let w: WeatherState | null = null;
  for (const s of cond.shocks) if (s.type === 'weather' && inWindow(day, s.fromDay, s.toDay)) w = s.state;
  return w;
}

/** shock-started / shock-ended events for today, in shock order. */
export function shockEventsForDay(cond: CondState | null, day: number): { type: 'shock-started' | 'shock-ended'; shockIndex: number }[] {
  if (!cond) return [];
  const out: { type: 'shock-started' | 'shock-ended'; shockIndex: number }[] = [];
  cond.shocks.forEach((s, i) => {
    if (s.toDay === day && s.toDay > s.fromDay) out.push({ type: 'shock-ended', shockIndex: i });
  });
  cond.shocks.forEach((s, i) => {
    if (s.fromDay === day) out.push({ type: 'shock-started', shockIndex: i });
  });
  return out;
}
