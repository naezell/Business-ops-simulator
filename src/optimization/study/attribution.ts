/**
 * Loss attribution by relaxation (optimization-design §3): simulate the baseline with one source
 * of loss removed and report the paired Δ objective — an upper bound obtained by experiment.
 */
import type { Shock } from '../../simulation';
import { distribution, mean } from '../evaluate';
import type { Bottleneck } from '../types';
import type { LossSource, RunDigest, Variant } from '../study-types';
import { fetchRuns, objectiveOf, type StudyContext } from './context';

interface Relaxation {
  id: LossSource['id'];
  label: string;
  relaxation: string;
  variant: (H: number) => Variant;
}

const all = (target: Extract<Shock, { type: 'multiplier' }>['target'], H: number): Shock => ({ type: 'multiplier', target, factor: 0, fromDay: 0, toDay: H });

export const RELAXATIONS: Relaxation[] = [
  { id: 'weather', label: 'Weather', relaxation: 'weather forced clear for the whole horizon', variant: (H) => ({ shocks: [{ type: 'weather', state: 'clear', fromDay: 0, toDay: H }] }) },
  { id: 'absence', label: 'Absences', relaxation: 'nobody is ever absent', variant: (H) => ({ shocks: [all('absence', H)] }) },
  { id: 'turnover', label: 'Staff turnover', relaxation: 'nobody quits', variant: (H) => ({ shocks: [all('turnover', H)] }) },
  { id: 'breakdowns', label: 'Breakdowns', relaxation: 'vehicles and equipment never break down', variant: (H) => ({ shocks: [all('vehicle-breakdown', H), all('equipment-breakdown', H)] }) },
  { id: 'travel', label: 'Travel', relaxation: 'travel takes no time and no miles', variant: (H) => ({ shocks: [all('travel-time', H)] }) },
  { id: 'churn', label: 'Customer churn', relaxation: 'no customer leaves', variant: (H) => ({ shocks: [all('churn', H)] }) },
  { id: 'collection-delay', label: 'Slow collections', relaxation: 'invoices are paid the day they are issued', variant: (H) => ({ shocks: [all('collection-days', H)] }) },
  { id: 'demand-shortfall', label: 'Demand', relaxation: '25% more customers (value of more demand, not an elimination)', variant: () => ({ customerScale: 1.25 }) },
];

/** Bottleneck kinds whose dollar figure is replaced by a relaxation value (§3). */
export const BOTTLENECK_SOURCE: Partial<Record<Bottleneck['kind'], LossSource['id'][]>> = {
  weather: ['weather'],
  'staffing-reliability': ['absence', 'turnover'],
  'vehicle-availability': ['breakdowns'],
  'equipment-availability': ['breakdowns'],
  'routing-inefficiency': ['travel'],
  'weak-demand': ['demand-shortfall'],
};

export async function lossAttribution(ctx: StudyContext, base: RunDigest[]): Promise<LossSource[] | null> {
  const seeds = ctx.screenSeeds;
  const got = await fetchRuns(
    ctx,
    RELAXATIONS.map((r) => ({ variant: r.variant(ctx.H), seeds })),
  );
  if (!got) return null;
  const baseRevenue = mean(base.slice(0, seeds.length).map((d) => d.total.income.revenue));
  return RELAXATIONS.map((r, i) => {
    const deltas = got[i].map((d, k) => objectiveOf(d, ctx.objective) - objectiveOf(base[k], ctx.objective));
    const v = distribution(deltas);
    return { id: r.id, label: r.label, valueIfEliminated: v, shareOfRevenue: baseRevenue > 0 ? v.mean / baseRevenue : 0, relaxation: r.relaxation };
  }).sort((a, b) => b.valueIfEliminated.mean - a.valueIfEliminated.mean || (a.id < b.id ? -1 : 1));
}

/** Replaces each bottleneck's estimated dollar impact by the matching relaxation value, annualized (sum of the matching sources). */
export function attachRelaxationValues(bottlenecks: Bottleneck[], sources: LossSource[], H: number): Bottleneck[] {
  return bottlenecks.map((b) => {
    const ids = BOTTLENECK_SOURCE[b.kind];
    if (!ids) return b;
    const vals = sources.filter((s) => ids.includes(s.id));
    if (vals.length === 0) return b;
    const annual = (vals.reduce((a, s) => a + s.valueIfEliminated.mean, 0) * 365) / H;
    return { ...b, estimatedAnnualImpact: annual, evidence: { ...b.evidence, relaxationValueAnnual: annual } };
  });
}
