/**
 * Known-answer tests for the optimizer (optimization-engine §8). Expected answers come
 * from each scenario's construction or from brute-force simulation inside the test,
 * never from the optimizer's own output.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation } from '../../src/simulation';
import type { PlannedAction, Scenario, SimulationResult } from '../../src/simulation';
import { optimize } from '../../src/optimization';
import type { CandidateEvaluation, OptimizationResult, OptimizerCatalog } from '../../src/optimization';
import {
  ZERO_ELASTICITY,
  aeratorSpec,
  capacityBound,
  cashPoor,
  demandBound,
  expensiveTruck,
  missingEquipment,
  request,
  smallCatalog,
  smallStochastic,
  testCatalog,
  withActions,
  zeroElasticity,
} from './scenarios';

const K = 3;
const seedsOf = (sc: Scenario, k = K) => Array.from({ length: k }, (_, i) => sc.seed + 7919 * i);
const run = (sc: Scenario, seed: number, actions: PlannedAction[] = []): SimulationResult =>
  runSimulation(withActions(sc, seed, actions), { detail: 'summary' });

const actionTypes = (c: CandidateEvaluation) => c.actions.map((a) => a.action.type);

describe('§8.1 capacity-bound, cash-rich', () => {
  const sc = capacityBound();
  const result = optimize(request(sc, testCatalog(), { seedCount: 2, maxPlanSize: 2 }));

  it('recommends adding capacity first', () => {
    const top = result.candidates[0];
    expect(top.recommended).toBe(true);
    expect(actionTypes(top).some((t) => t === 'add-crew' || t === 'hire-employee')).toBe(true);
  });

  it('ranks crew-capacity as the top bottleneck', () => {
    expect(result.bottlenecks[0].kind).toBe('crew-capacity');
    // By construction every unserved hour is waiting for crew time.
    expect(result.bottlenecks[0].evidence.unservedShare).toBeCloseTo(1, 9);
  });
});

describe('§8.2 demand-bound', () => {
  const sc = demandBound();
  const result = optimize(request(sc, testCatalog(), { seedCount: 2, maxPlanSize: 2 }));

  it('ranks adding a crew with a negative delta and does not recommend it', () => {
    const adds = result.candidates.filter((c) => actionTypes(c).includes('add-crew'));
    expect(adds.length).toBeGreaterThan(0);
    for (const c of adds) {
      expect(c.deltaNetProfit.mean).toBeLessThan(0);
      expect(c.recommended).toBe(false);
    }
  });

  it('ranks weak-demand as the top bottleneck', () => {
    expect(result.bottlenecks[0].kind).toBe('weak-demand');
    // Paid 4 people × 8 h on each workday; work is 20 one-hour visits a week plus driving.
    expect(result.bottlenecks[0].evidence.idleShare).toBeGreaterThan(0.8);
  });
});

describe('§8.3 cash-poor', () => {
  const sc = cashPoor();
  const catalog = testCatalog({ vehicleCatalog: [expensiveTruck] });
  const result = optimize(request(sc, catalog, { seedCount: 2, maxPlanSize: 1 }));

  it('reports the loan-financed $80k truck as infeasible for cash and never ranks it', () => {
    // Down payment 0.2 × 80,000 = 16,000 > 10,000 cash + 0 credit.
    const isLoanTruck = (c: CandidateEvaluation) =>
      c.actions.some((a) => a.action.type === 'acquire-vehicle' && a.action.method === 'loan' && a.action.spec.purchasePrice === 80000);
    const bad = result.infeasible.filter(isLoanTruck);
    expect(bad).toHaveLength(1);
    expect(bad[0].upfrontCash).toBeCloseTo(16000, 6);
    expect(bad[0].infeasibleReasons.join(' ')).toMatch(/cash/i);
    expect(bad[0].seedsEvaluated).toBe(0);
    expect(result.candidates.some(isLoanTruck)).toBe(false);
    expect(result.bestPlan === null || !isLoanTruck(result.bestPlan)).toBe(true);
  });
});

describe('§8.4 missing equipment', () => {
  const sc = missingEquipment();
  const catalog: OptimizerCatalog = testCatalog({ equipmentCatalog: [aeratorSpec] });
  const result = optimize(request(sc, catalog, { seedCount: 2, maxPlanSize: 2 }));
  const forCrew = (c: CandidateEvaluation) =>
    c.actions.some((a) => a.action.type === 'acquire-equipment' && a.action.spec.equipmentTypeId === 'aerator' && a.action.crewId === 'c1');

  it('recommends buying the aerator for the crew', () => {
    const c = result.candidates.find(forCrew);
    expect(c).toBeDefined();
    expect(c!.recommended).toBe(true);
    expect(c!.upfrontCash).toBeCloseTo(1500, 6); // cheaper than $2,000 → bought for cash
    expect(c!.deltaRevenue.mean).toBeGreaterThan(0);
  });

  it('flags equipment availability', () => {
    const b = result.bottlenecks.find((x) => x.kind === 'equipment-availability');
    expect(b).toBeDefined();
    expect(b!.severity).toBeGreaterThan(0.5);
  });
});

describe('§8.5 zero elasticity', () => {
  const sc = zeroElasticity();
  const result = optimize(request(sc, testCatalog(), { seedCount: 1, maxPlanSize: 1 }));

  it('a +10% price change adds exactly 10% of the revenue of orders created from day 0', () => {
    const { customers, visits, price } = ZERO_ELASTICITY;
    const handRevenue = customers * visits * price; // 2,000
    expect(result.baseline.revenue.mean).toBeCloseTo(handRevenue, 9);
    const c = result.candidates.find((x) =>
      x.actions.some((a) => a.action.type === 'set-price' && a.action.jobTypeId === 'all' && Math.abs(a.action.multiplier - 1.1) < 1e-12),
    );
    expect(c).toBeDefined();
    expect(c!.deltaRevenue.mean).toBeCloseTo(0.1 * handRevenue, 9);
  });
});

describe('§8.6–8.9 small stochastic company', () => {
  const sc = smallStochastic();
  const catalog = smallCatalog();
  const req = request(sc, catalog, { seedCount: K });
  const result: OptimizationResult = optimize(req);
  const seeds = seedsOf(sc);
  const base = seeds.map((s) => run(sc, s));

  it('evaluates a non-trivial candidate set', () => {
    expect(result.seeds).toEqual(seeds);
    expect(result.candidates.length).toBeGreaterThanOrEqual(10);
  });

  it('§8.6 brute force: the top-ranked single is the argmax of independently simulated deltas', () => {
    const brute = result.candidates.map((c) => {
      const deltas = seeds.map((s, i) => run(sc, s, c.actions).totals.income.netProfit - base[i].totals.income.netProfit);
      return { id: c.id, mean: deltas.reduce((a, b) => a + b, 0) / deltas.length, full: c.seedsEvaluated === K, reported: c.deltaNetProfit.mean };
    });
    // Fully evaluated candidates report the brute-force mean.
    for (const b of brute) if (b.full) expect(b.reported).toBeCloseTo(b.mean, 6);
    const argmax = brute.reduce((best, b) => (b.mean > best.mean ? b : best));
    expect(result.candidates[0].id).toBe(argmax.id);
    if (result.candidates[0].recommended) {
      expect(result.bestPlan).not.toBeNull();
      expect(result.bestPlan!.deltaNetProfit.mean).toBeGreaterThanOrEqual(result.candidates[0].deltaNetProfit.mean);
    }
  });

  it('§8.7 determinism: the same request gives a deep-equal result (excluding elapsedMs)', () => {
    let t = 0;
    const again = optimize(req, undefined, () => (t += 10));
    expect(again.elapsedMs).toBe(10);
    expect({ ...again, elapsedMs: 0 }).toEqual({ ...result, elapsedMs: 0 });
  });

  it('§8.8 drivers sum to the mean change in net profit for every evaluation', () => {
    const all = [...result.candidates, ...result.infeasible, ...(result.bestPlan ? [result.bestPlan] : [])];
    for (const c of all) {
      const sum = c.drivers.reduce((s, d) => s + d.delta, 0);
      expect(Math.abs(sum - c.deltaNetProfit.mean), c.id).toBeLessThan(1e-6 * Math.max(1, Math.abs(c.deltaNetProfit.mean)));
      if (c.seedsEvaluated > 0) expect(c.drivers.map((d) => d.line)).not.toContain('netProfit');
    }
  });

  it('§8.9 no recommended candidate or plan violates a constraint when re-simulated', () => {
    const company = sc.company;
    const baseMissed = base.reduce((s, r) => s + r.totals.missedJobRate, 0) / K;
    const checked = [...result.candidates.filter((c) => c.recommended), ...(result.bestPlan ? [result.bestPlan] : [])];
    expect(checked.length).toBeGreaterThan(0);
    for (const c of checked) {
      // Static: upfront cash from the action list, computed here independently.
      let upfront = 0;
      for (const { action: a } of c.actions) {
        if (a.type === 'hire-employee') upfront += company.workforce.hiringCostPerHire;
        if (a.type === 'acquire-vehicle' || a.type === 'acquire-equipment') {
          upfront += a.method === 'cash' ? a.spec.purchasePrice : a.method === 'loan' ? a.spec.purchasePrice * company.finance.newLoan.downPaymentFraction : 0;
        }
      }
      expect(upfront, c.id).toBeLessThanOrEqual(company.finance.startingCash + company.finance.lineOfCredit.limit);
      const runs = seeds.map((s) => run(sc, s, c.actions));
      let missed = 0;
      runs.forEach((r, i) => {
        expect(r.events.filter((e) => e.type === 'action-rejected'), c.id).toHaveLength(0);
        const b = base[i].totals;
        if (b.shortfallDays > 0) expect(r.totals.shortfallDays, c.id).toBeLessThanOrEqual(b.shortfallDays);
        else expect(r.totals.minCash, c.id).toBeGreaterThanOrEqual(-0.005);
        missed += r.totals.missedJobRate / K;
      });
      expect(missed, c.id).toBeLessThanOrEqual(Math.max(0.05, baseMissed + 0.005) + 1e-12);
      // Recommended means improvement in at least 70% of seeds.
      const better = runs.filter((r, i) => r.totals.income.netProfit > base[i].totals.income.netProfit).length;
      expect(better / K, c.id).toBeGreaterThanOrEqual(0.7);
    }
  });
});
