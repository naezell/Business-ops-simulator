/**
 * E4: disposal, replacement, owner distributions and the new actions (simulation-design §6;
 * implementation-contracts §3 rows "Disposal / replacement", "Owner distribution"; B6).
 * Expected values are hand-calculated in the comments.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, type CompanyConfig, type Scenario, type SimulationResult, type VehicleSpec } from '../../src/simulation';
import { assertInvariants } from './invariants';
import { customer, deterministicCompany, scenario, vehicle } from './helpers';
import { stochasticMid } from './scenarios';

const spec: VehicleSpec = {
  name: 'New truck',
  seats: 3,
  mpg: 18,
  maintenanceCostPerMile: 0,
  purchasePrice: 40000,
  usefulLifeYears: 5,
  salvageValue: 8000,
  leaseMonthly: 700,
};

/** Truck: price 30 000, life 5 y, salvage 5 000, age 1 y ⇒ opening book 30 000 − 1/5 × 25 000 = 25 000. */
function companyWithTruck(financing: CompanyConfig['vehicles'][number]['asset']['financing'] = { kind: 'owned' }): CompanyConfig {
  return deterministicCompany({
    vehicles: [vehicle('v1', { asset: { purchasePrice: 30000, usefulLifeYears: 5, salvageValue: 5000, ageYears: 1, financing } })],
  });
}

function run(s: Scenario): SimulationResult {
  const r = runSimulation(s);
  assertInvariants(s, r);
  return r;
}

describe('dispose-asset', () => {
  it('owned, day 0: proceeds 21 000, loss 4 000, NFA −25 000, equity −4 000', () => {
    // B = 25 000; P = 5 000 + 0.8 × (25 000 − 5 000) = 21 000; gain = 21 000 − 25 000 = −4 000.
    const s = scenario(companyWithTruck(), { horizonDays: 3, actions: [{ day: 0, action: { type: 'dispose-asset', assetId: 'v1' } }] });
    const r = run(s);
    const d0 = r.days[0];
    expect(d0.income.gainOnDisposal).toBeCloseTo(-4000, 9);
    expect(d0.income.depreciation).toBe(0);
    expect(d0.income.operatingProfit).toBeCloseTo(-4000, 9);
    expect(d0.cashFlow.assetSaleProceeds).toBeCloseTo(21000, 9);
    expect(d0.balance.cash).toBeCloseTo(10000 + 21000, 9);
    expect(d0.balance.netFixedAssets).toBeCloseTo(0, 9);
    // opening equity 10 000 + 25 000 = 35 000 → 31 000
    expect(d0.balance.equity).toBeCloseTo(31000, 9);
    expect(r.events.filter((e) => e.type === 'asset-disposed')).toEqual([
      { day: 0, type: 'asset-disposed', assetId: 'v1', proceeds: 21000, bookValue: 25000 },
    ]);
    // never depreciated again
    expect(r.days.every((d) => d.income.depreciation === 0)).toBe(true);
  });

  it('B6: financed, day 10: book after 10 days of depreciation, loan paid off as principal', () => {
    // daily dep = 25 000 / (5 × 365) = 13.698630…; B = 25 000 − 10 × daily; P = 5 000 + 0.8 (B − 5 000).
    const daily = (30000 - 5000) / (5 * 365);
    const B = 25000 - 10 * daily;
    const P = 5000 + 0.8 * (B - 5000);
    const s = scenario(companyWithTruck({ kind: 'loan', balance: 12000, annualRate: 0.06, monthsRemaining: 24 }), {
      horizonDays: 20,
      actions: [{ day: 10, action: { type: 'dispose-asset', assetId: 'v1' } }],
    });
    const r = run(s);
    const d = r.days[10];
    expect(d.income.gainOnDisposal).toBeCloseTo(P - B, 6);
    expect(d.cashFlow.assetSaleProceeds).toBeCloseTo(P, 6);
    // The payoff is the loan balance outstanding at the end of day 9 (independent of the payment schedule).
    const balanceBefore = r.days[9].balance.loanBalance;
    expect(d.cashFlow.principalPaid).toBeCloseTo(balanceBefore, 6);
    expect(d.balance.loanBalance).toBeCloseTo(0, 9);
    expect(d.balance.netFixedAssets).toBeCloseTo(0, 6);
    // equity change on day 10 = net profit (no distributions) and net profit includes the loss
    expect(d.balance.equity - r.days[9].balance.equity).toBeCloseTo(d.income.netProfit, 6);
    expect(r.days.slice(11).every((x) => x.cashFlow.principalPaid === 0 && x.income.interest === 0)).toBe(true);
  });

  it('leased: the lease ends, no proceeds and no gain', () => {
    const s = scenario(companyWithTruck({ kind: 'lease', monthlyPayment: 730 }), {
      horizonDays: 10,
      actions: [{ day: 4, action: { type: 'dispose-asset', assetId: 'v1' } }],
    });
    const r = run(s);
    // 730 / (365 / 12) = 24 per day for days 0–3, nothing after.
    expect(r.days.slice(0, 4).map((d) => d.income.equipmentLeases)).toEqual([24, 24, 24, 24].map((x) => expect.closeTo(x, 9)));
    expect(r.days.slice(4).every((d) => d.income.equipmentLeases === 0)).toBe(true);
    expect(r.days[4].income.gainOnDisposal).toBe(0);
    expect(r.days[4].cashFlow.assetSaleProceeds).toBe(0);
  });

  it('a disposed vehicle leaves its crew: the crew cannot deploy afterwards', () => {
    const company = deterministicCompany({ customers: [customer('k', 1, 0, 'mow', { phase: 0.99 })] });
    const s = scenario(company, { horizonDays: 14, actions: [{ day: 2, action: { type: 'dispose-asset', assetId: 'v1' } }] });
    const r = run(s);
    for (let d = 2; d < 14; d++) if (r.days[d].isWorkday) expect(r.crewLogs![d][0].notDeployedReason).toBe('vehicle');
  });

  it('rejects an unknown asset', () => {
    const s = scenario(companyWithTruck(), { horizonDays: 2, actions: [{ day: 0, action: { type: 'dispose-asset', assetId: 'ghost' } }] });
    const r = run(s);
    expect(r.events.find((e) => e.type === 'action-rejected')).toMatchObject({ reason: 'unknown asset ghost' });
  });
});

describe('replace-asset', () => {
  it("replacing the crew's truck keeps the crew deployed the same and next day; flows by hand", () => {
    const company = { ...companyWithTruck(), customers: Array.from({ length: 8 }, (_, i) => customer(`k${i}`, 1, i * 0.2, 'mow', { phase: i / 8 })) };
    const s = scenario(company, { horizonDays: 14, actions: [{ day: 3, action: { type: 'replace-asset', assetId: 'v1', spec, method: 'cash' } }] });
    const r = run(s);
    const d3 = r.days[3];
    // old truck: B = 25 000 − 3 × daily; P = 5 000 + 0.8 (B − 5 000); new truck capex 40 000.
    const B = 25000 - 3 * ((30000 - 5000) / (5 * 365));
    expect(d3.cashFlow.assetSaleProceeds).toBeCloseTo(5000 + 0.8 * (B - 5000), 6);
    expect(d3.cashFlow.capex).toBe(40000);
    for (let d = 3; d < 14; d++) {
      if (!r.days[d].isWorkday) continue;
      expect(r.crewLogs![d][0].vehicleId).toBe('a-d3-0-0');
      expect(r.crewLogs![d][0].deployed).toBe(true);
    }
  });

  it('rejects a vehicle replaced by equipment', () => {
    const s = scenario(companyWithTruck(), {
      horizonDays: 2,
      actions: [
        {
          day: 0,
          action: {
            type: 'replace-asset',
            assetId: 'v1',
            spec: { name: 'm', equipmentTypeId: 'mower', maintenanceCostPerHour: 0, purchasePrice: 1, usefulLifeYears: 1, salvageValue: 0, leaseMonthly: 0 },
            method: 'cash',
          },
        },
      ],
    });
    expect(run(s).events.find((e) => e.type === 'action-rejected')).toMatchObject({ reason: 'a vehicle must be replaced by a vehicle' });
  });
});

describe('owner distributions', () => {
  it('B12 flavour: on first-of-month days after day 0, cash above X is paid out and end-of-day cash equals X', () => {
    // Revenue-free company with overhead 0 and starting cash 10 000; X = 4 000.
    // Day 31 (1 Feb): D = 10 000 − 4 000 = 6 000; cash 4 000. Day 59 (1 Mar): D = 0.
    const base = deterministicCompany();
    const company = { ...base, finance: { ...base.finance, ownerDistributionCashAbove: 4000 } };
    const s = scenario(company, { horizonDays: 70 });
    const r = run(s);
    expect(r.days[0].cashFlow.ownerDistributions).toBe(0);
    expect(r.days[31].cashFlow.ownerDistributions).toBe(6000);
    expect(r.days[31].balance.cash).toBe(4000);
    expect(r.days[31].income.netProfit).toBe(0);
    // equity falls by the distribution, profit does not
    expect(r.days[31].balance.equity - r.days[30].balance.equity).toBe(-6000);
    expect(r.days[59].cashFlow.ownerDistributions).toBe(0);
    expect(r.events.filter((e) => e.type === 'owner-distribution')).toEqual([{ day: 31, type: 'owner-distribution', amount: 6000 }]);
  });

  it('no distribution while the line of credit is drawn', () => {
    // Overhead 30 000/month ≈ 986.30/day drains 1 000 starting cash on day 1; the line is drawn from then on.
    const base = deterministicCompany();
    const company: CompanyConfig = {
      ...base,
      costs: { ...base.costs, overhead: [{ id: 'o', name: 'o', monthlyAmount: 30000 }] },
      finance: { ...base.finance, startingCash: 1000, lineOfCredit: { limit: 100000, annualRate: 0.1 }, ownerDistributionCashAbove: 0 },
    };
    const s = scenario(company, { horizonDays: 70 });
    const r = run(s);
    expect(r.days[31].balance.locBalance).toBeGreaterThan(0);
    expect(r.totals.cashFlow.ownerDistributions).toBe(0);
  });
});

describe('people and customer actions', () => {
  const busy = () =>
    deterministicCompany({
      customers: Array.from({ length: 12 }, (_, i) => customer(`k${i}`, 1 + (i % 4) * 0.3, Math.floor(i / 4) * 0.3, 'mow', { phase: i / 12 })),
      policies: { ...deterministicCompany().policies, minPaidHoursPerShift: 8 },
    });

  it('set-wage × 1.1 for all raises direct labor by exactly 10% (same hours)', () => {
    const s = scenario(busy(), { horizonDays: 21 });
    const a = run(s);
    const b = run({ ...s, actions: [{ day: 0, action: { type: 'set-wage', employeeId: 'all', multiplier: 1.1 } }] });
    expect(b.totals.ops.paidHours).toBe(a.totals.ops.paidHours);
    expect(b.totals.income.directLabor).toBeCloseTo(1.1 * a.totals.income.directLabor, 6);
  });

  it('move-employee takes the person off the crew from that day; history before is unchanged', () => {
    const s = scenario(busy(), { horizonDays: 14, actions: [{ day: 3, action: { type: 'move-employee', employeeId: 'e2', crewId: null } }] });
    const a = run(scenario(busy(), { horizonDays: 14 }));
    const b = run(s);
    expect(b.days.slice(0, 3)).toEqual(a.days.slice(0, 3));
    for (let d = 3; d < 14; d++) if (b.days[d].isWorkday) expect(b.crewLogs![d][0].memberIds).toEqual(['e1']);
  });

  it('drop-customers withdraws (not churns): no churn count, open orders withdrawn, active count falls', () => {
    const s = scenario(busy(), { horizonDays: 14, actions: [{ day: 5, action: { type: 'drop-customers', customerIds: ['k0', 'k1', 'k2'] } }] });
    const r = run(s);
    expect(r.totals.ops.churnedCustomers).toBe(0);
    expect(r.days[5].activeCustomers).toBe(9);
    expect(r.customers!.filter((c) => c.churnedDay === 5).map((c) => c.id)).toEqual(['k0', 'k1', 'k2']);
    expect(r.crewLogs!.slice(5).flat().flatMap((l) => l.stops.map((x) => x.customerId)).some((id) => ['k0', 'k1', 'k2'].includes(id))).toBe(false);
  });

  it('rejects unknown ids', () => {
    const s = scenario(busy(), {
      horizonDays: 2,
      actions: [
        { day: 0, action: { type: 'move-employee', employeeId: 'ghost', crewId: null } },
        { day: 0, action: { type: 'move-employee', employeeId: 'e1', crewId: 'nope' } },
        { day: 0, action: { type: 'set-wage', employeeId: 'ghost', multiplier: 1 } },
        { day: 0, action: { type: 'drop-customers', customerIds: ['ghost'] } },
      ],
    });
    const reasons = run(s).events.flatMap((e) => (e.type === 'action-rejected' ? [e.reason] : []));
    expect(reasons).toEqual(['unknown employee ghost', 'unknown crew nope', 'unknown employee ghost', 'unknown customer ghost']);
  });
});

describe('every new action at mixed days keeps the identities (stochastic, several seeds)', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, () => {
      const base = stochasticMid(seed);
      const co = base.company;
      const fin = { ...co.finance, ownerDistributionCashAbove: co.finance.startingCash * 0.5 };
      const s: Scenario = {
        ...base,
        company: { ...co, finance: fin },
        actions: [
          { day: 20, action: { type: 'replace-asset', assetId: co.vehicles[0].id, spec, method: 'loan' } },
          { day: 40, action: { type: 'dispose-asset', assetId: co.equipment[co.equipment.length - 1].id } },
          { day: 50, action: { type: 'set-wage', employeeId: 'all', multiplier: 1.05 } },
          { day: 60, action: { type: 'move-employee', employeeId: co.employees[0].id, crewId: co.crews[co.crews.length - 1].id } },
          { day: 70, action: { type: 'drop-customers', customerIds: co.customers.slice(0, 5).map((c) => c.id) } },
          { day: 90, action: { type: 'dispose-asset', assetId: 'a-d20-0-0' } },
        ],
      };
      const r = run(s);
      expect(r.events.filter((e) => e.type === 'action-rejected')).toEqual([]);
      expect(r.events.filter((e) => e.type === 'asset-disposed').length).toBe(3);
    });
  }
});
