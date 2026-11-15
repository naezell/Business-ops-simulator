/** Behavioural interactions requested by the product owner. */
import { describe, expect, it } from 'vitest';
import { runSimulation, type Action, type CompanyConfig, type Scenario } from '../../src/simulation';
import { deterministicCompany, jobType, scenario, spiralCustomers, stochasticCompany } from './helpers';
import { assertInvariants } from './invariants';
import { truckSpec } from './scenarios';

function company(n: number): CompanyConfig {
  const co = deterministicCompany({ customers: spiralCustomers(n, () => 'mow', 8).map((c) => ({ ...c, sizeFactor: 1 })) });
  co.jobTypes = [jobType({ standardLaborHours: 1.5, cancelAfterDays: 14 })];
  co.policies.minPaidHoursPerShift = 4;
  co.workforce.payrollBurdenRate = 0.15;
  co.costs = { ...co.costs, fuelPricePerGallon: 3.5, stopOverheadHours: 0.1 };
  return co;
}

const addCrew: Action = {
  type: 'add-crew',
  name: 'Crew 2',
  hires: [
    { hourlyWage: 20, skill: 2, productivity: 1 },
    { hourlyWage: 20, skill: 2, productivity: 1 },
  ],
  vehicle: { spec: truckSpec, method: 'cash' },
  equipment: [],
};

function pair(co: CompanyConfig, horizon = 84): [Scenario, Scenario] {
  const base = scenario(co, { horizonDays: horizon });
  const withCrew = { ...structuredClone(base), actions: [{ day: 0, action: addCrew }] };
  return [base, withCrew];
}

const cost = (s: Scenario) => {
  const r = runSimulation(s);
  assertInvariants(s, r);
  const i = r.totals.income;
  return { r, revenue: i.revenue, cost: i.revenue - i.netProfit };
};

describe('(a) adding a crew', () => {
  it('demand-constrained: cost rises, revenue does not', () => {
    const [a, b] = pair(company(12));
    const ra = cost(a);
    const rb = cost(b);
    expect(ra.r.totals.ops.unservedHoursByReason.capacity).toBe(0);
    expect(rb.revenue).toBeCloseTo(ra.revenue, 6);
    expect(rb.cost).toBeGreaterThan(ra.cost);
    expect(rb.r.totals.income.netProfit).toBeLessThan(ra.r.totals.income.netProfit);
  });

  it('capacity-constrained: revenue rises', () => {
    const [a, b] = pair(company(140));
    const ra = cost(a);
    const rb = cost(b);
    expect(ra.r.totals.ops.unservedHoursByReason.capacity).toBeGreaterThan(0);
    expect(rb.revenue).toBeGreaterThan(ra.revenue * 1.3);
    expect(rb.r.totals.ops.jobsCompleted).toBeGreaterThan(ra.r.totals.ops.jobsCompleted);
    expect(rb.r.totals.ops.jobsCancelled).toBeLessThan(ra.r.totals.ops.jobsCancelled);
  });
});

describe('(b) raising price', () => {
  it('raises revenue per job and lowers the customer count over time', () => {
    for (const seed of [1, 2, 3]) {
      const base = scenario(stochasticCompany(60, 2), { horizonDays: 300, seed });
      const high = structuredClone(base);
      high.company.pricing.globalMultiplier *= 1.3;
      const rb = runSimulation(base, { detail: 'summary' });
      const rh = runSimulation(high, { detail: 'summary' });
      const perJob = (r: typeof rb) => r.totals.income.revenue / r.totals.ops.jobsCompleted;
      expect(perJob(rh)).toBeGreaterThan(perJob(rb));
      expect(rh.days[299].activeCustomers).toBeLessThan(rb.days[299].activeCustomers);
      expect(rh.totals.ops.newCustomers).toBeLessThanOrEqual(rb.totals.ops.newCustomers);
    }
  });

  it('a set-price increase triggers immediate shock churn', () => {
    const base = scenario(stochasticCompany(60, 2), { horizonDays: 40, seed: 4 });
    const shocked = { ...structuredClone(base), actions: [{ day: 20, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.6 } as Action }] };
    base.company.market.baseMonthlyChurn = 0;
    shocked.company.market.baseMonthlyChurn = 0;
    const r0 = runSimulation(base);
    const r1 = runSimulation(shocked);
    assertInvariants(shocked, r1);
    expect(r0.days[20].ops.churnedCustomers).toBe(0);
    expect(r1.days[20].ops.churnedCustomers).toBeGreaterThan(0);
  });
});

describe('(c) cutting shift hours when capacity-bound', () => {
  it('cuts labor cost and completed jobs', () => {
    const co = company(140);
    co.policies.minPaidHoursPerShift = 0;
    const a = scenario(co, { horizonDays: 56 });
    const b = structuredClone(a);
    b.company.policies.shiftHours = 6;
    const ra = runSimulation(a);
    const rb = runSimulation(b);
    assertInvariants(b, rb);
    expect(rb.totals.income.directLabor).toBeLessThan(ra.totals.income.directLabor);
    expect(rb.totals.ops.jobsCompleted).toBeLessThan(ra.totals.ops.jobsCompleted);
  });
});

describe('(d) vehicle breakdown', () => {
  it("reduces that day's completed jobs and adds the repair cost", () => {
    const co = company(30);
    const base = scenario(co, { horizonDays: 60, seed: 3 });
    const broken = structuredClone(base);
    broken.company.reliability.vehicle = { dailyProb: 0.05, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 1, repairCostMin: 500, repairCostMax: 500 };
    const r0 = runSimulation(base);
    const r1 = runSimulation(broken);
    assertInvariants(broken, r1);
    const ev = r1.events.find((e) => e.type === 'vehicle-breakdown');
    expect(ev).toBeDefined();
    const D = ev!.day;
    // identical until the breakdown day (no other randomness)
    expect(r1.days.slice(0, D)).toEqual(r0.days.slice(0, D));
    expect(r0.days[D].ops.jobsCompleted).toBeGreaterThan(0);
    expect(r1.days[D].ops.jobsCompleted).toBeLessThan(r0.days[D].ops.jobsCompleted);
    // maintenance per mile and per equipment hour are 0 in this company ⇒ maintenance = repair cost
    expect(r0.days[D].income.maintenance).toBe(0);
    expect(r1.days[D].income.maintenance).toBeCloseTo(500, 9);
    expect(ev!.type === 'vehicle-breakdown' && ev!.cost).toBeCloseTo(500, 9);
    expect(r1.crewLogs![D][0].notDeployedReason).toBe('vehicle');
  });
});
