import { buildCalendar } from '@/simulation';

/** First day of every month inside the horizon (including day 0). */
export function buildCalendarLabels(startMonth: number, horizonDays: number): { monthStarts: { day: number; month: number }[] } {
  const cal = buildCalendar(startMonth, horizonDays);
  const monthStarts: { day: number; month: number }[] = [];
  for (const d of cal) if (d.dayOfMonth === 1) monthStarts.push({ day: d.day, month: d.month });
  return { monthStarts };
}
