/**
 * Number and label formatting. The only place that decides how engine values are shown.
 * Pure functions, no business arithmetic beyond unit conversions for display.
 */
import { dayInfo } from '@/simulation';
import type { ParamMeta } from '@/simulation';

const MINUS = '−';
const EN_DASH = '–';

const nf = (decimals: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const cache = new Map<number, Intl.NumberFormat>();
function fmt(decimals: number): Intl.NumberFormat {
  let f = cache.get(decimals);
  if (!f) cache.set(decimals, (f = nf(decimals)));
  return f;
}

/** Plain number with thousands separators and a true minus sign. */
export function num(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return EN_DASH;
  const s = fmt(decimals).format(Math.abs(value));
  const rounded = Number(s.replace(/,/g, ''));
  return value < 0 && rounded !== 0 ? MINUS + s : s;
}

export function signed(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return EN_DASH;
  const s = num(Math.abs(value), decimals);
  const zero = Number(s.replace(/,/g, '')) === 0;
  if (zero) return s;
  return (value < 0 ? MINUS : '+') + s;
}

export function money(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return EN_DASH;
  const s = '$' + fmt(decimals).format(Math.abs(value));
  const zero = Number(s.slice(1).replace(/,/g, '')) === 0;
  return value < 0 && !zero ? MINUS + s : s;
}

export function signedMoney(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return EN_DASH;
  const m = money(Math.abs(value), decimals);
  const zero = Number(m.slice(1).replace(/,/g, '')) === 0;
  if (zero) return m;
  return (value < 0 ? MINUS : '+') + m;
}

/** $12.3k / $1.24M for chart axes and tight spaces. */
export function moneyCompact(value: number): string {
  if (!Number.isFinite(value)) return EN_DASH;
  const a = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** Fraction (0.123) as a percentage string. */
export function percent(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return EN_DASH;
  return num(fraction * 100, decimals) + '%';
}

/** Difference of two fractions in percentage points. */
export function signedPoints(deltaFraction: number, decimals = 1): string {
  if (!Number.isFinite(deltaFraction)) return EN_DASH;
  return signed(deltaFraction * 100, decimals) + ' pp';
}

/** Relative change of b against a, as a signed percentage; empty when a is zero. */
export function signedRelative(a: number, b: number, decimals = 1): string {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return '';
  return signed(((b - a) / Math.abs(a)) * 100, decimals) + '%';
}

export function hours(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return EN_DASH;
  return `${num(value, decimals)} h`;
}

export function miles(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return EN_DASH;
  return `${num(value, decimals)} mi`;
}

/** Hours since shift start as a clock time, e.g. 7.5 -> "7:30 am" for a 7:00 start. */
export function clockTime(hoursSinceStart: number, startHour = 7): string {
  const total = startHour * 60 + Math.round(hoursSinceStart * 60);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Mon 3 Mar" for a simulation day. */
export function dayLabel(startMonth: number, day: number): string {
  const info = dayInfo(startMonth, day);
  return `${WEEKDAYS[info.dayOfWeek]} ${info.dayOfMonth} ${MONTHS[info.month]}`;
}

export function monthName(month: number): string {
  return MONTHS[((month % 12) + 12) % 12];
}

// ───────────────────────── Parameter units ─────────────────────────

type Unit = ParamMeta['unit'];

/** Short unit decoration used next to inputs. */
export const UNIT_SUFFIX: Record<Unit, string> = {
  usd: '',
  'usd/hour': '/h',
  'usd/month': '/mo',
  hours: 'h',
  days: 'days',
  miles: 'mi',
  mph: 'mph',
  fraction: '%',
  multiplier: '×',
  count: '',
  elasticity: '',
  'usd/gallon': '/gal',
};
export const UNIT_PREFIX: Record<Unit, string> = {
  usd: '$',
  'usd/hour': '$',
  'usd/month': '$',
  hours: '',
  days: '',
  miles: '',
  mph: '',
  fraction: '',
  multiplier: '',
  count: '',
  elasticity: '',
  'usd/gallon': '$',
};

/** Fractions are edited as percentages; everything else as-is. */
export function toDisplayValue(value: number, unit: Unit): number {
  return unit === 'fraction' ? value * 100 : value;
}
export function fromDisplayValue(display: number, unit: Unit): number {
  return unit === 'fraction' ? display / 100 : display;
}

/** Number of decimals needed to show multiples of `step` without clutter. */
export function decimalsForStep(step: number): number {
  let d = 0;
  let s = step;
  while (d < 4 && Math.abs(s - Math.round(s)) > 1e-9) {
    s *= 10;
    d += 1;
  }
  return d;
}

function unitTail(unit: Unit): string {
  if (unit === 'fraction') return '%';
  const suffix = UNIT_SUFFIX[unit];
  if (!suffix) return '';
  return suffix.startsWith('/') || suffix === '\u00d7' ? suffix : ` ${suffix}`;
}

/** Read-only display of a parameter value with its unit. */
export function formatParam(value: number, meta: Pick<ParamMeta, 'unit' | 'step'>): string {
  const display = toDisplayValue(value, meta.unit);
  const decimals = decimalsForStep(meta.unit === 'fraction' ? meta.step * 100 : meta.step);
  const body = num(display, decimals);
  return `${UNIT_PREFIX[meta.unit]}${body}${unitTail(meta.unit)}`;
}

export function provenanceLabel(p: 'verified-calculation' | 'user-provided' | 'industry-assumption' | 'synthetic-demo'): string {
  switch (p) {
    case 'verified-calculation':
      return 'Calculated';
    case 'user-provided':
      return 'Your data';
    case 'industry-assumption':
      return 'Illustrative assumption';
    case 'synthetic-demo':
      return 'Synthetic demo data';
  }
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${num(n)} ${n === 1 ? singular : (pluralForm ?? singular + 's')}`;
}
