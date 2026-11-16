/**
 * Capacity experiment (optimization-design §4): scale the customer base, measure service and
 * throughput, find the largest scale that keeps service, and bridge scheduled hours to completed work.
 */
import { scaleCustomerBase, theoreticalWeeklyCapacity } from '../../simulation';
import { mean } from '../evaluate';
import type { CapacityPoint, CapacityReport, RunDigest } from '../study-types';
import { fetchRuns, type StudyContext } from './context';

export const CAPACITY_GRID = [0.6, 0.8, 1.0, 1.2, 1.4, 1.7, 2.0, 2.5];
export const MAX_LATE_RATE = 0.15;
export const BISECTION_STEPS = 3;

const ratio = (a: number, b: number) => (b !== 0 ? a / b : 0);

export function capacityPoint(ctx: StudyContext, scale: number, runs: RunDigest[]): CapacityPoint {
  const weeks = ctx.H / 7;
  const m = (f: (d: RunDigest) => number) => mean(runs.map(f));
  return {
    scale,
    customers: scaleCustomerBase(ctx.base, scale).company.customers.length,
    throughputHoursPerWeek: m((d) => d.total.completedLaborHours) / weeks,
    missedJobRate: m((d) => ratio(d.total.jobsCancelled, d.total.jobsCompleted + d.total.jobsCancelled)),
    lateJobRate: m((d) => ratio(d.total.jobsLate, d.total.jobsCompleted)),
    utilization: m((d) => ratio(d.total.onSiteHours, d.total.paidHours)),
    netProfit: m((d) => d.total.income.netProfit),
  };
}

export function servicePasses(p: CapacityPoint, maxMissed: number): boolean {
  return p.missedJobRate <= maxMissed && p.lateJobRate <= MAX_LATE_RATE;
}

/**
 * Loss bridge per week (§4.6), exact by construction:
 * scheduled = absence + notWorked + idle + travel + productivityGap + completed.
 */
export function lossBridge(runs: RunDigest[], shiftHours: number, H: number): CapacityReport['lossBridge'] {
  const weeks = H / 7;
  const m = (f: (d: RunDigest) => number) => mean(runs.map(f)) / weeks;
  const scheduled = m((d) => d.total.scheduledHours);
  const absence = m((d) => d.total.absentShifts * shiftHours);
  const paid = m((d) => d.total.paidHours);
  const notWorked = scheduled - absence - paid;
  const idle = m((d) => d.total.idleHours);
  const travel = m((d) => d.total.travelHours);
  const onSite = m((d) => d.total.onSiteHours);
  const completed = m((d) => d.total.completedLaborHours);
  return [
    { id: 'scheduled', label: 'Scheduled person-hours', hoursPerWeek: scheduled },
    { id: 'absence', label: 'Absences', hoursPerWeek: -absence },
    { id: 'not-worked', label: notWorked >= 0 ? 'Scheduled but not paid (short days)' : 'Overtime beyond the schedule', hoursPerWeek: -notWorked },
    { id: 'idle', label: 'Paid but idle', hoursPerWeek: -idle },
    { id: 'travel', label: 'Travel and stop overhead', hoursPerWeek: -travel },
    { id: 'productivity', label: 'Productivity (ramp-up, crew size, fatigue, learning)', hoursPerWeek: -(onSite - completed) },
    { id: 'completed', label: 'Completed standard hours', hoursPerWeek: completed },
  ];
}

export async function capacityExperiment(ctx: StudyContext): Promise<CapacityReport | null> {
  const seeds = ctx.screenSeeds;
  const maxMissed = ctx.constraints.maxMissedJobRate;
  const grid = await fetchRuns(
    ctx,
    CAPACITY_GRID.map((s) => ({ variant: { customerScale: s }, seeds })),
  );
  if (!grid) return null;
  const points = CAPACITY_GRID.map((s, i) => capacityPoint(ctx, s, grid[i]));
  const firstFail = points.findIndex((p) => !servicePasses(p, maxMissed));
  let effectiveScale: number;
  if (firstFail < 0) effectiveScale = CAPACITY_GRID[CAPACITY_GRID.length - 1];
  else if (firstFail === 0) effectiveScale = CAPACITY_GRID[0];
  else {
    let lo = CAPACITY_GRID[firstFail - 1];
    let hi = CAPACITY_GRID[firstFail];
    for (let k = 0; k < BISECTION_STEPS; k++) {
      const mid = Math.round(((lo + hi) / 2) * 1e6) / 1e6;
      const got = await fetchRuns(ctx, [{ variant: { customerScale: mid }, seeds }]);
      if (!got) break;
      const p = capacityPoint(ctx, mid, got[0]);
      points.push(p);
      if (servicePasses(p, maxMissed)) lo = mid;
      else hi = mid;
    }
    effectiveScale = lo;
  }
  points.sort((a, b) => a.scale - b.scale);
  const top = grid[grid.length - 1];
  const failRuns = firstFail >= 0 ? grid[firstFail] : top;
  const unserved: Record<string, number> = {};
  for (const d of failRuns) for (const [k, v] of Object.entries(d.total.unserved)) unserved[k] = (unserved[k] ?? 0) + v / failRuns.length;
  const binding = Object.entries(unserved).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  let profitMaxScale = CAPACITY_GRID[0];
  let bestProfit = -Infinity;
  for (let i = 0; i < CAPACITY_GRID.length; i++) {
    const p = points.find((x) => x.scale === CAPACITY_GRID[i]) as CapacityPoint;
    if (p.netProfit > bestProfit) {
      bestProfit = p.netProfit;
      profitMaxScale = p.scale;
    }
  }
  return {
    points,
    effectiveScale,
    headroomCustomers: Math.floor((effectiveScale - 1) * ctx.company.customers.length),
    saturationHoursPerWeek: (points.find((p) => p.scale === CAPACITY_GRID[CAPACITY_GRID.length - 1]) as CapacityPoint).throughputHoursPerWeek,
    theoreticalHoursPerWeek: theoreticalWeeklyCapacity(ctx.base),
    lossBridge: lossBridge(top, ctx.company.policies.shiftHours, ctx.H),
    profitMaxScale,
    bindingConstraint: binding && binding[1] > 0 ? binding[0] : 'none',
  };
}
