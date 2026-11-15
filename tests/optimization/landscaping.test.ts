/**
 * Integration: the default optimization request on the calibrated landscaping sample
 * company. Structural sanity only; the economics are checked by the known-answer tests.
 */
import { describe, expect, it } from 'vitest';
import { landscaping } from '../../src/business/landscaping';
import { optimize } from '../../src/optimization';
import type { OptimizationResult } from '../../src/optimization';

describe('landscaping sample company, default request', () => {
  let result: OptimizationResult;

  it(
    'runs to completion',
    () => {
      result = optimize({
        scenario: { id: 'sample', name: 'Sample', company: landscaping.createSampleCompany(), actions: [], horizonDays: 365, seed: 1 },
        catalog: landscaping,
        objective: 'net-profit',
      });
      expect(result.seeds).toHaveLength(5);
    },
    120_000,
  );

  it('finds at least one bottleneck and evaluates at least 20 candidates', () => {
    expect(result.bottlenecks.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.bottlenecks.length; i++) {
      expect(result.bottlenecks[i - 1].severity).toBeGreaterThanOrEqual(result.bottlenecks[i].severity);
    }
    expect(result.candidates.length + result.infeasible.length).toBeGreaterThanOrEqual(20);
    expect(result.candidates.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps infeasible items out of the ranking and recommends only gains', () => {
    for (const c of result.candidates) {
      expect(c.feasible, c.id).toBe(true);
      expect(c.infeasibleReasons, c.id).toEqual([]);
      if (c.recommended) {
        expect(c.deltaNetProfit.mean, c.id).toBeGreaterThan(0);
        expect(c.probabilityOfImprovement, c.id).toBeGreaterThanOrEqual(0.7);
      }
    }
    for (const c of result.infeasible) {
      expect(c.feasible, c.id).toBe(false);
      expect(c.infeasibleReasons.length, c.id).toBeGreaterThan(0);
      expect(c.recommended, c.id).toBe(false);
    }
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].deltaNetProfit.mean).toBeGreaterThanOrEqual(result.candidates[i].deltaNetProfit.mean);
    }
  });

  it('bestPlan is at least as good as the best single', () => {
    const best = result.candidates[0];
    if (result.bestPlan) {
      expect(result.bestPlan.feasible).toBe(true);
      expect(result.bestPlan.deltaNetProfit.mean).toBeGreaterThanOrEqual(best.deltaNetProfit.mean);
    } else {
      expect(result.candidates.some((c) => c.recommended)).toBe(false);
    }
  });

  it('drivers sum to the mean change in net profit for every evaluation', () => {
    const all = [...result.candidates, ...result.infeasible, ...(result.bestPlan ? [result.bestPlan] : [])];
    for (const c of all) {
      const sum = c.drivers.reduce((s, d) => s + d.delta, 0);
      expect(Math.abs(sum - c.deltaNetProfit.mean), c.id).toBeLessThan(1e-6 * Math.max(1, Math.abs(c.deltaNetProfit.mean)));
    }
  });
});
