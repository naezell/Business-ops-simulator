/** Unit tests of the optimizer's small pure functions; expected values computed by hand. */
import { describe, expect, it } from 'vitest';
import type { IncomeStatement, PlannedAction, UnservedReason } from '../../src/simulation';
import {
  computeDrivers,
  confidenceLabel,
  conflicts,
  diagnoseBottlenecks,
  distribution,
  fmtUsd,
  paybackDays,
  seedsFor,
  shareImproved,
  staticReasons,
  upfrontCash,
} from '../../src/optimization';
import type { CandidateDef, RunSummary } from '../../src/optimization';
import { revenueSeverity } from '../../src/optimization/bottlenecks';
import { deterministicCompany, employee } from '../simulation/helpers';
import { truck } from './scenarios';

function income(over: Partial<IncomeStatement> = {}): IncomeStatement {
  return {
    revenue: 0,
    directLabor: 0,
    payrollBurden: 0,
    materials: 0,
    fuel: 0,
    maintenance: 0,
    equipmentLeases: 0,
    grossProfit: 0,
    overhead: 0,
    marketing: 0,
    hiringCosts: 0,
    badDebt: 0,
    ebitda: 0,
    depreciation: 0,
    operatingProfit: 0,
    interest: 0,
    netProfit: 0,
    ...over,
  };
}

const noUnserved = (): Record<UnservedReason, number> => ({ capacity: 0, weather: 0, vehicle: 0, equipment: 0, skill: 0, 'crew-size': 0, 'no-crew': 0 });

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    seed: 1,
    income: income(),
    netProfit: 0,
    endingCash: 0,
    revenue: 0,
    minCash: 1000,
    shortfallDays: 0,
    utilization: 0,
    missedJobRate: 0,
    jobsCompleted: 0,
    jobsCancelled: 0,
    endActiveCustomers: 0,
    cashSeries: new Float64Array(0),
    rejected: [],
    unserved: noUnserved(),
    lostRevenue: 0,
    idleHours: 0,
    paidHours: 0,
    jobTypes: {},
    ...over,
  };
}

describe('seeds and distributions', () => {
  it('spaces seeds by 7919', () => {
    expect(seedsFor(10, 3)).toEqual([10, 7929, 15848]);
  });

  it('distribution: mean, min, max and sample standard deviation', () => {
    // mean 2.5; squared deviations 2.25 + 0.25 + 0.25 + 2.25 = 5; sample var 5/3.
    const d = distribution([1, 2, 3, 4]);
    expect(d.mean).toBe(2.5);
    expect(d.min).toBe(1);
    expect(d.max).toBe(4);
    expect(d.stdDev).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(distribution([7]).stdDev).toBe(0);
  });

  it('share of seeds that improved counts only strict gains', () => {
    expect(shareImproved([1, 0, -1, 2])).toBe(0.5);
  });

  it('confidence labels', () => {
    // all improved, mean 11 > 2·1/√3 ≈ 1.155 → high
    expect(confidenceLabel([10, 11, 12])).toBe('high');
    // all improved but mean 17.33 < 2·28.29/√3 ≈ 32.7 → medium
    expect(confidenceLabel([1, 50, 1])).toBe('medium');
    // 4 of 5 improved = 0.8 → medium
    expect(confidenceLabel([1, 1, 1, 1, -1])).toBe('medium');
    // 2 of 3 = 0.67 → low
    expect(confidenceLabel([1, 1, -1])).toBe('low');
    // K < 3 can never be high
    expect(confidenceLabel([5, 6])).toBe('medium');
  });
});

describe('constraints', () => {
  const company = deterministicCompany({
    workforce: { ...deterministicCompany().workforce, hiringCostPerHire: 500 },
  });
  // finance.newLoan.downPaymentFraction = 0.2 in the helper company.

  it('upfront cash = hiring costs + cash prices + loan down payments (leases free)', () => {
    const hire = { hourlyWage: 18, skill: 1, productivity: 1 };
    const eq = { name: 'Blower', equipmentTypeId: 'blower', maintenanceCostPerHour: 0, purchasePrice: 1500, usefulLifeYears: 3, salvageValue: 0, leaseMonthly: 20 };
    const { id: _id, ...truckSpec } = truck;
    const actions: PlannedAction[] = [
      { day: 0, action: { type: 'hire-employee', crewId: 'c1', hire } }, // 500
      { day: 0, action: { type: 'acquire-equipment', spec: eq, method: 'cash', crewId: null } }, // 1,500
      { day: 0, action: { type: 'acquire-vehicle', spec: truckSpec, method: 'loan', crewId: null } }, // 0.2 × 40,000 = 8,000
      { day: 0, action: { type: 'acquire-vehicle', spec: truckSpec, method: 'lease', crewId: null } }, // 0
      {
        day: 0,
        action: {
          type: 'add-crew',
          name: 'n',
          hires: [hire, hire], // 1,000
          vehicle: { spec: truckSpec, method: 'loan' }, // 8,000
          equipment: [{ spec: eq, method: 'loan' }], // 300
        },
      },
      { day: 5, action: { type: 'hire-employee', crewId: 'c1', hire } }, // not day 0 → 0
    ];
    expect(upfrontCash(company, actions)).toBeCloseTo(500 + 1500 + 8000 + 0 + 1000 + 8000 + 300, 9);
  });

  it('flags cash beyond cash + credit, hires beyond seats and removing the last member', () => {
    const hire = { hourlyWage: 18, skill: 1, productivity: 1 };
    // 2 members in a 3-seat vehicle: one hire fits, two do not.
    expect(staticReasons(company, [{ day: 0, action: { type: 'hire-employee', crewId: 'c1', hire } }])).toEqual([]);
    const two: PlannedAction[] = [
      { day: 0, action: { type: 'hire-employee', crewId: 'c1', hire } },
      { day: 0, action: { type: 'hire-employee', crewId: 'c1', hire } },
    ];
    expect(staticReasons(company, two).join(' ')).toMatch(/seats 3/);

    const solo = deterministicCompany({ employees: [employee('e1', 'c1')] });
    expect(staticReasons(solo, [{ day: 0, action: { type: 'remove-employee', employeeId: 'e1' } }]).join(' ')).toMatch(/close the crew/);

    // 10,000 cash + 0 credit < 0.2 × 60,000 = 12,000.
    const { id: _id, ...truckSpec } = truck;
    const big = { ...truckSpec, purchasePrice: 60000 };
    expect(staticReasons(company, [{ day: 0, action: { type: 'acquire-vehicle', spec: big, method: 'loan', crewId: null } }]).join(' ')).toMatch(/cash/);
  });

  it('price:all conflicts with every per-type price key; different types do not conflict', () => {
    const def = (key: string): CandidateDef => ({ id: key, label: key, category: 'pricing', actions: [], conflictKey: key });
    expect(conflicts(def('price:all'), def('price:mow'))).toBe(true);
    expect(conflicts(def('price:mow'), def('price:all'))).toBe(true);
    expect(conflicts(def('price:mow'), def('price:cleanup'))).toBe(false);
    expect(conflicts(def('marketing'), def('marketing'))).toBe(true);
    expect(conflicts(def('marketing'), def('price:all'))).toBe(false);
  });
});

describe('explanation helpers', () => {
  it('formats dollars without locale dependence', () => {
    expect(fmtUsd(-12345.6)).toBe('-$12,346');
    expect(fmtUsd(0)).toBe('$0');
    expect(fmtUsd(1234567)).toBe('$1,234,567');
  });

  it('drivers sum to the mean change in net profit', () => {
    // Seed 1: revenue +100, labor +30, fuel −5 → Δnet = 100 − 30 + 5 = 75.
    // Seed 2: revenue +60, labor +30, interest +10 → Δnet = 20. Mean = 47.5.
    const base = [summary({ income: income() }), summary({ income: income() })];
    const runs = [
      summary({ income: income({ revenue: 100, directLabor: 30, fuel: -5 }) }),
      summary({ income: income({ revenue: 60, directLabor: 30, interest: 10 }) }),
    ];
    const d = computeDrivers(runs, base);
    const by = Object.fromEntries(d.map((x) => [x.line, x.delta]));
    expect(by.revenue).toBe(80);
    expect(by.directLabor).toBe(-30);
    expect(by.fuel).toBe(2.5);
    expect(by.interest).toBe(-5);
    expect(d.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(47.5, 12);
    expect(d.map((x) => x.line)).not.toContain('grossProfit');
  });

  it('payback = first day from which the mean Δcash stays ≥ 0', () => {
    const base = [summary({ cashSeries: new Float64Array([0, 0, 0, 0, 0, 0]) })];
    const run = [summary({ cashSeries: new Float64Array([-100, -50, 10, -1, 5, 6]) })];
    expect(paybackDays(run, base, 100)).toBe(4);
    expect(paybackDays(run, base, 0)).toBeNull();
    const never = [summary({ cashSeries: new Float64Array([-100, -50, 10, 5, 5, -1]) })];
    expect(paybackDays(never, base, 100)).toBeNull();
  });
});

describe('bottlenecks', () => {
  it('severity relative to revenue, clamped, and 1 when revenue is 0 but impact positive', () => {
    expect(revenueSeverity(100, 0.1, 5000)).toBeCloseTo(0.2, 12);
    expect(revenueSeverity(1000, 0.1, 5000)).toBe(1);
    expect(revenueSeverity(1, 0.1, 0)).toBe(1);
    expect(revenueSeverity(0, 0.1, 0)).toBe(0);
  });

  it('diagnoses capacity, idle time and weather from hand-made baseline figures', () => {
    // Horizon 73 days → annualize ×5. Revenue 2,000 → R = 10,000.
    // Unserved: capacity 30 + weather 10 → shares 0.75 / 0.25; lost revenue 400.
    //   crew-capacity impact = 400 × 0.75 × 5 = 1,500; severity 1,500 / 1,000 → 1.
    //   weather impact = 400 × 0.25 × 5 = 500; severity 0.5.
    // Idle 30 of 100 paid hours = 0.3 > 0.15: impact (0.3 − 0.1) × (1,000 + 200) × 5 = 1,200; severity 0.2/0.3.
    const unserved = { ...noUnserved(), capacity: 30, weather: 10 };
    const base = [
      summary({
        revenue: 2000,
        income: income({ revenue: 2000, directLabor: 1000, payrollBurden: 200 }),
        unserved,
        lostRevenue: 400,
        idleHours: 30,
        paidHours: 100,
      }),
    ];
    const company = deterministicCompany();
    const b = diagnoseBottlenecks(company, base, 73, []);
    expect(b.map((x) => x.kind)).toEqual(['crew-capacity', 'weak-demand', 'weather']);
    expect(b[0].estimatedAnnualImpact).toBeCloseTo(1500, 9);
    expect(b[0].severity).toBe(1);
    expect(b[1].estimatedAnnualImpact).toBeCloseTo(1200, 9);
    expect(b[1].severity).toBeCloseTo(0.2 / 0.3, 12);
    expect(b[2].estimatedAnnualImpact).toBeCloseTo(500, 9);
    expect(b[2].severity).toBeCloseTo(0.5, 12);
    expect(b[0].detail).toMatch(/up to about \$1,500/);
  });

  it('routing impact is the best positive simulated delta, annualized', () => {
    const base = [summary({ revenue: 1000, income: income({ revenue: 1000 }) })];
    // Δ 40 over 73 days → 200/yr; R = 5,000 → severity 200 / 250 = 0.8.
    const b = diagnoseBottlenecks(deterministicCompany(), base, 73, [
      { policy: 'fifo', deltaNetProfit: -10 },
      { policy: 'zoned', deltaNetProfit: 40 },
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe('routing-inefficiency');
    expect(b[0].estimatedAnnualImpact).toBeCloseTo(200, 9);
    expect(b[0].severity).toBeCloseTo(0.8, 12);
  });
});
