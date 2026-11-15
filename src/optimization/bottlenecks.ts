/**
 * Bottleneck diagnosis from baseline seed-means (optimization-engine §3).
 * Impact figures other than routing are estimates from accounting data.
 */
import type { CompanyConfig, Id, UnservedReason } from '../simulation';
import type { RunSummary } from './evaluate';
import { mean } from './evaluate';
import { fmtPct, fmtUsd } from './explain';
import type { Bottleneck, BottleneckKind } from './types';

export const MIN_SEVERITY = 0.02;
export const IDLE_FLAG_SHARE = 0.15;
export const IDLE_NORMAL_SHARE = 0.1;

const REASON_KINDS: { kind: BottleneckKind; reasons: UnservedReason[]; reason: UnservedReason; what: string }[] = [
  { kind: 'crew-capacity', reasons: ['capacity', 'no-crew'], reason: 'capacity', what: 'crews had no time left' },
  { kind: 'equipment-availability', reasons: ['equipment'], reason: 'equipment', what: 'no crew out that day had the required working equipment' },
  { kind: 'vehicle-availability', reasons: ['vehicle'], reason: 'vehicle', what: 'a crew could not go out for lack of a working vehicle' },
  { kind: 'staffing-reliability', reasons: ['crew-size'], reason: 'crew-size', what: 'absences or vacancies left crews too small' },
  { kind: 'skill-gap', reasons: ['skill'], reason: 'skill', what: 'no crew out that day had the required skill' },
  { kind: 'weather', reasons: ['weather'], reason: 'weather', what: 'weather stopped the work' },
];

const HEADLINES: Record<BottleneckKind, string> = {
  'crew-capacity': 'Crews run out of hours',
  'weak-demand': 'Crews are paid for idle time',
  'equipment-availability': 'Missing or broken equipment blocks work',
  'vehicle-availability': 'Vehicle downtime keeps crews in the yard',
  'staffing-reliability': 'Absences and vacancies leave crews short-handed',
  'skill-gap': 'Work waits for a qualified crew member',
  weather: 'Weather pushes work back',
  'routing-inefficiency': 'A different routing policy would earn more',
  'unprofitable-job-type': 'A service loses money on every job',
  'cash-constraint': 'Cash runs tight',
};

/** Ordering of kinds for ties (stable, deterministic). */
const KIND_ORDER: BottleneckKind[] = [
  'crew-capacity',
  'weak-demand',
  'equipment-availability',
  'vehicle-availability',
  'staffing-reliability',
  'skill-gap',
  'weather',
  'routing-inefficiency',
  'unprofitable-job-type',
  'cash-constraint',
];

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** impact / (share × R); 1 when R = 0 and impact > 0. */
export function revenueSeverity(impact: number, share: number, annualRevenue: number): number {
  if (annualRevenue <= 0) return impact > 0 ? 1 : 0;
  return clamp01(impact / (share * annualRevenue));
}

export interface RoutingProbe {
  policy: string;
  /** Mean paired Δ net profit over the horizon. */
  deltaNetProfit: number;
}

export function diagnoseBottlenecks(
  company: CompanyConfig,
  base: RunSummary[],
  horizonDays: number,
  routing: RoutingProbe[],
): Bottleneck[] {
  const annual = 365 / horizonDays;
  const m = (f: (r: RunSummary) => number) => mean(base.map(f));
  const R = m((r) => r.revenue) * annual;
  const out: Bottleneck[] = [];
  const jobName = (id: Id) => company.jobTypes.find((j) => j.id === id)?.name ?? id;

  // Unserved-work reasons.
  const unserved = (reason: UnservedReason) => m((r) => r.unserved[reason]);
  const totalUnserved = (Object.keys(base[0]?.unserved ?? {}) as UnservedReason[]).reduce((s, k) => s + unserved(k), 0);
  const lost = m((r) => r.lostRevenue);
  if (totalUnserved > 0) {
    for (const rk of REASON_KINDS) {
      const hours = rk.reasons.reduce((s, k) => s + unserved(k), 0);
      const share = hours / totalUnserved;
      const impact = lost * share * annual;
      out.push({
        kind: rk.kind,
        severity: revenueSeverity(impact, 0.1, R),
        estimatedAnnualImpact: impact,
        headline: HEADLINES[rk.kind],
        detail:
          `${fmtPct(share)} of the work left undone at the end of a workday was waiting because ${rk.what}. ` +
          `Jobs cancelled for this reason are worth up to about ${fmtUsd(impact)} of revenue a year (an estimate from accounting data, not a guaranteed gain).`,
        evidence: { unservedHours: hours, unservedShare: share, lostRevenue: lost, annualizedImpact: impact },
        relatedReason: rk.reason,
      });
    }
  }

  // Idle paid time.
  const paid = m((r) => r.paidHours);
  const idle = m((r) => r.idleHours);
  const idleShare = paid > 0 ? idle / paid : 0;
  if (idleShare > IDLE_FLAG_SHARE) {
    const labor = m((r) => r.income.directLabor + r.income.payrollBurden);
    const impact = (idleShare - IDLE_NORMAL_SHARE) * labor * annual;
    out.push({
      kind: 'weak-demand',
      severity: clamp01((idleShare - IDLE_NORMAL_SHARE) / 0.3),
      estimatedAnnualImpact: impact,
      headline: HEADLINES['weak-demand'],
      detail:
        `${fmtPct(idleShare)} of paid hours are neither on site nor driving. ` +
        `Idle time above a normal ${fmtPct(IDLE_NORMAL_SHARE)} costs up to about ${fmtUsd(impact)} a year in wages and burden (an estimate from accounting data).`,
      evidence: { idleShare, idleHours: idle, paidHours: paid, laborCost: labor, annualizedImpact: impact },
    });
  }

  // Routing (simulated).
  let bestRouting: RoutingProbe | null = null;
  for (const p of routing) if (p.deltaNetProfit > 0 && (bestRouting === null || p.deltaNetProfit > bestRouting.deltaNetProfit)) bestRouting = p;
  if (bestRouting) {
    const impact = bestRouting.deltaNetProfit * annual;
    out.push({
      kind: 'routing-inefficiency',
      severity: revenueSeverity(impact, 0.05, R),
      estimatedAnnualImpact: impact,
      headline: HEADLINES['routing-inefficiency'],
      detail: `Re-running the same seeds with "${bestRouting.policy}" routing raised net profit by about ${fmtUsd(impact)} a year (a simulated figure).`,
      evidence: { deltaNetProfit: bestRouting.deltaNetProfit, annualizedImpact: impact },
    });
  }

  // Job types with negative contribution.
  for (const jt of company.jobTypes) {
    const contribution = m((r) => r.jobTypes[jt.id]?.contribution ?? 0);
    if (!(contribution < 0)) continue;
    const impact = -contribution * annual;
    out.push({
      kind: 'unprofitable-job-type',
      severity: revenueSeverity(impact, 0.05, R),
      estimatedAnnualImpact: impact,
      headline: `${jobName(jt.id)} does not cover its direct costs`,
      detail:
        `Revenue from ${jobName(jt.id).toLowerCase()} is below its labor, materials and fuel, a gap of up to about ${fmtUsd(impact)} a year ` +
        `(an estimate from accounting data; overhead is not included).`,
      evidence: { contribution, jobsCompleted: m((r) => r.jobTypes[jt.id]?.jobsCompleted ?? 0), annualizedImpact: impact },
      relatedJobTypeId: jt.id,
    });
  }

  // Cash.
  const shortfallDays = m((r) => r.shortfallDays);
  const minCash = Math.min(...base.map((r) => r.minCash));
  const reserve = company.finance.minCashReserve;
  if (shortfallDays > 0 || minCash < reserve) {
    const interest = m((r) => r.income.interest) * annual;
    out.push({
      kind: 'cash-constraint',
      severity: shortfallDays > 0 ? 1 : 0.5,
      estimatedAnnualImpact: interest,
      headline: HEADLINES['cash-constraint'],
      detail:
        shortfallDays > 0
          ? `Cash runs out even after the line of credit on about ${Math.round(shortfallDays)} days; interest costs about ${fmtUsd(interest)} a year.`
          : `Cash dips to ${fmtUsd(minCash)}, below the ${fmtUsd(reserve)} reserve; interest costs about ${fmtUsd(interest)} a year.`,
      evidence: { shortfallDays, minCash, minCashReserve: reserve, annualInterest: interest },
    });
  }

  return out
    .filter((b) => b.severity >= MIN_SEVERITY)
    .sort(
      (a, b) =>
        b.severity - a.severity ||
        b.estimatedAnnualImpact - a.estimatedAnnualImpact ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        ((a.relatedJobTypeId ?? '') < (b.relatedJobTypeId ?? '') ? -1 : (a.relatedJobTypeId ?? '') > (b.relatedJobTypeId ?? '') ? 1 : 0),
    );
}
