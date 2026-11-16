/**
 * Shocks (digital-twin simulation-design §2; implementation-contracts §3 "Shocks" row, common B–D, F; B8).
 * Expected values are derived by hand in the comments, never from the engine's own output.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, validateScenario, type Scenario, type Shock, type SimulationResult } from '../../src/simulation';
import { assertInvariants } from './invariants';
import { customer, deterministicCompany, scenario } from './helpers';
import { stochasticMid, tinyDeterministic } from './scenarios';

const withShocks = (s: Scenario, shocks: Shock[]): Scenario => ({ ...s, shocks });
const sum = (r: SimulationResult, f: (d: SimulationResult['days'][number]) => number) => r.days.reduce((a, d) => a + f(d), 0);

describe('shocks: deterministic behaviour', () => {
  it('fuel-price × 1.3 raises fuel by exactly 30% and changes nothing else operational', () => {
    const base = tinyDeterministic();
    const s = { ...base, company: { ...base.company, costs: { ...base.company.costs, fuelPricePerGallon: 3 } } };
    const a = runSimulation(s);
    const b = runSimulation(withShocks(s, [{ type: 'multiplier', target: 'fuel-price', factor: 1.3, fromDay: 0, toDay: s.horizonDays }]));
    expect(a.totals.income.fuel).toBeGreaterThan(0);
    // fuel_b = Σ gallons × (3 × 1.3) = 1.3 × fuel_a
    expect(b.totals.income.fuel).toBeCloseTo(1.3 * a.totals.income.fuel, 6);
    expect(b.totals.ops).toEqual(a.totals.ops);
    expect(b.totals.income.revenue).toBe(a.totals.income.revenue);
    // profit falls by exactly the extra fuel (0.3 × fuel_a)
    expect(a.totals.income.netProfit - b.totals.income.netProfit).toBeCloseTo(0.3 * a.totals.income.fuel, 6);
    assertInvariants(withShocks(s, [{ type: "multiplier", target: "fuel-price", factor: 1.3, fromDay: 0, toDay: s.horizonDays }]), b);
  });

  it('an outage of the only truck stops the crew for exactly the window', () => {
    // One crew, one truck; customers need a visit every workday so the crew deploys whenever it can.
    const company = deterministicCompany({
      customers: Array.from({ length: 10 }, (_, i) => customer(`k${i}`, 1 + i * 0.1, 0, 'mow', { phase: i / 10 })),
    });
    const s = scenario(company, { horizonDays: 28 });
    const shocked = withShocks(s, [{ type: 'outage', assetId: 'v1', fromDay: 7, toDay: 12 }]);
    const r = runSimulation(shocked);
    assertInvariants(shocked, r);
    const logs = r.crewLogs!;
    for (let d = 0; d < 28; d++) {
      if (!r.days[d].isWorkday) continue;
      const log = logs[d][0];
      // Days 7–11 (Mon 7 … Fri 11): vehicle missing. Every other workday the crew finds work.
      if (d >= 7 && d < 12) expect([d, log.notDeployedReason]).toEqual([d, 'vehicle']);
      else expect([d, log.deployed]).toEqual([d, true]);
    }
    // No repair cost: an outage is not a breakdown.
    expect(r.totals.income.maintenance).toBe(0);
    expect(r.events.filter((e) => e.type === 'vehicle-breakdown')).toEqual([]);
  });

  it('forced weather days show the forced state; other days keep their draw', () => {
    const s = tinyDeterministic();
    const r = runSimulation(withShocks(s, [{ type: 'weather', state: 'rainout', fromDay: 3, toDay: 6 }]));
    expect(r.days.slice(3, 6).map((d) => d.weather)).toEqual(['rainout', 'rainout', 'rainout']);
    // rainout probability is 0 in the deterministic company
    expect(r.days.filter((_d, i) => i < 3 || i >= 6).every((d) => d.weather === 'clear')).toBe(true);
  });

  it('B8: demand × 0.8 cuts recurring visits created to the hand-computed count', () => {
    // One customer, weekly plan (interval 7, seasonality 1), phase 0, 28 days.
    // Unshocked: accrual 1/7 per day → orders on days 6, 13, 20, 27 → 4.
    // Shocked: accrual 0.8/7 per day → total accrual after 28 days = 3.2 → floor = 3 orders
    // (crossings after day k where 0.8(k+1)/7 ≥ n: k = 8, 17, 26).
    const s = scenario(deterministicCompany({ customers: [customer('k', 1, 0)] }), { horizonDays: 28 });
    const a = runSimulation(s);
    const b = runSimulation(withShocks(s, [{ type: 'multiplier', target: 'demand', factor: 0.8, fromDay: 0, toDay: 28 }]));
    expect(a.totals.ops.jobsCreated).toBe(4);
    expect(b.totals.ops.jobsCreated).toBe(3);
    const created = (r: SimulationResult) => r.days.filter((d) => d.ops.jobsCreated > 0).map((d) => d.day);
    expect(created(a)).toEqual([6, 13, 20, 27]);
    expect(created(b)).toEqual([8, 17, 26]);
  });

  it('collection-days × 2 doubles the collection delay of invoices issued in the window', () => {
    // mean 5, jitter 0 → delay 5; shocked delay round(5 × 2) = 10.
    const base = deterministicCompany({ customers: [customer('k', 1, 0)] });
    const company = { ...base, finance: { ...base.finance, ar: { collectionDaysMean: 5, collectionDaysJitter: 0, badDebtRate: 0 } } };
    const s = scenario(company, { horizonDays: 28 });
    const b = runSimulation(withShocks(s, [{ type: 'multiplier', target: 'collection-days', factor: 2, fromDay: 0, toDay: 28 }]));
    // completed on day 6 (Sunday? day 6 is Sunday: not a workday) — find completion days instead.
    const completed = b.days.filter((d) => d.income.revenue > 0).map((d) => d.day);
    const collected = b.days.filter((d) => d.cashFlow.collections > 0).map((d) => d.day);
    expect(collected).toEqual(completed.map((d) => d + 10).filter((d) => d < 28));
  });

  it('shock-started and shock-ended events are emitted on the window edges', () => {
    const s = tinyDeterministic();
    const r = runSimulation(withShocks(s, [{ type: 'multiplier', target: 'leads', factor: 2, fromDay: 0, toDay: 10 }]));
    const ev = r.events.filter((e) => e.type === 'shock-started' || e.type === 'shock-ended');
    expect(ev).toEqual([
      { day: 0, type: 'shock-started', shockIndex: 0 },
      { day: 10, type: 'shock-ended', shockIndex: 0 },
    ]);
  });
});

describe('shocks: randomness rules (monotonicity, prefix identity, determinism, CRN)', () => {
  const H = 120;
  const base = (seed: number) => ({ ...stochasticMid(seed), horizonDays: H });

  /** Absent employee ids per day from crew logs (both runs use the same employees: absence touches nothing upstream). */
  const absences = (r: SimulationResult) => r.crewLogs!.map((day) => new Set(day.flatMap((l) => l.absentIds)));

  for (const seed of [1, 2, 3]) {
    it(`absence × 1.5 only adds absences; × 0.5 only removes them (seed ${seed})`, () => {
      const s = base(seed);
      const a = absences(runSimulation(s));
      const up = absences(runSimulation(withShocks(s, [{ type: 'multiplier', target: 'absence', factor: 1.5, fromDay: 0, toDay: H }])));
      const down = absences(runSimulation(withShocks(s, [{ type: 'multiplier', target: 'absence', factor: 0.5, fromDay: 0, toDay: H }])));
      let added = 0;
      for (let d = 0; d < H; d++) {
        for (const id of a[d]) expect(up[d].has(id)).toBe(true);
        for (const id of down[d]) expect(a[d].has(id)).toBe(true);
        added += up[d].size - a[d].size;
      }
      expect(added).toBeGreaterThan(0);
    });
  }

  it('breakdown and turnover × 3 on one day only add events on that day', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = base(seed);
      const d = 40;
      const pick = (r: SimulationResult) =>
        new Set(r.events.filter((e) => e.day === d && (e.type === 'vehicle-breakdown' || e.type === 'equipment-breakdown' || e.type === 'employee-quit')).map((e) => JSON.stringify({ ...e, cost: undefined, downDays: undefined })));
      const a = pick(runSimulation(s));
      const b = pick(
        runSimulation(
          withShocks(s, [
            { type: 'multiplier', target: 'vehicle-breakdown', factor: 3, fromDay: d, toDay: d + 1 },
            { type: 'multiplier', target: 'equipment-breakdown', factor: 3, fromDay: d, toDay: d + 1 },
            { type: 'multiplier', target: 'turnover', factor: 3, fromDay: d, toDay: d + 1 },
          ]),
        ),
      );
      for (const k of a) expect(b.has(k)).toBe(true);
    }
  });

  it('prefix identity: a shock starting on day d leaves days < d deep-equal', () => {
    const s = base(5);
    const d = 50;
    const a = runSimulation(s);
    const b = runSimulation(
      withShocks(s, [
        { type: 'multiplier', target: 'demand', factor: 1.4, fromDay: d, toDay: d + 20 },
        { type: 'outage', assetId: s.company.vehicles[0].id, fromDay: d, toDay: d + 5 },
        { type: 'weather', state: 'rainout', fromDay: d, toDay: d + 2 },
      ]),
    );
    expect(b.days.slice(0, d)).toEqual(a.days.slice(0, d));
    expect(b.crewLogs!.slice(0, d)).toEqual(a.crewLogs!.slice(0, d));
    expect(b.events.filter((e) => e.day < d)).toEqual(a.events.filter((e) => e.day < d));
    expect(b.days[d + 1]).not.toEqual(a.days[d + 1]);
  });

  it('shocked runs are deterministic and keep every identity on every day', () => {
    for (const seed of [1, 2, 3]) {
      const s = withShocks(base(seed), [
        { type: 'multiplier', target: 'demand', factor: 1.3, fromDay: 10, toDay: 60 },
        { type: 'multiplier', target: 'fuel-price', factor: 1.5, fromDay: 0, toDay: 120 },
        { type: 'multiplier', target: 'travel-time', factor: 1.25, fromDay: 30, toDay: 70 },
        { type: 'multiplier', target: 'materials-cost', factor: 1.2, fromDay: 0, toDay: 90 },
        { type: 'multiplier', target: 'maintenance-cost', factor: 2, fromDay: 0, toDay: 120 },
        { type: 'multiplier', target: 'repair-cost', factor: 2, fromDay: 0, toDay: 120 },
        { type: 'multiplier', target: 'churn', factor: 2, fromDay: 20, toDay: 50 },
        { type: 'multiplier', target: 'leads', factor: 0.5, fromDay: 20, toDay: 50 },
        { type: 'multiplier', target: 'collection-days', factor: 1.5, fromDay: 0, toDay: 120 },
        { type: 'outage', assetId: s0(seed).company.vehicles[0].id, fromDay: 15, toDay: 25 },
        { type: 'absence', employeeIds: [s0(seed).company.employees[0].id], fromDay: 5, toDay: 40 },
        { type: 'weather', state: 'partial', fromDay: 60, toDay: 65 },
      ]);
      const r1 = runSimulation(s);
      const r2 = runSimulation(s);
      expect(r1).toEqual(r2);
      assertInvariants(s, r1);
    }
    function s0(seed: number) {
      return base(seed);
    }
  });

  it('travel-time × 1.5 raises miles driven per unit of distance (same routes on an idle-capacity company)', () => {
    // Plenty of capacity: the same stops are served, so miles scale exactly by 1.5.
    const s = tinyDeterministic();
    const a = runSimulation(s);
    const b = runSimulation(withShocks(s, [{ type: 'multiplier', target: 'travel-time', factor: 1.5, fromDay: 0, toDay: s.horizonDays }]));
    expect(sum(b, (d) => d.ops.jobsCompleted)).toBe(sum(a, (d) => d.ops.jobsCompleted));
    expect(b.totals.ops.milesDriven).toBeCloseTo(1.5 * a.totals.ops.milesDriven, 6);
  });

  it('a forced absence makes the employee absent (unpaid) regardless of the draw', () => {
    const s = tinyDeterministic();
    const r = runSimulation(withShocks(s, [{ type: 'absence', employeeIds: ['e1'], fromDay: 0, toDay: 5 }]));
    for (let d = 0; d < 5; d++) {
      if (!r.days[d].isWorkday) continue;
      expect(r.crewLogs![d][0].absentIds).toEqual(['e1']);
      expect(r.days[d].ops.absentShifts).toBe(1);
    }
  });
});

describe('shocks: validation (IC §3 F)', () => {
  const s = tinyDeterministic();
  const errs = (shocks: Shock[]) => validateScenario({ ...s, shocks }).filter((i) => i.severity === 'error').map((i) => i.path);

  it('accepts well-formed shocks', () => {
    expect(
      errs([
        { type: 'multiplier', target: 'demand', factor: 0.5, fromDay: 0, toDay: 10 },
        { type: 'outage', assetId: 'v1', fromDay: 2, toDay: 3 },
        { type: 'absence', employeeIds: ['e1'], fromDay: 0, toDay: 1 },
        { type: 'weather', state: 'partial', fromDay: 0, toDay: 1 },
      ]),
    ).toEqual([]);
  });
  it('rejects toDay ≤ fromDay, negative factors, unknown targets and dangling ids', () => {
    expect(errs([{ type: 'multiplier', target: 'demand', factor: 1, fromDay: 5, toDay: 5 }])).toEqual(['shocks[0].toDay']);
    expect(errs([{ type: 'multiplier', target: 'demand', factor: -1, fromDay: 0, toDay: 5 }])).toEqual(['shocks[0].factor']);
    expect(errs([{ type: 'multiplier', target: 'nope' as never, factor: 1, fromDay: 0, toDay: 5 }])).toEqual(['shocks[0].target']);
    expect(errs([{ type: 'outage', assetId: 'ghost', fromDay: 0, toDay: 5 }])).toEqual(['shocks[0].assetId']);
    expect(errs([{ type: 'absence', employeeIds: ['e1', 'ghost'], fromDay: 0, toDay: 5 }])).toEqual(['shocks[0].employeeIds[1]']);
    expect(errs([{ type: 'multiplier', target: 'demand', factor: 1, fromDay: -1, toDay: 5 }])).toEqual(['shocks[0].fromDay']);
  });
});
