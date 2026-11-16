/**
 * Pre-drawn draw tables (src/simulation/schedule.ts) are a performance device only: results must be
 * bit-identical to drawing every customer every day, with or without a shared DrawCache.
 */
import { describe, expect, it } from 'vitest';
import {
  STREAM,
  createDrawCache,
  dailyHazardFromMonthly,
  hashString,
  rand01,
  runSimulation,
  type Scenario,
} from '../../src/simulation';
import { CHURN_SCHEDULE_MAX_U, SCHEDULE_MAX_P, initialChurnTable, initialOneOffTable } from '../../src/simulation/schedule';
import { allActions, stochasticMid } from './scenarios';

describe('draw tables match direct draws', () => {
  it('the one-off table lists exactly the draws below SCHEDULE_MAX_P, with their exact values', () => {
    const seed = 17;
    const ids = ['k0', 'k1', 'c-d4-0', 'a:b'];
    const types = [
      { idx: 2, id: 'cleanup' },
      { idx: 5, id: 'install' },
    ];
    const H = 400;
    const t = initialOneOffTable(seed, ids, types, H, null);
    const expected: string[] = [];
    for (let d = 0; d < H; d++) {
      for (let ci = 0; ci < ids.length; ci++) {
        for (const ty of types) {
          const u = rand01(seed, STREAM.ONEOFF_DEMAND, hashString(ids[ci] + ':' + ty.id), d, 0);
          if (u < SCHEDULE_MAX_P) expected.push(`${d}|${ci}|${ty.idx}|${u}`);
        }
      }
    }
    const got: string[] = [];
    for (let d = 0; d < H; d++) {
      for (let k = t.start[d]; k < t.start[d + 1]; k++) got.push(`${d}|${t.cust[k]}|${t.jt[k]}|${t.us[k]}`);
    }
    expect(got.sort()).toEqual(expected.sort());
    // ≈ 2% of 4 × 2 × 400 = 64 entries expected.
    expect(got.length).toBeGreaterThan(30);
  });

  it('the churn table lists the CHURN draws below its bound, in customer order within each day', () => {
    const ids = ['x1', 'x2', 'x3'];
    const t = initialChurnTable(5, ids, 365, null);
    for (let d = 0; d < 365; d++) {
      const want: string[] = [];
      ids.forEach((id, ci) => {
        const u = rand01(5, STREAM.CHURN, hashString(id), d, 0);
        if (u < CHURN_SCHEDULE_MAX_U) want.push(`${ci}|${u}`);
      });
      const got: string[] = [];
      for (let k = t.start[d]; k < t.start[d + 1]; k++) got.push(`${t.cust[k]}|${t.us[k]}`);
      expect(got).toEqual(want);
    }
  });

  it('the churn bound covers the largest possible daily hazard (monthly churn clamped to 0.5)', () => {
    // 1 − 0.5^(1/30) = 0.022840...
    expect(dailyHazardFromMonthly(0.5)).toBeCloseTo(1 - Math.pow(0.5, 1 / 30), 12);
    expect(CHURN_SCHEDULE_MAX_U).toBeGreaterThanOrEqual(dailyHazardFromMonthly(0.5));
  });
});

describe('runs with a shared DrawCache are identical to runs without', () => {
  const scenarios: [string, () => Scenario][] = [
    ['stochastic mid', () => stochasticMid(3)],
    ['all actions', () => allActions()],
    [
      'one-off price above the table bound on some days (direct-draw path)',
      () => {
        const s = stochasticMid(8);
        // cleanup: 1.5 × 2 / 365 × 0.5^(−1.5) ≈ 0.0232 > SCHEDULE_MAX_P in its peak month.
        s.company.market.oneOffPriceElasticity = 1.5;
        s.company.pricing = { ...s.company.pricing, byJobType: { ...s.company.pricing.byJobType, cleanup: 0.5 } };
        s.actions = [{ day: 120, action: { type: 'set-price', jobTypeId: 'cleanup', multiplier: 1.4 } }];
        return s;
      },
    ],
    [
      'one-off type withdrawn and re-offered mid-run',
      () => {
        const s = stochasticMid(12);
        s.actions = [
          { day: 30, action: { type: 'set-job-type-offered', jobTypeId: 'cleanup', offered: false } },
          { day: 90, action: { type: 'set-job-type-offered', jobTypeId: 'cleanup', offered: true } },
        ];
        return s;
      },
    ],
  ];

  for (const [name, make] of scenarios) {
    it(name, () => {
      const cache = createDrawCache();
      const plain = runSimulation(make());
      expect(runSimulation(make(), { drawCache: cache })).toEqual(plain);
      // Second run hits the cache.
      expect(runSimulation(make(), { drawCache: cache })).toEqual(plain);
      expect(runSimulation(make(), { detail: 'summary', drawCache: cache }).totals).toEqual(plain.totals);
    });
  }

  it('one cache serves different seeds and horizons without mixing them up', () => {
    const cache = createDrawCache();
    for (const seed of [1, 2, 1]) {
      for (const H of [200, 120]) {
        const s = stochasticMid(seed);
        s.horizonDays = H;
        expect(runSimulation(s, { detail: 'summary', drawCache: cache })).toEqual(runSimulation(s, { detail: 'summary' }));
      }
    }
  });
});
