/**
 * Study structure (implementation-contracts §4; optimization-design §12 tests 7–13).
 */
import { describe, expect, it } from 'vitest';
import { createInProcessBackend, digestOf, runStudy, scenarioFor, variantKey, type EvalJob, type EvaluateBatch, type RunDigest, type StudyRequest } from '../../src/optimization';
import { runSimulation, type Scenario } from '../../src/simulation';
import { simulatedReasons } from '../../src/optimization/constraints';
import { createContext, toSummary } from '../../src/optimization/study/context';
import { capacityExperiment, lossBridge } from '../../src/optimization/study/capacity';
import { lossAttribution } from '../../src/optimization/study/attribution';
import { dominates, markPareto } from '../../src/optimization/study/verdict';
import { landscaping } from '../../src/business/landscaping';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { catalog, oneCrew, sc } from './helpers';
import { months } from '../simulation/helpers';
import { stochasticMid } from '../simulation/scenarios';

const strip = <T extends { elapsedMs: number }>(r: T) => ({ ...r, elapsedMs: 0 });

describe('backend: keys and digests', () => {
  it('variant keys ignore object key order and shock/patch order, not action or rule order', () => {
    const s1 = { type: 'multiplier' as const, target: 'demand' as const, factor: 2, fromDay: 0, toDay: 5 };
    const s2 = { type: 'weather' as const, state: 'rainout' as const, fromDay: 1, toDay: 2 };
    expect(variantKey({ shocks: [s1, s2] })).toBe(variantKey({ shocks: [s2, { toDay: 5, fromDay: 0, factor: 2, target: 'demand', type: 'multiplier' }] }));
    expect(variantKey({ patches: [{ path: 'a', factor: 2 }, { path: 'b', value: 1 }] })).toBe(variantKey({ patches: [{ value: 1, path: 'b' }, { path: 'a', factor: 2 }] }));
    const a1 = { day: 0, action: { type: 'set-marketing-spend' as const, monthlySpend: 1 } };
    const a2 = { day: 0, action: { type: 'set-marketing-spend' as const, monthlySpend: 2 } };
    expect(variantKey({ actions: [a1, a2] })).not.toBe(variantKey({ actions: [a2, a1] }));
    expect(variantKey({})).toBe(variantKey({ customerScale: 1, shocks: [], actions: [] }));
  });

  it('a digest is structured-cloneable and equals a fresh digest of the same run', () => {
    const s = { ...stochasticMid(2), horizonDays: 60 };
    const d = digestOf(runSimulation(s, { detail: 'summary' }), 'k');
    expect(structuredClone(d)).toEqual(d);
    expect(d.cashWeekly.length).toBe(Math.ceil(60 / 7) + (59 % 7 === 0 ? 0 : 1));
  });

  it('scenarioFor applies patches, scale, shocks, rules, actions, horizon and seed without mutating the base', () => {
    const base = sc(oneCrew(20));
    const before = structuredClone(base);
    const s = scenarioFor(
      base,
      { patches: [{ path: 'workforce.absenceRate', value: 0.1 }, { path: 'costs.fuelPricePerGallon', factor: 2 }], customerScale: 2, horizonDays: 9, actions: [{ day: 1, action: { type: 'set-marketing-spend', monthlySpend: 5 } }] },
      77,
    );
    expect(base).toEqual(before);
    expect([s.company.workforce.absenceRate, s.company.costs.fuelPricePerGallon, s.company.customers.length, s.horizonDays, s.seed, s.actions.length]).toEqual([0.1, 0, 40, 9, 77, 1]);
  });
});

describe('capacity and loss attribution (tests 7, 8)', () => {
  it('7: deterministic one-crew company — effective scale within one bisection step of the hand value; bridge sums exactly', async () => {
    // Crew of two, 8 h/day, 5 days, productivity 1, coordination 0, no travel to speak of (customers within
    // 0.4 mile of the depot, 30 mph ⇒ ≈ 1.6 min per leg), stop overhead 0, 1 labor-hour per weekly visit.
    // Capacity ≈ 2 × 8 × 5 = 80 visits a week minus travel ⇒ about 78 customers. With 50 customers the hand
    // value of the effective scale is ≈ 78 / 50 ≈ 1.55; the grid brackets it in [1.4, 1.7] and three bisection
    // steps narrow it to 0.0375 wide.
    // Strict jobs (late after 3 days, cancelled after 7) so overload shows as missed jobs within the horizon.
    const strict = oneCrew(50);
    strict.jobTypes = [{ ...strict.jobTypes[0], lateAfterDays: 3, cancelAfterDays: 7 }];
    const req: StudyRequest = { scenario: sc(strict, 56), catalog, objective: 'net-profit', budget: { seeds: 2, screenSeeds: 2 } };
    const ctx = createContext(req, createInProcessBackend(req.scenario));
    ctx.budget.startPhase('capacity');
    const cap = (await capacityExperiment(ctx))!;
    const passes = cap.points.filter((p) => p.missedJobRate <= 0.05 && p.lateJobRate <= 0.15).map((p) => p.scale);
    expect(cap.effectiveScale).toBe(Math.max(...passes.filter((s) => s <= cap.effectiveScale)));
    expect(cap.effectiveScale).toBeGreaterThanOrEqual(1.4);
    expect(cap.effectiveScale).toBeLessThanOrEqual(1.7);
    expect(Math.abs(cap.effectiveScale - 78 / 50)).toBeLessThanOrEqual(0.3 / 8 + 0.05);
    expect(cap.headroomCustomers).toBe(Math.floor((cap.effectiveScale - 1) * 50));
    expect(cap.theoreticalHoursPerWeek).toBe(80);
    // Bridge: scheduled − Σ losses = completed, exactly.
    const [scheduled, ...rest] = cap.lossBridge;
    const completed = rest[rest.length - 1];
    const losses = rest.slice(0, -1).reduce((a, x) => a + x.hoursPerWeek, 0);
    expect(scheduled.hoursPerWeek + losses).toBeCloseTo(completed.hoursPerWeek, 9);
    expect(cap.bindingConstraint).toBe('capacity');
  });

  it('lossBridge on hand digests: scheduled 100 = absence 8 + not worked 2 + idle 10 + travel 20 + productivity 5 + completed 55', () => {
    const d = { total: { scheduledHours: 100, absentShifts: 1, paidHours: 90, idleHours: 10, travelHours: 20, onSiteHours: 60, completedLaborHours: 55 } } as unknown as RunDigest;
    const b = lossBridge([d], 8, 7);
    expect(b.map((x) => x.hoursPerWeek)).toEqual([100, -8, -2, -10, -20, -5, 55]);
  });

  it('8: a company whose only loss is weather — the weather relaxation equals the gap to the no-loss run; others ≈ 0', async () => {
    const base = oneCrew(60);
    // Rainouts are paid (8 h) and jobs are cancelled after 4 days, so rain costs revenue and wages.
    const company = {
      ...base,
      policies: { ...base.policies, rainoutPaidHours: 8 },
      weather: { rainoutProbByMonth: months(0.15), partialProbByMonth: months(0), partialDayFraction: 0.5 },
      jobTypes: [{ ...base.jobTypes[0], weatherSensitive: true, cancelAfterDays: 4 }],
    };
    const req: StudyRequest = { scenario: sc(company, 56), catalog, objective: 'net-profit', budget: { seeds: 2, screenSeeds: 2 } };
    const be = createInProcessBackend(req.scenario);
    const ctx = createContext(req, be);
    const baseRuns = await be(ctx.seeds.map((s) => ({ key: variantKey({}), variant: {}, seed: s })));
    ctx.budget.startPhase('loss-attribution');
    const la = (await lossAttribution(ctx, baseRuns))!;
    const v = (id: string) => la.find((l) => l.id === id)!.valueIfEliminated.mean;
    // No-loss run computed independently: rainout probability 0.
    const clear = { ...company, weather: { ...company.weather, rainoutProbByMonth: months(0) } };
    const gap =
      ctx.seeds.reduce((a, s) => a + runSimulation({ ...req.scenario, company: clear, seed: s }, { detail: 'summary' }).totals.income.netProfit, 0) / 2 -
      baseRuns.reduce((a, d) => a + d.total.income.netProfit, 0) / 2;
    expect(gap).toBeGreaterThan(0);
    expect(v('weather')).toBeCloseTo(gap, 6);
    for (const id of ['absence', 'turnover', 'breakdowns', 'churn', 'collection-delay']) expect(Math.abs(v(id))).toBeLessThan(1e-6);
  });
});

describe('budget, determinism, Pareto, constraints (tests 9–12)', () => {
  const demo = createDemoTwinScenario() as Scenario;
  const small: StudyRequest = { scenario: demo, catalog: landscaping, objective: 'net-profit', budget: { maxSimulations: 300, seeds: 3, screenSeeds: 2, validationSeeds: 1, finalists: 2 }, longRunDays: 365 };

  it('9: a tiny budget returns a valid partial result, flags it and never exceeds the cap', async () => {
    let units = 0;
    const inner = createInProcessBackend(demo);
    const be: EvaluateBatch = async (jobs) => {
      for (const j of jobs) units += Math.ceil((j.variant.horizonDays ?? demo.horizonDays) / demo.horizonDays);
      return inner(jobs);
    };
    const r = await runStudy({ ...small, budget: { ...small.budget, maxSimulations: 60 } }, be);
    expect(units).toBeLessThanOrEqual(60 - 1); // one unit is the in-process full-detail baseline
    expect(r.budgetExhausted).toBe(true);
    expect(r.phasesCompleted[0]).toBe('baseline');
    for (const s of r.strategies) expect(s.feasible).toBe(true);
  });

  it('10: deterministic and independent of batching and completion order', async () => {
    const a = await runStudy(small, createInProcessBackend(demo));
    const b = await runStudy(small, createInProcessBackend(demo, { batchSize: 1 }));
    // A backend that completes jobs in reverse order (still returns them in job order).
    const inner = createInProcessBackend(demo);
    const shuffled: EvaluateBatch = async (jobs: EvalJob[]) => {
      const out: RunDigest[] = new Array(jobs.length);
      for (let i = jobs.length - 1; i >= 0; i--) out[i] = (await inner([jobs[i]]))[0];
      return out;
    };
    const c = await runStudy(small, shuffled);
    expect(strip(b)).toEqual(strip(a));
    expect(strip(c)).toEqual(strip(a));
    expect(a.feasibleStrategiesEvaluated).toBeGreaterThan(20);
  }, 120000);

  it('11: Pareto set of hand-built outcomes', () => {
    // axes: Δ, score, worst, minCash, −upfront, −missed
    expect(dominates([2, 2, 2, 2, 2, 2], [1, 2, 2, 2, 2, 2])).toBe(true);
    expect(dominates([2, 2, 2, 2, 2, 2], [2, 2, 2, 2, 2, 2])).toBe(false);
    const mk = (id: string, d: number, upfront: number, minCash: number, feasible = true) =>
      ({ id, feasible, score: d, deltaNetProfit: { mean: d, min: d, max: d, stdDev: 0 }, deltaEndingCash: { mean: 0, min: 0, max: 0, stdDev: 0 }, minCash, upfrontCash: upfront, operations: { missedJobRate: [0, 0.01] } }) as never;
    // A: most profit, needs cash. B: less profit, no cash. C: dominated by B. D: infeasible.
    const list = [mk('A', 100, 5000, 1000), mk('B', 60, 0, 3000), mk('C', 50, 0, 2000), mk('D', 500, 0, 9000, false)];
    markPareto(list, 'net-profit');
    expect((list as { id: string; paretoOptimal: boolean }[]).filter((x) => x.paretoOptimal).map((x) => x.id)).toEqual(['A', 'B']);
  });

  it('12 and IC §4: recommended strategies re-simulated satisfy the constraints, reproduce ΔNP exactly, drivers sum to ΔNP', async () => {
    const r = await runStudy(small, createInProcessBackend(demo));
    const rec = r.strategies.filter((s) => s.verdict === 'recommended');
    expect(rec.length).toBeGreaterThan(0);
    const req = createContext(small, createInProcessBackend(demo));
    for (const s of rec.slice(0, 5)) {
      const base = r.seeds.slice(0, s.seedsEvaluated).map((seed) => digestOf(runSimulation(scenarioFor(demo, {}, seed), { detail: 'summary' }), ''));
      const runs = r.seeds.slice(0, s.seedsEvaluated).map((seed) => digestOf(runSimulation(scenarioFor(demo, s.variant, seed), { detail: 'summary' }), ''));
      const dnp = runs.map((x, i) => x.total.income.netProfit - base[i].total.income.netProfit);
      expect(dnp.reduce((a, x) => a + x, 0) / dnp.length).toBe(s.deltaNetProfit.mean);
      expect(simulatedReasons(runs.map(toSummary), base.map(toSummary), req.constraints)).toEqual([]);
      expect(s.drivers.reduce((a, d) => a + d.delta, 0)).toBeCloseTo(s.deltaNetProfit.mean, 6);
    }
  }, 120000);
});
