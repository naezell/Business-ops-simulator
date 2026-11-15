/**
 * Task O3: contract amendments of optimization-engine §3, §5, §6, §7 and the required
 * tests §8.10 (customer-loss guard) and §8.11 (plan diversity). Expected values are
 * computed by hand or by simulating the actions directly in the test.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation } from '../../src/simulation';
import type { PlannedAction, Scenario } from '../../src/simulation';
import {
  Evaluator,
  POOL_SIZE,
  assumptionSentence,
  beamSearch,
  cashSeverity,
  evaluateOption,
  isAssumptionSensitive,
  minEndCustomers,
  optimize,
  planPool,
  rankEvaluations,
  simulatedReasons,
  singleOption,
} from '../../src/optimization';
import type { CandidateDef, CandidateEvaluation, ResolvedConstraints, RunSummary, SearchContext } from '../../src/optimization';
import { customer, deterministicCompany, jobType, scenario } from '../simulation/helpers';
import { capacityBound, request, smallCatalog, withActions } from './scenarios';

const constraints = (over: Partial<ResolvedConstraints> = {}): ResolvedConstraints => ({
  minCashFloor: 0,
  maxMissedJobRate: 0.05,
  maxCustomerLossFraction: 0.1,
  minProbabilityOfImprovement: 0.7,
  ...over,
});

function summary(endActiveCustomers: number): RunSummary {
  return {
    seed: 1,
    income: {} as RunSummary['income'],
    netProfit: 0,
    endingCash: 0,
    revenue: 0,
    minCash: 100,
    shortfallDays: 0,
    utilization: 0,
    missedJobRate: 0,
    jobsCompleted: 0,
    jobsCancelled: 0,
    endActiveCustomers,
    cashSeries: new Float64Array(0),
    rejected: [],
    unserved: {} as RunSummary['unserved'],
    lostRevenue: 0,
    idleHours: 0,
    paidHours: 0,
    jobTypes: {},
  };
}

describe('§3 cash-constraint severity', () => {
  it('is 1 with any shortfall day, else 0.25 × (reserve − minCash) / reserve', () => {
    expect(cashSeverity(0.2, 5000, 10000)).toBe(1);
    // reserve 10,000, lowest cash 6,000: 0.25 × 4,000 / 10,000 = 0.1.
    expect(cashSeverity(0, 6000, 10000)).toBeCloseTo(0.1, 12);
    // cash touches 0 without a shortfall: 0.25 × 10,000 / 10,000 = 0.25.
    expect(cashSeverity(0, 0, 10000)).toBeCloseTo(0.25, 12);
    expect(cashSeverity(0, 10000, 10000)).toBe(0);
  });
});

describe('§5 customer-loss constraint (unit)', () => {
  it('floor = (1 − fraction) × baseline ending customers', () => {
    expect(minEndCustomers(200, 0.1)).toBeCloseTo(180, 12);
    expect(minEndCustomers(200, 0.25)).toBeCloseTo(150, 12);
  });

  it('rejects a seed mean strictly below the floor and accepts one at it', () => {
    // Baseline mean (100 + 100) / 2 = 100 → floor 90. Candidate means: (88 + 90) / 2 = 89 (below), (90 + 90) / 2 = 90 (at).
    const base = [summary(100), summary(100)];
    const below = simulatedReasons([summary(88), summary(90)], base, constraints());
    expect(below).toHaveLength(1);
    expect(below[0]).toMatch(/Active customers at the end fall to 89 from 100/);
    expect(simulatedReasons([summary(90), summary(90)], base, constraints())).toEqual([]);
    // A looser constraint (20%) accepts 89.
    expect(simulatedReasons([summary(88), summary(90)], base, constraints({ maxCustomerLossFraction: 0.2 }))).toEqual([]);
  });
});

describe('§7 assumption sensitivity', () => {
  it('is true for any plan with a pricing, marketing or service-mix member', () => {
    expect(isAssumptionSensitive([{ category: 'pricing' }])).toBe(true);
    expect(isAssumptionSensitive([{ category: 'marketing' }])).toBe(true);
    expect(isAssumptionSensitive([{ category: 'service-mix' }])).toBe(true);
    expect(isAssumptionSensitive([{ category: 'crew' }, { category: 'pricing' }])).toBe(true);
    expect(isAssumptionSensitive([{ category: 'crew' }, { category: 'staffing' }, { category: 'scheduling' }])).toBe(false);
  });

  it('the closing sentence names the assumptions, the customer change and the horizon', () => {
    const s = assumptionSentence(-12.4, 365);
    expect(s).toMatch(/illustrative price-sensitivity and marketing-response assumptions/);
    expect(s).toMatch(/loses 12 active customers/);
    expect(s).toMatch(/after the 365-day horizon/);
    expect(assumptionSentence(1, 90)).toMatch(/adds 1 active customer by the end/);
  });
});

/**
 * §8.10 A single crew with ample time serves 60 weekly $60 lawns. Monthly churn 2% with
 * retention elasticity 10: a +15% price multiplies churn by 1.15^10 ≈ 4.05 (≈ 8.1% a
 * month), so over 84 days the business keeps ≈ 79% of customers instead of ≈ 94.5%,
 * about 16% fewer, while each remaining job pays 15% more and costs the same.
 */
function churnSensitive(): Scenario {
  const det = deterministicCompany();
  return scenario(
    deterministicCompany({
      jobTypes: [jobType({ id: 'mow', basePrice: 60 })],
      customers: Array.from({ length: 60 }, (_, i) => customer(`k${i}`, 2, 2, 'mow', { phase: (i % 5) / 7 })),
      market: { ...det.market, baseMonthlyChurn: 0.02, retentionPriceElasticity: 10 },
      finance: { ...det.finance, startingCash: 1_000_000 },
    }),
    { horizonDays: 84, seed: 11 },
  );
}

describe('§8.10 customer-loss guard', () => {
  const sc = churnSensitive();
  const K = 3;
  const seeds = Array.from({ length: K }, (_, i) => sc.seed + 7919 * i);
  const rise: PlannedAction[] = [{ day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.15 } }];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const base = seeds.map((s) => runSimulation(withActions(sc, s, []), { detail: 'summary' }).totals);
  const cand = seeds.map((s) => runSimulation(withActions(sc, s, rise), { detail: 'summary' }).totals);

  it('precondition (direct simulation): the +15% rise raises in-horizon profit but loses more than 10% of customers', () => {
    expect(mean(cand.map((c, i) => c.income.netProfit - base[i].income.netProfit))).toBeGreaterThan(0);
    expect(mean(cand.map((c) => c.endActiveCustomers))).toBeLessThan(0.9 * mean(base.map((b) => b.endActiveCustomers)));
  });

  const req = request(sc, smallCatalog(), { seedCount: K, maxPlanSize: 1 });
  const guarded = optimize(req);
  const unguarded = optimize({ ...req, constraints: { maxCustomerLossFraction: 1 } });

  it('puts the rise in infeasible with a customer-loss reason, never in candidates', () => {
    const inf = guarded.infeasible.find((c) => c.id === 'price:all:1.15');
    expect(inf).toBeDefined();
    expect(inf!.infeasibleReasons.some((r) => /Active customers at the end fall/.test(r))).toBe(true);
    expect(guarded.candidates.some((c) => c.id === 'price:all:1.15')).toBe(false);
    // Δ ending customers is the paired mean of the direct runs over the seeds it was evaluated on
    // (an infeasible screened candidate stops after the first SCREEN_SEEDS seeds).
    const n = inf!.seedsEvaluated;
    expect(n).toBeGreaterThan(0);
    const direct = cand.slice(0, n).map((c, i) => c.endActiveCustomers - base[i].endActiveCustomers);
    expect(inf!.deltaEndCustomers.mean).toBeCloseTo(mean(direct), 9);
    expect(guarded.baseline.endCustomers).toBeCloseTo(mean(base.map((b) => b.endActiveCustomers)), 9);
  });

  it('without the guard the same rise is feasible and recommended (the guard is the only cause)', () => {
    const c = unguarded.candidates.find((x) => x.id === 'price:all:1.15');
    expect(c).toBeDefined();
    expect(c!.recommended).toBe(true);
    expect(c!.assumptionSensitive).toBe(true);
    expect(c!.explanation[c!.explanation.length - 1]).toMatch(/illustrative price-sensitivity/);
  });
});

/**
 * §8.11 capacityBound (all elasticities 0, deterministic): every price rise is pure gain,
 * and an hour of daily overtime turns cancelled work into revenue. Ten "all prices"
 * points (+21% … +30%, one conflict key) each beat the overtime policy alone, so the ten
 * best singles share a key; the best plan must still pair a price rise with overtime.
 */
describe('§8.11 plan diversity', () => {
  const sc = capacityBound();
  const seeds = [sc.seed];
  const priceDefs: CandidateDef[] = Array.from({ length: 10 }, (_, i) => {
    const m = Math.round((1.21 + 0.01 * i) * 100) / 100;
    return {
      id: `price:all:${m}`,
      label: `Prices ×${m}`,
      category: 'pricing',
      actions: [{ day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: m } }],
      conflictKey: 'price:all',
    };
  });
  const overtime: CandidateDef = {
    id: 'policy:maxOvertimeHoursPerDay:1',
    label: 'Allow 1 h overtime',
    category: 'scheduling',
    actions: [{ day: 0, action: { type: 'set-policy', patch: { maxOvertimeHoursPerDay: 1 } } }],
    conflictKey: 'policy:maxOvertimeHoursPerDay',
  };
  const defs = [...priceDefs, overtime];
  const ctx: SearchContext = {
    company: sc.company,
    horizonDays: sc.horizonDays,
    objective: 'net-profit',
    seeds,
    evaluator: new Evaluator(sc),
    constraints: constraints(),
  };
  const ranked = rankEvaluations(
    defs.map((d) => evaluateOption(ctx, singleOption(d), seeds)),
    'net-profit',
  );
  const defById = new Map(defs.map((d) => [d.id, d]));

  const profit = (actions: PlannedAction[]) => runSimulation(withActions(sc, sc.seed, actions), { detail: 'summary' }).totals.income.netProfit;
  const p0 = profit([]);

  it('precondition (direct simulation): the ten best singles are all price points, and price + overtime beats both', () => {
    const gains = defs.map((d) => ({ id: d.id, gain: profit(d.actions) - p0 }));
    for (const g of gains) expect(g.gain, g.id).toBeGreaterThan(0);
    const ot = gains.find((g) => g.id === overtime.id)!.gain;
    for (const g of gains) if (g.id !== overtime.id) expect(g.gain, g.id).toBeGreaterThan(ot);
    const bestPrice = priceDefs[9];
    const combo = profit([...bestPrice.actions, ...overtime.actions]) - p0;
    const best = gains.find((g) => g.id === bestPrice.id)!.gain;
    expect(combo).toBeGreaterThan(best + Math.max(100, 0.01 * best));
    // So a pool of the ten best singles would contain only one conflict key.
    expect(new Set(ranked.slice(0, POOL_SIZE).map((e) => defById.get(e.id)!.conflictKey))).toEqual(new Set(['price:all']));
  });

  it('the pool keeps the best single per conflict key', () => {
    const pool = planPool(ranked, defById);
    expect(pool.map((e) => e.id)).toEqual(['price:all:1.3', overtime.id]);
  });

  it('bestPlan combines a price rise with overtime', () => {
    const out = beamSearch(ctx, ranked, defById, 3, 3);
    expect(out.bestPlan).not.toBeNull();
    const types = out.bestPlan!.actions.map((a) => a.action.type).sort();
    expect(types).toEqual(['set-policy', 'set-price']);
    expect(out.bestPlan!.assumptionSensitive).toBe(true);
  });
});

describe('§7 explanation and Δ customers on a real run', () => {
  it('only assumption-sensitive candidates end with the assumption sentence', () => {
    const sc = churnSensitive();
    const r = optimize(request(sc, smallCatalog(), { seedCount: 2, maxPlanSize: 1 }));
    const all: CandidateEvaluation[] = [...r.candidates, ...r.infeasible];
    expect(all.length).toBeGreaterThan(5);
    for (const c of all) {
      const sensitive = ['pricing', 'marketing', 'service-mix'].includes(c.category);
      expect(c.assumptionSensitive, c.id).toBe(sensitive);
      const last = c.explanation[c.explanation.length - 1];
      expect(/illustrative price-sensitivity/.test(last), c.id).toBe(sensitive);
    }
  });
});
