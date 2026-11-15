/**
 * Plan-timeline helpers: which lane a decision belongs to, day clamping, month ticks and date labels.
 * Pure display logic; no business numbers.
 */
import { buildCalendar } from '@/simulation';
import type { Action } from '@/simulation';
import { dayLabel, monthName } from './format';

export type LaneId = 'people' | 'fleet' | 'equipment' | 'pricing' | 'policies';

export const LANES: { id: LaneId; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'fleet', label: 'Crews and vehicles' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'pricing', label: 'Pricing and marketing' },
  { id: 'policies', label: 'Policies' },
];

export function laneOf(action: Action): LaneId {
  switch (action.type) {
    case 'hire-employee':
    case 'remove-employee':
      return 'people';
    case 'add-crew':
    case 'remove-crew':
    case 'acquire-vehicle':
      return 'fleet';
    case 'acquire-equipment':
      return 'equipment';
    case 'set-price':
    case 'set-marketing-spend':
    case 'set-job-type-offered':
    case 'drop-customers':
      return 'pricing';
    case 'set-policy':
      return 'policies';
    case 'move-employee':
    case 'set-wage':
      return 'people';
    case 'dispose-asset':
    case 'replace-asset':
      return 'equipment';
  }
}

/** Integer day inside 0..horizonDays-1. */
export function clampDay(day: number, horizonDays: number): number {
  if (!Number.isFinite(day)) return 0;
  return Math.max(0, Math.min(Math.max(0, horizonDays - 1), Math.round(day)));
}

/** "Day 30" for simulation day 29: the same 1-based numbering as the day scrubber. */
export function dayNumberLabel(day: number): string {
  return `Day ${day + 1}`;
}

/** "Day 30 · Wed 30 Jan". */
export function chipDateLabel(startMonth: number, day: number): string {
  return `${dayNumberLabel(day)} · ${dayLabel(startMonth, day)}`;
}

export interface MonthTick {
  day: number;
  label: string;
}

/** First day of every month inside the horizon, labelled with the month name. */
export function monthTicks(startMonth: number, horizonDays: number): MonthTick[] {
  const ticks: MonthTick[] = [];
  for (const d of buildCalendar(startMonth, horizonDays)) if (d.dayOfMonth === 1 || d.day === 0) ticks.push({ day: d.day, label: monthName(d.month) });
  return ticks;
}
