/** Calendar (simulation-engine §2): 365-day years, day 0 = Monday the 1st of startMonth. */

export const MONTH_LENGTHS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface DayInfo {
  day: number;
  /** Calendar month 0–11. */
  month: number;
  /** 1-based day of month. */
  dayOfMonth: number;
  /** 0 = Monday. */
  dayOfWeek: number;
  /** dayOfMonth == 1 and day > 0. */
  firstOfMonth: boolean;
}

export function dayOfWeek(day: number): number {
  return day % 7;
}

export function isWorkday(day: number, workDaysPerWeek: number): boolean {
  return day % 7 < workDaysPerWeek;
}

/** Calendar info for one day. O(12). */
export function dayInfo(startMonth: number, day: number): DayInfo {
  let rem = day % 365;
  let m = startMonth;
  while (rem >= MONTH_LENGTHS[m]) {
    rem -= MONTH_LENGTHS[m];
    m = (m + 1) % 12;
  }
  const dayOfMonth = rem + 1;
  return { day, month: m, dayOfMonth, dayOfWeek: day % 7, firstOfMonth: dayOfMonth === 1 && day > 0 };
}

/** Calendar info for days 0 … horizon−1. */
export function buildCalendar(startMonth: number, horizonDays: number): DayInfo[] {
  const out: DayInfo[] = new Array(horizonDays);
  let m = startMonth;
  let dom = 1;
  for (let d = 0; d < horizonDays; d++) {
    out[d] = { day: d, month: m, dayOfMonth: dom, dayOfWeek: d % 7, firstOfMonth: dom === 1 && d > 0 };
    dom += 1;
    if (dom > MONTH_LENGTHS[m]) {
      dom = 1;
      m = (m + 1) % 12;
    }
  }
  return out;
}
