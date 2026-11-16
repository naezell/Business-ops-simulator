/**
 * Time-of-day playback: a visual reconstruction of recorded crew logs (IC §9).
 * Pure functions; nothing here simulates. Coordinates and times come from the logged
 * RouteStops (`x`, `y`, `arrive`, `depart` in hours since shift start).
 *
 * Semantics:
 *  - not deployed            -> 'off' at the depot
 *  - deployed, no stops      -> 'idle' at the depot
 *  - leg i runs over [previous depart (0 for the first leg), stop.arrive], straight line,
 *    linear in time. Before the leg starts the crew is at the previous place, so any slack
 *    between a depart and the next travel is spent travelling, never waiting.
 *  - 'working' at the stop from arrive up to (not including) depart
 *  - return leg runs over [last depart, endClock] to the depot ('returning')
 *  - t >= endClock           -> 'idle' at the depot
 */
import type { CrewDayLog, SimEvent } from '@/simulation';

export type CrewPlayState = 'traveling' | 'working' | 'returning' | 'idle' | 'off';

export interface Point {
  x: number;
  y: number;
}

export interface CrewPlayback extends Point {
  state: CrewPlayState;
  /** Index into log.stops for 'working' (the stop on site) and 'traveling' (the stop heading to). */
  stopIndex?: number;
}

export const DEFAULT_SHIFT_START_HOUR = 7;
export const DEPOT: Point = { x: 0, y: 0 };

function lerp(a: Point, b: Point, f: number): Point {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function frac(t: number, t0: number, t1: number): number {
  const span = t1 - t0;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (t - t0) / span));
}

export function crewStateAt(log: CrewDayLog, t: number, depot: Point = DEPOT): CrewPlayback {
  if (!log.deployed) return { x: depot.x, y: depot.y, state: 'off' };
  if (log.stops.length === 0) return { x: depot.x, y: depot.y, state: 'idle' };

  let prev: Point = depot;
  let prevDepart = 0;
  for (let i = 0; i < log.stops.length; i++) {
    const s = log.stops[i];
    if (t < s.arrive) {
      const p = lerp(prev, s, frac(t, prevDepart, s.arrive));
      return { ...p, state: 'traveling', stopIndex: i };
    }
    if (t < s.depart) return { x: s.x, y: s.y, state: 'working', stopIndex: i };
    prev = s;
    prevDepart = s.depart;
  }
  if (t < log.endClock) {
    const p = lerp(prev, depot, frac(t, prevDepart, log.endClock));
    return { ...p, state: 'returning' };
  }
  return { x: depot.x, y: depot.y, state: 'idle' };
}

/** Latest endClock among deployed crews, or the fallback if nobody ran. Upper bound of the scrubber. */
export function dayEndClock(logs: CrewDayLog[], fallback = 0): number {
  let m = 0;
  for (const l of logs) if (l.deployed) m = Math.max(m, l.endClock, ...l.stops.map((s) => s.depart));
  return m > 0 ? m : fallback;
}

/** 'HH:MM' 24-hour display time for t hours after shift start. */
export function clockLabel(t: number, shiftStartHour = DEFAULT_SHIFT_START_HOUR): string {
  const total = Math.round(shiftStartHour * 60 + t * 60);
  const m = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export type FeedKind =
  | 'breakdown'
  | 'absence'
  | 'quit'
  | 'hire'
  | 'action'
  | 'rejected'
  | 'shortfall'
  | 'rule'
  | 'shock-start'
  | 'shock-end'
  | 'asset-disposed'
  | 'distribution'
  | 'other';

export interface FeedItem {
  kind: FeedKind;
  text: string;
  /** Signed cash effect (negative = cost) when the recorded event carries one. */
  money?: number;
}

const ACTION_LABEL: Record<string, string> = {
  'hire-employee': 'Hire employee',
  'remove-employee': 'Remove employee',
  'add-crew': 'Add crew',
  'remove-crew': 'Remove crew',
  'acquire-vehicle': 'Acquire vehicle',
  'acquire-equipment': 'Acquire equipment',
  'set-price': 'Change prices',
  'set-policy': 'Change policy',
  'set-marketing-spend': 'Change marketing spend',
  'set-job-type-offered': 'Change services offered',
};

type Loose = { day: number; type: string; [k: string]: unknown };
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const numOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Events recorded for one day as a display feed. Event types the engine may not emit yet
 * (rule-fired, shock-*, asset-disposed, owner-distribution) are matched by `type` string.
 */
export function dayFeed(
  day: number,
  events: readonly SimEvent[],
  logs: readonly CrewDayLog[],
  nameOf: (id: string) => string,
  /** Describes the shock with this index in the scenario's shocks list (shock events carry `shockIndex`). */
  shockText?: (shockIndex: number) => string | undefined,
): FeedItem[] {
  const out: FeedItem[] = [];
  for (const log of logs) {
    for (const id of log.absentIds) out.push({ kind: 'absence', text: `${nameOf(id)} absent (${nameOf(log.crewId)})` });
  }
  for (const raw of events as readonly unknown[]) {
    const e = raw as Loose;
    if (e.day !== day) continue;
    const cost = numOf(e.cost);
    const shockLabel = numOf(e.shockIndex) !== undefined ? shockText?.(e.shockIndex as number) : undefined;
    const label = str(e.name) ?? str(e.label) ?? str(e.ruleId) ?? str(e.id);
    switch (e.type) {
      case 'vehicle-breakdown':
      case 'equipment-breakdown': {
        const id = str(e.vehicleId) ?? str(e.equipmentId) ?? '';
        const down = numOf(e.downDays);
        out.push({ kind: 'breakdown', text: `${nameOf(id)} broke down${down !== undefined ? ` (${down} days down)` : ''}`, money: cost !== undefined ? -cost : undefined });
        break;
      }
      case 'employee-quit':
        out.push({ kind: 'quit', text: `${nameOf(str(e.employeeId) ?? '')} quit` });
        break;
      case 'employee-hired':
        out.push({ kind: 'hire', text: `${str(e.name) ?? nameOf(str(e.employeeId) ?? '')} started` });
        break;
      case 'cash-shortfall': {
        const a = numOf(e.amount);
        out.push({ kind: 'shortfall', text: 'Cash shortfall', money: a !== undefined ? -a : undefined });
        break;
      }
      case 'action-applied': {
        const t = str((e.action as { type?: string } | undefined)?.type) ?? '';
        out.push({ kind: 'action', text: `Decision applied: ${ACTION_LABEL[t] ?? t}` });
        break;
      }
      case 'action-rejected': {
        const t = str((e.action as { type?: string } | undefined)?.type) ?? '';
        out.push({ kind: 'rejected', text: `Decision rejected: ${ACTION_LABEL[t] ?? t}${str(e.reason) ? ` (${str(e.reason)})` : ''}` });
        break;
      }
      case 'rule-fired': {
        // `nameOf` resolves rule and entity ids it knows; unknown ids are shown as they are.
        const rule = str(e.ruleId);
        const entity = str(e.entityId);
        const ruleText = rule ? nameOf(rule) : label;
        out.push({
          kind: 'rule',
          text: `Rule fired${ruleText ? `: ${ruleText}` : ''}${entity ? ` (${nameOf(entity)})` : ''}`,
          money: numOf(e.cashEffect) ?? numOf(e.amount),
        });
        break;
      }
      case 'shock-started':
        out.push({ kind: 'shock-start', text: `Condition started${shockLabel ?? label ? `: ${shockLabel ?? label}` : ''}` });
        break;
      case 'shock-ended':
        out.push({ kind: 'shock-end', text: `Condition ended${shockLabel ?? label ? `: ${shockLabel ?? label}` : ''}` });
        break;
      case 'asset-disposed': {
        const proceeds = numOf(e.proceeds) ?? numOf(e.amount);
        out.push({ kind: 'asset-disposed', text: `${nameOf(str(e.assetId) ?? str(e.vehicleId) ?? str(e.equipmentId) ?? '')} disposed`, money: proceeds });
        break;
      }
      case 'owner-distribution': {
        const a = numOf(e.amount);
        out.push({ kind: 'distribution', text: 'Owner distribution', money: a !== undefined ? -Math.abs(a) : undefined });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
