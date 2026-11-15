/**
 * E8: outputs (years, customerStats, scheduled/completed hours, quits) and scaling helpers
 * (simulation-design §8; implementation-contracts §3 row "Scaling helpers").
 */
import { describe, expect, it } from 'vitest';
import { hashRank, runSimulation, scaleCustomerBase, theoreticalWeeklyCapacity, type Scenario } from '../../src/simulation';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { deterministicCompany, employee, scenario, vehicle } from './helpers';
import { stochasticMid } from './scenarios';

describe('outputs', () => {
  it('customerStats (full only) add up to the job-type statistics and totals', () => {
    const s = { ...stochasticMid(3), horizonDays: 200 };
    const r = runSimulation(s);
    const cs = Object.values(r.customerStats!);
    const jt = Object.values(r.jobTypeStats);
    const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
    for (const k of ['revenue', 'laborCost', 'materials', 'fuel', 'onSiteHours', 'travelHours'] as const) {
      expect(sum(cs, (x) => x[k])).toBeCloseTo(sum(jt, (x) => x[k]), 6);
    }
    expect(sum(cs, (x) => x.jobsCompleted)).toBe(r.totals.ops.jobsCompleted);
    expect(sum(cs, (x) => x.jobsCancelled)).toBe(r.totals.ops.jobsCancelled);
    for (const x of cs) expect(x.contribution).toBeCloseTo(x.revenue - x.laborCost - x.materials - x.fuel, 9);
    // every customer ever present has an entry, including acquired ones
    expect(Object.keys(r.customerStats!).sort()).toEqual(r.customers!.map((c) => c.id).sort());
    expect(runSimulation(s, { detail: 'summary' }).customerStats).toBeUndefined();
  });

  it('years tile the horizon in 365-day blocks and sum to the totals', () => {
    const s = { ...stochasticMid(1), horizonDays: 800 };
    const r = runSimulation(s, { detail: 'summary' });
    expect(r.years.map((y) => [y.startDay, y.endDay])).toEqual([
      [0, 364],
      [365, 729],
      [730, 799],
    ]);
    for (const k of ['revenue', 'netProfit', 'directLabor'] as const) {
      expect(r.years.reduce((a, y) => a + y.income[k], 0)).toBeCloseTo(r.totals.income[k], 6);
    }
    expect(r.years.reduce((a, y) => a + y.ops.quits, 0)).toBe(r.totals.ops.quits);
    expect(r.years[2].balance).toEqual(r.totals.balance);
  });

  it('scheduledHours = active employees × shift on workdays (deterministic: 2 × 8 × 5 per week)', () => {
    const r = runSimulation(scenario(deterministicCompany(), { horizonDays: 14 }));
    expect(r.totals.ops.scheduledHours).toBe(2 * 8 * 10);
  });
});

describe('scaleCustomerBase', () => {
  const s = createDemoTwinScenario() as Scenario;
  const ids = (x: Scenario) => x.company.customers.map((c) => c.id);

  it('m = 1 is the identity and the input is not mutated', () => {
    const before = structuredClone(s);
    expect(scaleCustomerBase(s, 1)).toEqual(s);
    scaleCustomerBase(s, 2.5);
    expect(s).toEqual(before);
  });

  it('nesting: for m1 < m2 the customer set of m1 is a subset of that of m2', () => {
    const ms = [0, 0.1, 0.35, 0.5, 0.8, 0.999, 1, 1.2, 1.5, 1.99, 2, 2.3, 3.7];
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const big = new Set(ids(scaleCustomerBase(s, ms[j])));
        for (const id of ids(scaleCustomerBase(s, ms[i]))) expect(big.has(id), `${id} in m=${ms[i]} not in m=${ms[j]}`).toBe(true);
      }
  });

  it('integer m adds exactly (m − 1) clones per customer; m = 0 keeps none', () => {
    expect(scaleCustomerBase(s, 0).company.customers).toEqual([]);
    const two = scaleCustomerBase(s, 2);
    expect(two.company.customers.length).toBe(200);
    expect(ids(two).filter((id) => id.endsWith('#1')).length).toBe(100);
    expect(scaleCustomerBase(s, 3).company.customers.length).toBe(300);
  });

  it('clones copy size and plan, sit within 0.15 miles, and do not depend on the seed', () => {
    const a = scaleCustomerBase(s, 2);
    const b = scaleCustomerBase({ ...s, seed: 999 }, 2);
    expect(b.company.customers).toEqual(a.company.customers);
    const byId = new Map(s.company.customers.map((c) => [c.id, c]));
    for (const c of a.company.customers) {
      if (!c.id.includes('#')) continue;
      const o = byId.get(c.id.split('#')[0])!;
      expect(c.sizeFactor).toBe(o.sizeFactor);
      expect(c.recurringJobTypeId).toBe(o.recurringJobTypeId);
      expect(Math.hypot(c.x - o.x, c.y - o.y)).toBeLessThanOrEqual(0.15 + 1e-12);
      expect(c.phase).toBeGreaterThanOrEqual(0);
      expect(c.phase).toBeLessThan(1);
    }
  });

  it('a scaled scenario validates and simulates', () => {
    expect(runSimulation(scaleCustomerBase(s, 1.4), { detail: 'summary' }).days.length).toBe(90);
  });
});

describe('theoreticalWeeklyCapacity (hand-computed)', () => {
  it('one crew of two, productivity 1, no coordination loss: 2 × 8 h × 5 days = 80', () => {
    expect(theoreticalWeeklyCapacity(scenario(deterministicCompany()))).toBe(80);
  });
  it('seats cap the crew (highest skill first): 1 seat ⇒ 1 × 8 × 5 = 40', () => {
    const co = deterministicCompany({ vehicles: [vehicle('v1', { seats: 1 })] });
    expect(theoreticalWeeklyCapacity(scenario(co))).toBe(40);
  });
  it('three members, coordination 0.1, learning G 0.1 L 100 at tenure 1000: 3 × (1 + 0.1(1 − e^−10)) × 0.8 × 40', () => {
    const base = deterministicCompany({ employees: [employee('e1', 'c1'), employee('e2', 'c1'), employee('e3', 'c1')] });
    const co = { ...base, workforce: { ...base.workforce, crewSizeCoordinationLoss: 0.1, learningGain: 0.1, learningDays: 100 } };
    const learn = 1 + 0.1 * (1 - Math.exp(-10));
    expect(theoreticalWeeklyCapacity(scenario(co))).toBeCloseTo(3 * learn * 0.8 * 40, 9);
  });
  it('crews without a vehicle count zero', () => {
    const co = deterministicCompany({ crews: [{ id: 'c1', name: 'c', vehicleId: null }] });
    expect(theoreticalWeeklyCapacity(scenario(co))).toBe(0);
  });
});

describe('scaling rank spreads short sequential ids (ADR-009)', () => {
  // Independent murmur3 fmix32 and FNV-1a, written out here.
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  };
  const fmix32 = (h: number) => {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const ids = Array.from({ length: 100 }, (_, i) => `c${String(i + 1).padStart(3, '0')}`);

  it('hashRank equals fmix32(FNV-1a) / 2^32', () => {
    for (const id of ['c001', 'c050', 'x#1']) expect(hashRank(id)).toBe(fmix32(fnv(id)) / 4294967296);
  });

  it('kept share tracks m within ±0.12 for c001…c100', () => {
    for (const m of [0.2, 0.4, 0.6, 0.8]) {
      const kept = ids.filter((id) => hashRank(id) < m).length / ids.length;
      expect(Math.abs(kept - m)).toBeLessThanOrEqual(0.12);
    }
  });
});
