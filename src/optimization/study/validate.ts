/**
 * Validation of finalists (optimization-design §8): long run, stress cases, assumption probes.
 * Every check is a paired comparison with a baseline under the same conditions.
 */
import { simulatedReasons } from '../constraints';
import { mean } from '../evaluate';
import type { AssumptionProbe, LongRunCheck, RunDigest, SensitivityCheck, StressCase, StressCheck, Variant } from '../study-types';
import { distribution } from '../evaluate';
import { readPath } from './backend';
import { fetchRuns, meanDelta, objectiveOf, onTop, toSummary, type StudyContext } from './context';
import type { BaselineFacts } from './generate';
import type { Unit } from './interactions';

export const ROBUST_SHARE = 2 / 3;
export const FADE_SHARE = 0.25;

export function longRunDays(ctx: StudyContext): number {
  return ctx.req.longRunDays ?? Math.max(1095, 3 * ctx.H);
}

/** The standard stress set (§8), built from the company and baseline facts. */
export function defaultStressCases(ctx: StudyContext, facts: BaselineFacts): StressCase[] {
  const H = ctx.H;
  const co = ctx.company;
  const whole = (target: Extract<StressCase['shocks'][number], { type: 'multiplier' }>['target'], factor: number) => ({
    type: 'multiplier' as const,
    target,
    factor,
    fromDay: 0,
    toDay: H,
  });
  const out: StressCase[] = [
    { id: 'demand-down', label: 'Demand 20% lower', shocks: [whole('demand', 0.8)] },
    { id: 'fuel-up', label: 'Fuel 30% dearer', shocks: [whole('fuel-price', 1.3)] },
  ];
  const t = Math.floor(H / 3);
  const crews = co.crews
    .map((c, i) => ({ c, i, members: co.employees.filter((e) => e.crewId === c.id) }))
    .filter((x) => x.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || a.i - b.i)
    .slice(0, 2);
  const people = crews.map((x) => [...x.members].sort((a, b) => b.skill - a.skill)[0].id);
  if (people.length > 0) out.push({ id: 'key-people-out', label: 'Key people out for two weeks', shocks: [{ type: 'absence', employeeIds: people, fromDay: t, toDay: t + 14 }] });
  const top = co.crews
    .filter((c) => c.vehicleId !== null)
    .sort((a, b) => (facts.crewStats[b.id]?.revenue ?? 0) - (facts.crewStats[a.id]?.revenue ?? 0) || (a.id < b.id ? -1 : 1))[0];
  if (top) out.push({ id: 'truck-out', label: 'Busiest crew loses its truck for three weeks', shocks: [{ type: 'outage', assetId: top.vehicleId as string, fromDay: t, toDay: t + 21 }] });
  out.push(
    { id: 'churn-up', label: 'Churn 50% higher', shocks: [whole('churn', 1.5)] },
    { id: 'rain-week', label: 'A week of rain', shocks: [{ type: 'weather', state: 'rainout', fromDay: Math.floor(H / 2), toDay: Math.floor(H / 2) + 5 }] },
    { id: 'upkeep-up', label: 'Maintenance and repairs 50% dearer', shocks: [whole('maintenance-cost', 1.5), whole('repair-cost', 1.5)] },
  );
  return out;
}

export const DEFAULT_PROBES: AssumptionProbe[] = [
  { path: 'market.acquisitionPriceElasticity', label: 'price sensitivity of new customers', factors: [0.7, 1.3] },
  { path: 'market.retentionPriceElasticity', label: 'price sensitivity of existing customers', factors: [0.7, 1.3] },
  { path: 'market.oneOffPriceElasticity', label: 'price sensitivity of one-off work', factors: [0.7, 1.3] },
  { path: 'market.priceIncreaseShockChurnPerPct', label: 'customers lost when prices rise', factors: [0.7, 1.3] },
  { path: 'market.baseMonthlyChurn', label: 'monthly churn', factors: [0.7, 1.3] },
  { path: 'market.baseConversionRate', label: 'lead conversion', factors: [0.7, 1.3] },
  { path: 'market.serviceFailureChurnWeight', label: 'churn after missed or late jobs', factors: [0.7, 1.3] },
  { path: 'workforce.absenceRate', label: 'absence rate', factors: [0.7, 1.3] },
  { path: 'workforce.annualTurnoverRate', label: 'staff turnover', factors: [0.7, 1.3] },
  { path: 'reliability.vehicle.dailyProb', label: 'vehicle breakdown rate', factors: [0.7, 1.3] },
  { path: 'reliability.equipment.dailyProb', label: 'equipment breakdown rate', factors: [0.7, 1.3] },
];

/** Probes that apply: path present and non-zero; only workforce/reliability ones for strategies not sensitive to assumptions. */
export function applicableProbes(ctx: StudyContext, probes: AssumptionProbe[], assumptionSensitive: boolean): AssumptionProbe[] {
  return probes.filter((p) => {
    const v = readPath(ctx.company, p.path);
    if (v === undefined || v === 0) return false;
    return assumptionSensitive || p.path.startsWith('workforce.') || p.path.startsWith('reliability.');
  });
}

function pairedDelta(ctx: StudyContext, runs: RunDigest[], base: RunDigest[]): number {
  return mean(runs.map((r, i) => objectiveOf(r, ctx.objective) - objectiveOf(base[i], ctx.objective)));
}

/** Stress and sensitivity of one finalist; null if the budget cannot afford them. */
export async function stressAndProbes(
  ctx: StudyContext,
  u: Unit,
  cases: StressCase[],
  probes: AssumptionProbe[],
): Promise<{ stress: StressCheck; sensitivity: SensitivityCheck } | null> {
  const seeds = ctx.validationSeeds;
  const ps = applicableProbes(ctx, probes, u.ev.assumptionSensitive);
  const baseVariants: Variant[] = [
    ...cases.map((c) => ({ shocks: c.shocks, patches: c.patches })),
    ...ps.flatMap((p) => p.factors.map((f) => ({ patches: [{ path: p.path, factor: f }] }))),
  ];
  const items = baseVariants.flatMap((bv) => [
    { variant: bv, seeds },
    { variant: onTop(bv, u.def), seeds },
  ]);
  const got = await fetchRuns(ctx, items);
  if (!got) return null;
  const stressCases = cases.map((c, i) => {
    const base = got[2 * i];
    const runs = got[2 * i + 1];
    const feasible = simulatedReasons(runs.map(toSummary), base.map(toSummary), ctx.constraints).length === 0;
    return { id: c.id, label: c.label, delta: pairedDelta(ctx, runs, base), feasible };
  });
  const ok = stressCases.filter((c) => c.delta > 0 && c.feasible).length;
  const stress: StressCheck = {
    cases: stressCases,
    robustShare: stressCases.length > 0 ? ok / stressCases.length : 1,
    worstCase: stressCases.length > 0 ? Math.min(...stressCases.map((c) => c.delta)) : 0,
  };
  const sign = Math.sign(meanDelta(u.ev, ctx.objective));
  const probeRows: SensitivityCheck['probes'] = [];
  let k = 2 * cases.length;
  for (const p of ps)
    for (const f of p.factors) {
      probeRows.push({ path: p.path, label: p.label, factor: f, delta: pairedDelta(ctx, got[k + 1], got[k]) });
      k += 2;
    }
  const flips = probeRows.filter((r) => sign !== 0 && Math.sign(r.delta) !== sign).map((r) => ({ path: r.path, label: r.label, factor: r.factor }));
  return { stress, sensitivity: { probes: probeRows, flips } };
}

/** Long-run check (§8) via prefix identity: Δ_beyond = Δ_L − Δ_H per seed. Null if unaffordable. */
export async function longRun(ctx: StudyContext, u: Unit): Promise<LongRunCheck | null> {
  const seeds = ctx.validationSeeds;
  const L = longRunDays(ctx);
  const got = await fetchRuns(ctx, [
    { variant: { horizonDays: L }, seeds },
    { variant: { ...onTop({}, u.def), horizonDays: L }, seeds },
    { variant: {}, seeds },
    { variant: onTop({}, u.def), seeds },
  ]);
  if (!got) return null;
  const dL = got[1].map((r, i) => objectiveOf(r, ctx.objective) - objectiveOf(got[0][i], ctx.objective));
  const dH = got[3].map((r, i) => objectiveOf(r, ctx.objective) - objectiveOf(got[2][i], ctx.objective));
  const annualizedInHorizon = (meanDelta(u.ev, ctx.objective) * 365) / ctx.H;
  const annualizedBeyondHorizon = (mean(dL.map((x, i) => x - dH[i])) * 365) / (L - ctx.H);
  const delta = distribution(dL);
  const verdict: LongRunCheck['verdict'] =
    delta.mean <= 0 ? 'reverses' : annualizedBeyondHorizon < FADE_SHARE * annualizedInHorizon ? 'fades' : 'holds';
  return { horizonDays: L, delta, annualizedInHorizon, annualizedBeyondHorizon, verdict };
}
