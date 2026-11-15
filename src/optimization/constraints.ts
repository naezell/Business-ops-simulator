/**
 * Feasibility (optimization-engine §5): static checks before simulating and
 * simulated checks against the paired baseline runs.
 */
import type { Action, CompanyConfig, Id, PlannedAction } from '../simulation';
import { crewMembers, crewSeats } from './candidates';
import { fmtUsd, fmtPct } from './explain';
import type { RunSummary } from './evaluate';
import { mean } from './evaluate';

export const DEFAULT_MIN_CASH_FLOOR = 0;
export const DEFAULT_MAX_MISSED_JOB_RATE = 0.05;
export const DEFAULT_MIN_PROBABILITY_OF_IMPROVEMENT = 0.7;
/** A plan may raise the missed-job rate by at most this much over the baseline rate. */
export const MISSED_RATE_TOLERANCE = 0.005;
/**
 * Rounding slack for the cash floor: a line-of-credit draw brings cash back to 0, but the
 * balance is accumulated from several flows, so it can land a few ULPs below 0.
 */
export const CASH_EPS = 0.005;

function acquisitionCash(price: number, method: 'cash' | 'loan' | 'lease', downPaymentFraction: number): number {
  if (method === 'cash') return price;
  if (method === 'loan') return price * downPaymentFraction;
  return 0;
}

/** Cash needed on day 0: cash prices + loan down payments + hiring costs of the day-0 actions. */
export function upfrontCash(company: CompanyConfig, actions: PlannedAction[]): number {
  const dp = company.finance.newLoan.downPaymentFraction;
  const hireCost = company.workforce.hiringCostPerHire;
  let total = 0;
  for (const pa of actions) {
    if (pa.day !== 0) continue;
    const a: Action = pa.action;
    switch (a.type) {
      case 'hire-employee':
        total += hireCost;
        break;
      case 'add-crew':
        total += hireCost * a.hires.length;
        total += acquisitionCash(a.vehicle.spec.purchasePrice, a.vehicle.method, dp);
        for (const e of a.equipment) total += acquisitionCash(e.spec.purchasePrice, e.method, dp);
        break;
      case 'acquire-vehicle':
      case 'acquire-equipment':
        total += acquisitionCash(a.spec.purchasePrice, a.method, dp);
        break;
      default:
        break;
    }
  }
  return total;
}

/** Reasons a set of day-0 actions is infeasible before simulating; empty when none. */
export function staticReasons(company: CompanyConfig, actions: PlannedAction[]): string[] {
  const reasons: string[] = [];
  const upfront = upfrontCash(company, actions);
  const capacity = company.finance.startingCash + company.finance.lineOfCredit.limit;
  if (upfront > capacity) {
    reasons.push(`Needs ${fmtUsd(upfront)} of cash up front, more than the ${fmtUsd(capacity)} of starting cash plus line of credit.`);
  }

  const members = new Map<Id, Set<Id>>();
  for (const c of company.crews) members.set(c.id, new Set(crewMembers(company, c.id).map((e) => e.id)));
  const hires = new Map<Id, number>();
  const removedCrews = new Set<Id>();
  for (const pa of actions) {
    const a = pa.action;
    if (a.type === 'hire-employee') hires.set(a.crewId, (hires.get(a.crewId) ?? 0) + 1);
    else if (a.type === 'remove-crew') removedCrews.add(a.crewId);
    else if (a.type === 'add-crew' && a.hires.length > a.vehicle.spec.seats) {
      reasons.push(`The new crew has ${a.hires.length} people but its vehicle seats only ${a.vehicle.spec.seats}.`);
    }
  }
  for (const pa of actions) {
    const a = pa.action;
    if (a.type !== 'remove-employee') continue;
    const emp = company.employees.find((e) => e.id === a.employeeId);
    if (!emp || emp.crewId === null || removedCrews.has(emp.crewId)) continue;
    const set = members.get(emp.crewId);
    if (!set) continue;
    set.delete(emp.id);
    if (set.size + (hires.get(emp.crewId) ?? 0) === 0) {
      reasons.push(`Removing ${emp.name} would leave their crew with nobody; close the crew instead.`);
    }
  }
  for (const [crewId, n] of hires) {
    if (removedCrews.has(crewId)) continue;
    const seats = crewSeats(company, crewId);
    const size = (members.get(crewId)?.size ?? 0) + n;
    if (size > seats) reasons.push(`Hiring would put ${size} people in a crew whose vehicle seats ${seats}.`);
  }
  return reasons;
}

export interface ResolvedConstraints {
  minCashFloor: number;
  maxMissedJobRate: number;
  minProbabilityOfImprovement: number;
}

/** Reasons the simulated runs violate a constraint; `runs[i]` is paired with `base[i]`. */
export function simulatedReasons(runs: RunSummary[], base: RunSummary[], c: ResolvedConstraints): string[] {
  const reasons: string[] = [];
  const rejected = new Set<string>();
  // Rejections already present in the baseline (from the scenario's own actions) are not the candidate's fault.
  for (let i = 0; i < runs.length; i++) {
    const left = [...base[i].rejected];
    for (const msg of runs[i].rejected) {
      const j = left.indexOf(msg);
      if (j >= 0) left.splice(j, 1);
      else rejected.add(msg);
    }
  }
  for (const msg of rejected) reasons.push(`The simulator rejected an action (${msg}).`);

  let moreShortfall = 0;
  let belowFloor = 0;
  let lowest = Infinity;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const b = base[i];
    if (b.shortfallDays > 0) {
      if (r.shortfallDays > b.shortfallDays) moreShortfall += 1;
    } else if (r.minCash < c.minCashFloor - CASH_EPS) {
      belowFloor += 1;
      lowest = Math.min(lowest, r.minCash);
    }
  }
  if (moreShortfall > 0) {
    reasons.push(`Runs out of cash on more days than today's plan in ${moreShortfall} of ${runs.length} simulated seeds.`);
  }
  if (belowFloor > 0) {
    reasons.push(
      `Cash falls to ${fmtUsd(lowest)}, below the ${fmtUsd(c.minCashFloor)} cash floor, in ${belowFloor} of ${runs.length} simulated seeds.`,
    );
  }

  const missed = mean(runs.map((r) => r.missedJobRate));
  const baseMissed = mean(base.map((r) => r.missedJobRate));
  const cap = Math.max(c.maxMissedJobRate, baseMissed + MISSED_RATE_TOLERANCE);
  if (missed > cap) {
    reasons.push(`Missed-job rate rises to ${fmtPct(missed)}, above the allowed ${fmtPct(cap)}.`);
  }
  return reasons;
}
