/**
 * Conditions (shocks): presets, labels and plain-language descriptions.
 * Display logic only. Days in the UI are 1-based and inclusive ("Day 1 to Day 14");
 * the engine uses 0-based half-open windows [fromDay, toDay), so Day N..M is fromDay N-1, toDay M.
 */
import type { Id, Shock, ShockTarget, WeatherState } from '@/simulation';
import { dayLabel } from '@/services/format';

/** Longer than any horizon (12 months): a window that always covers "the whole horizon". */
export const WHOLE_HORIZON_END = 400;

export const TARGET_LABEL: Record<ShockTarget, string> = {
  demand: 'Demand from existing customers',
  leads: 'New customer leads',
  churn: 'Customer churn',
  'fuel-price': 'Fuel price',
  'materials-cost': 'Materials cost',
  absence: 'Employee absence',
  turnover: 'Staff turnover (quits)',
  'vehicle-breakdown': 'Vehicle breakdowns',
  'equipment-breakdown': 'Equipment breakdowns',
  'repair-cost': 'Repair cost',
  'maintenance-cost': 'Routine maintenance cost',
  'travel-time': 'Travel time and distance',
  'collection-days': 'Days to collect payment',
};

export const TARGET_ORDER = Object.keys(TARGET_LABEL) as ShockTarget[];

export const WEATHER_LABEL: Record<WeatherState, string> = {
  clear: 'clear weather',
  partial: 'partly workable weather',
  rainout: 'rainout weather (no outdoor work)',
};

export type ShockType = Shock['type'];
export const TYPE_LABEL: Record<ShockType, string> = {
  multiplier: 'Multiplier',
  outage: 'Asset out of service',
  absence: 'Employees absent',
  weather: 'Forced weather',
};

/** UI day numbers (1-based, inclusive) to the engine window. */
export function windowFromDayNumbers(firstDay: number, lastDay: number): { fromDay: number; toDay: number } {
  return { fromDay: firstDay - 1, toDay: lastDay };
}

/** Engine window to UI day numbers; the last day is clipped to the horizon. */
export function dayNumbersOf(shock: Pick<Shock, 'fromDay' | 'toDay'>, horizonDays: number): { first: number; last: number } {
  return { first: shock.fromDay + 1, last: Math.min(shock.toDay, horizonDays) };
}

/** "+30%", "−20%", "no change". */
export function percentChange(factor: number): string {
  const pct = Math.round((factor - 1) * 1000) / 10;
  if (pct === 0) return 'no change';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

export function windowText(shock: Pick<Shock, 'fromDay' | 'toDay'>, horizonDays: number, startMonth: number): string {
  if (shock.fromDay <= 0 && shock.toDay >= horizonDays) return 'the whole horizon';
  if (shock.fromDay >= horizonDays) return `Day ${shock.fromDay + 1} (after the end of this horizon)`;
  const { first, last } = dayNumbersOf(shock, horizonDays);
  const end = shock.toDay >= horizonDays ? 'the end of the horizon' : `Day ${last} (${dayLabel(startMonth, last - 1)})`;
  return `Day ${first} (${dayLabel(startMonth, first - 1)}) to ${end}`;
}

export interface DescribeContext {
  nameOf: (id: Id) => string;
  horizonDays: number;
  startMonth: number;
}

/** One plain-language sentence for a shock. */
export function describeShock(shock: Shock, ctx: DescribeContext): string {
  const when = windowText(shock, ctx.horizonDays, ctx.startMonth);
  switch (shock.type) {
    case 'multiplier':
      return `${TARGET_LABEL[shock.target]} ×${Math.round(shock.factor * 1000) / 1000} (${percentChange(shock.factor)}), ${when}`;
    case 'outage':
      return `${ctx.nameOf(shock.assetId)} out of service, ${when}`;
    case 'absence': {
      const names = shock.employeeIds.map(ctx.nameOf);
      const who = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
      return `${who || 'No one'} absent (unpaid), ${when}`;
    }
    case 'weather':
      return `Forced ${WEATHER_LABEL[shock.state]}, ${when}`;
  }
}

/** Short name used on the timeline bar and in the playback feed. */
export function shockTitle(shock: Shock, nameOf: (id: Id) => string): string {
  switch (shock.type) {
    case 'multiplier':
      return `${TARGET_LABEL[shock.target]} ${percentChange(shock.factor)}`;
    case 'outage':
      return `${nameOf(shock.assetId)} out`;
    case 'absence':
      return `${shock.employeeIds.length} absent`;
    case 'weather':
      return `Forced ${shock.state}`;
  }
}

export interface PresetContext {
  /** Day number (1-based) the windowed presets start on. */
  startDay: number;
  /** Calendar lengths, in days, of one month and of three months from the company's start month. */
  monthDays: number;
  quarterDays: number;
  vehicleId: Id | null;
}

export interface Preset {
  id: string;
  label: string;
  /** Whether the preset uses the "starts on day" field. */
  windowed: boolean;
  needsVehicle?: boolean;
  make: (c: PresetContext) => Shock | null;
}

const span = (c: PresetContext, days: number) => ({ fromDay: c.startDay - 1, toDay: c.startDay - 1 + days });

export const PRESETS: Preset[] = [
  {
    id: 'fuel30',
    label: 'Fuel price +30% (whole horizon)',
    windowed: false,
    make: () => ({ type: 'multiplier', target: 'fuel-price', factor: 1.3, fromDay: 0, toDay: WHOLE_HORIZON_END }),
  },
  { id: 'wet-spring', label: 'Wet spring: rainout weather for 2 weeks', windowed: true, make: (c) => ({ type: 'weather', state: 'rainout', ...span(c, 14) }) },
  { id: 'demand-20', label: 'Demand −20% for 3 months', windowed: true, make: (c) => ({ type: 'multiplier', target: 'demand', factor: 0.8, ...span(c, c.quarterDays) }) },
  {
    id: 'truck-out',
    label: 'Key truck out of service for 1 week',
    windowed: true,
    needsVehicle: true,
    make: (c) => (c.vehicleId ? { type: 'outage', assetId: c.vehicleId, ...span(c, 7) } : null),
  },
  { id: 'absence-wave', label: 'Absence wave: absence ×2 for a month', windowed: true, make: (c) => ({ type: 'multiplier', target: 'absence', factor: 2, ...span(c, c.monthDays) }) },
  {
    id: 'slow-collections',
    label: 'Collections slow down: collection days ×1.5',
    windowed: true,
    make: (c) => ({ type: 'multiplier', target: 'collection-days', factor: 1.5, ...span(c, c.quarterDays) }),
  },
];
