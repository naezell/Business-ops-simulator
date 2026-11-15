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

export interface ShockBar {
  /** Index into the store's shocks list. */
  index: number;
  /** Engine days, window [fromDay, toDay) clipped to the horizon. */
  fromDay: number;
  toDay: number;
  /** Sub-row so bars that overlap on screen never cover each other. */
  row: number;
}

/**
 * Bars for the read-only Conditions lane. Windows are clipped to the horizon; shocks that start after it are dropped.
 * `minPx` is the least width a bar occupies (so a one-day condition stays visible and keeps its row).
 */
export function shockBars(shocks: readonly { fromDay: number; toDay: number }[], horizonDays: number, pxPerDay: number, minPx = 28): { bars: ShockBar[]; rows: number } {
  const items = shocks
    .map((s, index) => ({ index, fromDay: Math.max(0, s.fromDay), toDay: Math.min(horizonDays, s.toDay) }))
    .filter((s) => s.toDay > s.fromDay)
    .sort((a, b) => a.fromDay - b.fromDay || a.index - b.index);
  const rowEnd: number[] = [];
  const bars: ShockBar[] = [];
  for (const s of items) {
    const x = s.fromDay * pxPerDay;
    let row = rowEnd.findIndex((end) => end + 2 <= x);
    if (row < 0) {
      row = rowEnd.length;
      rowEnd.push(0);
    }
    rowEnd[row] = x + Math.max(minPx, (s.toDay - s.fromDay) * pxPerDay);
    bars.push({ ...s, row });
  }
  return { bars, rows: Math.max(1, rowEnd.length) };
}
