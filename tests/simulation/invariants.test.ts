import { describe, expect, it } from 'vitest';
import { runSimulation } from '../../src/simulation';
import { assertInvariants } from './invariants';
import { allActions, financedAndLeased, stochasticMid, tinyDeterministic } from './scenarios';

describe('invariants hold on every day', () => {
  it('deterministic tiny company', () => {
    const s = tinyDeterministic();
    const r = runSimulation(s);
    assertInvariants(s, r);
    expect(r.totals.ops.jobsCompleted).toBeGreaterThan(0);
  });

  for (const seed of [1, 2, 3, 42, 2024]) {
    it(`stochastic mid-size company, seed ${seed}`, () => {
      const s = stochasticMid(seed);
      const r = runSimulation(s);
      assertInvariants(s, r);
      // the scenario really is stochastic
      const t = r.totals.ops;
      expect(t.absentShifts).toBeGreaterThan(0);
      expect(t.leads).toBeGreaterThan(0);
      expect(t.churnedCustomers).toBeGreaterThan(0);
      expect(r.days.some((d) => d.weather !== 'clear')).toBe(true);
      expect(r.totals.income.badDebt + r.totals.income.revenue).toBeGreaterThan(0);
    });
  }

  it('stochastic company in summary mode', () => {
    const s = stochasticMid(7);
    const r = runSimulation(s, { detail: 'summary' });
    expect(r.crewLogs).toBeUndefined();
    expect(r.customers).toBeUndefined();
    assertInvariants(s, r);
  });

  it('financed + leased assets (loan paid off, asset fully depreciated mid-run)', () => {
    const s = financedAndLeased();
    const r = runSimulation(s);
    assertInvariants(s, r);
    const last = r.days[r.days.length - 1].balance;
    expect(last.loanBalance).toBe(0);
    expect(r.totals.cashFlow.principalPaid).toBeCloseTo(25000, 6);
    expect(r.totals.income.equipmentLeases).toBeGreaterThan(0);
  });

  it('every action type at mixed days', () => {
    const s = allActions();
    const r = runSimulation(s);
    assertInvariants(s, r);
    const applied = r.events.filter((e) => e.type === 'action-applied').length;
    const rejected = r.events.filter((e) => e.type === 'action-rejected');
    expect(rejected.map((e) => e.type === "action-rejected" && e.reason)).toEqual(["unknown crew nope", "unknown employee ghost", "unknown crew c2"]);
    expect(applied).toBe(s.actions.length - 3);
    const types = new Set(s.actions.map((a) => a.action.type));
    expect(types.size).toBe(10);
    expect(r.totals.cashFlow.capex).toBeGreaterThan(0);
    expect(r.crewStats['crew-d15-4']).toBeDefined();
  });
});
