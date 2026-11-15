/**
 * Hand-calculated end-to-end benchmarks. Every stochastic rate is 0, so each number below is
 * derived by hand from docs/simulation-engine.md and docs/financial-model.md (arithmetic in the
 * comments). The engine output is compared against these numbers, never the other way round.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, type Scenario } from '../../src/simulation';
import { customer, deterministicCompany, employee, equipment, jobType, scenario, vehicle } from '../simulation/helpers';
import { assertInvariants } from '../simulation/invariants';

const TOL = 1e-6;
const near = (actual: number, expected: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: got ${actual}, expected ${expected}`).toBeLessThanOrEqual(TOL * Math.max(1, Math.abs(expected)));

// ───────────────────────────────────────────────────────────────────────────
// Benchmark A — overtime week, partial final week, equipment maintenance.
//
// One crew c1: one employee e1 ($20/h, productivity 1, fully ramped) ⇒ crew rate 1.0.
// Vehicle v1: mpg 20, $0.10/mile, owned, price 30,000, salvage 3,000, life 5y, age 0.
// Mower m1 (crew kit): $2/equipment-hour, owned, price 3,650, salvage 0, life 1y, age 0.
// Job "mow": 3 std labor hours, base price $100, materials $5, 0.5 gal/on-site hour,
//   requires a mower, weekly (interval 7). Global price multiplier 1.1 ⇒ price $110.
// 15 customers all at (3,4): straight distance 5 mi, roadFactor 1 ⇒ 5 road miles,
//   30 mph ⇒ 1/6 h each way; 0 between customers; stop overhead 0.
// Phase (6 − k)/7 for customer group k = 0..4 (3 customers per group) ⇒ the group's visit
//   accrues to 1 on day k (Mon..Fri) and again on day k + 7.
// Shift 8 h + 3 h max overtime ⇒ L = 11. minPaid 0. FIFO.
// Horizon 12 days (Mon day 0 … Fri day 11): workdays 0–4 and 7–11.
//
// Each workday: three 3-hour jobs at the same spot.
//   clock: 1/6 + 3 = 19/6; + 0 + 3 = 37/6; + 0 + 3 = 55/6; return +1/6 ⇒ endClock = 56/6 = 28/3 ≤ 11.
//   3rd job fit check: 37/6 + 0 + 3 + 1/6 = 28/3 ≤ 11 ✓.
//   paid = 28/3 h; wages = 20 × 28/3 = 560/3; on site 9 h; travel 1/3 h; idle 0.
//   revenue 3 × 110 = 330; materials 3 × 5 = 15.
//   miles = 5 + 5 = 10 ⇒ vehicle fuel 10/20 = 0.5 gal; equipment fuel 9 × 0.5 = 4.5 gal;
//     fuel = 5 gal × $3 = $15.
//   maintenance = 10 mi × 0.10 + 9 mower-hours × $2 = 1 + 18 = $19.
// Week 1 (days 0–6): 5 × 28/3 = 140/3 h ⇒ OT = 140/3 − 40 = 20/3 h,
//   premium = (1.5 − 1) × 20 × 20/3 = 200/3, booked on day 6 (Sunday).
// Week 2 (days 7–11) is cut by the horizon; settled on the final day 11: same 20/3 h, 200/3.
// directLabor = 10 × 560/3 + 2 × 200/3 = 5600/3 + 400/3 = 2000. Burden 10% = 200.
// Overhead $365/month ⇒ 365 × 12 / 365 = $12/day × 12 days = 144.
// Depreciation: v1 27,000 / (5 × 365) = 14.794520547945… /day; m1 3,650 / 365 = 10/day.
//   12 days ⇒ 177.534246575342… + 120 = 297.534246575342…
// Net profit = 3300 − 2000 − 200 − 150 − 150 − 190 − 144 − 297.5342465753… = 168.4657534246…
// Payroll every 7 days ⇒ payday day 6 only: pays week 1 = (2800/3 + 200/3) × 1.1 = 1100.
//   accrued payroll at end = week 2 = 1100.
// Collections same day (mean 0) ⇒ collections 3300, AR 0.
// Cash = 10,000 + 3300 − 1100 − (150 + 150 + 190 + 144) = 11,566.
// ───────────────────────────────────────────────────────────────────────────
function benchmarkA(): Scenario {
  const customers = [];
  for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) customers.push(customer(`g${k}-${j}`, 3, 4, 'mow', { phase: (6 - k) / 7 }));
  const co = deterministicCompany({
    jobTypes: [jobType({ standardLaborHours: 3, basePrice: 100, materialCost: 5, equipmentFuelGalPerHour: 0.5, requiredEquipmentTypes: ['mower'] })],
    employees: [employee('e1', 'c1', { hourlyWage: 20 })],
    vehicles: [
      vehicle('v1', {
        mpg: 20,
        maintenanceCostPerMile: 0.1,
        asset: { purchasePrice: 30000, usefulLifeYears: 5, salvageValue: 3000, ageYears: 0, financing: { kind: 'owned' } },
      }),
    ],
    equipment: [
      equipment('m1', 'mower', 'c1', {
        maintenanceCostPerHour: 2,
        asset: { purchasePrice: 3650, usefulLifeYears: 1, salvageValue: 0, ageYears: 0, financing: { kind: 'owned' } },
      }),
    ],
    customers,
    pricing: { globalMultiplier: 1.1, byJobType: {} },
  });
  co.policies.maxOvertimeHoursPerDay = 3;
  co.workforce.payrollBurdenRate = 0.1;
  co.workforce.payPeriodDays = 7;
  co.costs = { fuelPricePerGallon: 3, avgSpeedMph: 30, roadFactor: 1, stopOverheadHours: 0, overhead: [{ id: 'rent', name: 'Rent', monthlyAmount: 365 }] };
  co.finance.startingCash = 10000;
  return scenario(co, { horizonDays: 12 });
}

describe('benchmark A: overtime and partial final week', () => {
  const s = benchmarkA();
  const r = runSimulation(s);
  const t = r.totals;

  it('satisfies all invariants', () => assertInvariants(s, r));

  it('income statement matches the hand calculation', () => {
    near(t.income.revenue, 3300, 'revenue');
    near(t.income.directLabor, 2000, 'directLabor');
    near(t.income.payrollBurden, 200, 'burden');
    near(t.income.materials, 150, 'materials');
    near(t.income.fuel, 150, 'fuel');
    near(t.income.maintenance, 190, 'maintenance');
    near(t.income.overhead, 144, 'overhead');
    near(t.income.depreciation, (12 * 27000) / 1825 + 120, 'depreciation'); // 297.534246575342…
    near(t.income.interest, 0, 'interest');
    near(t.income.netProfit, 3300 - 2000 - 200 - 150 - 150 - 190 - 144 - 297.5342465753425, 'netProfit');
  });

  it('overtime is booked on Sunday and on the final (mid-week) day', () => {
    near(t.ops.overtimeHours, 40 / 3, 'total OT hours');
    near(r.days[6].ops.overtimeHours, 20 / 3, 'day 6 OT');
    near(r.days[11].ops.overtimeHours, 20 / 3, 'day 11 OT');
    // day 6: no work, only the premium 200/3
    near(r.days[6].income.directLabor, 200 / 3, 'day 6 premium');
    // day 11: straight wages 560/3 + premium 200/3 = 760/3
    near(r.days[11].income.directLabor, 760 / 3, 'day 11 labor');
    near(r.days[4].income.directLabor, 560 / 3, 'day 4 labor');
  });

  it('hours, miles and jobs', () => {
    near(t.ops.paidHours, 10 * (28 / 3), 'paid');
    near(t.ops.onSiteHours, 90, 'on site');
    near(t.ops.travelHours, 10 / 3, 'travel');
    near(t.ops.idleHours, 0, 'idle');
    near(t.ops.milesDriven, 100, 'miles');
    expect(t.ops.jobsCompleted).toBe(30);
    expect(t.ops.jobsCreated).toBe(30);
    const log = r.crewLogs![0][0];
    near(log.endClock, 28 / 3, 'endClock');
    expect(log.stops.map((x) => x.jobId)).toEqual(['g0-0:mow:0:0', 'g0-1:mow:0:0', 'g0-2:mow:0:0']);
    near(log.stops[0].arrive, 1 / 6, 'arrive');
    near(log.stops[2].depart, 55 / 6, 'depart');
  });

  it('cash, AR, payroll and balance sheet', () => {
    const b = r.days[11].balance;
    near(t.cashFlow.collections, 3300, 'collections');
    near(b.accountsReceivable, 0, 'AR');
    near(r.days[6].cashFlow.payrollPaid, 1100, 'payroll day 6');
    near(t.cashFlow.payrollPaid, 1100, 'payroll total');
    near(b.accruedPayroll, 1100, 'accrued payroll');
    near(b.cash, 11566, 'cash');
    near(b.netFixedAssets, 33650 - 297.5342465753425, 'NFA');
    near(b.equity, 43650 + 168.4657534246575, 'equity');
  });

  it('job type stats', () => {
    const js = r.jobTypeStats.mow;
    // loaded labor per day: 20 × 1.1 × (3 + 1/6 + 3 + 3) = 22 × 55/6; fuel per day: (4.5 + 5/20) × 3 = 14.25
    near(js.laborCost, 10 * 22 * (55 / 6), 'laborCost');
    near(js.fuel, 142.5, 'jt fuel');
    near(js.contribution, 3300 - 10 * 22 * (55 / 6) - 150 - 142.5, 'contribution');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Benchmark B — opening loan, financed acquisition, AR delay, split job, monthly summaries.
//
// startMonth = 1 (Feb, 28 days) ⇒ day 28 is March 1st (a Monday) ⇒ loan payments on day 28.
// Horizon 29 days (0–28).
// Crew c1: e1 ($25, skill 3) and e2 ($15, skill 1), productivity 1, coordination loss 0.2
//   ⇒ rate = (1 + 1) × (1 − 0.2) = 1.6 std hours per clock hour. Wages $40 per crew-hour.
// Vehicle v1: mpg 15, $0.20/mile, price 36,500, salvage 0, life 5, age 1 ⇒ opening book
//   36,500 − 36,500 × 1/5 = 29,200, depreciation 36,500/1825 = $20/day.
//   Opening loan: balance 12,000 at 6% over 12 months ⇒ r = 0.005,
//   pmt = 12000 × 0.005 / (1 − 1.005^−12) = 1032.797156484989…
// Day 0 action: acquire-equipment (spare, crewId null) by loan: price 7,300, salvage 0, life 2
//   ⇒ $10/day depreciation; newLoan 12%, 24 months, 20% down ⇒ capex 1,460, borrowing 5,840,
//   r = 0.01, pmt = 5840 × 0.01 / (1 − 1.01^−24) = 274.909077783865…; first payment day 28.
// Road factor 1.5, 30 mph, stop overhead 0.25 h. Shift 8, no overtime (L = 8), minPaid 4.
// Customers (FIFO):
//   A (6,8): 10 mi straight ⇒ 15 road mi ⇒ 0.5 h. mow, size 1: 4 h labor, $200, $10 mat.
//     phase 6/7 ⇒ visits Mondays 0, 7, 14, 21, 28. tIn 0.75, D = 4/1.6 = 2.5, back 0.5
//     ⇒ endClock 3.75 ⇒ paid max(3.75, 4) = 4 h each.
//   B (−6,8): same distance. mow, size 1.5: 6 h, $300, $15. phase 4/7 ⇒ Wednesdays 2, 9, 16, 23.
//     tIn 0.75, D = 3.75, back 0.5 ⇒ endClock 5 ⇒ paid 5.
//   C (0,5): 7.5 road mi ⇒ 0.25 h. "big" (interval 28, splittable): 20 h, $1000, $100.
//     phase 24/28 ⇒ order on day 3 (Thu). Day 3: 0.5 + 12.5 + 0.25 > 8 ⇒ split,
//     A = 8 − 0.5 − 0.25 = 7.25 h ⇒ remaining 20 − 7.25 × 1.6 = 8.4; endClock 8 ⇒ paid 8.
//     Day 4: 0.5 + 8.4/1.6 = 5.25 + 0.25 = 6 ⇒ completes, endClock 6 ⇒ paid 6. Revenue on day 4.
//   Other workdays: crew fielded, no work ⇒ paid min 4 h each.
// Paid hours per employee: week 0 = 4+4+5+8+6 = 27; weeks 1–3 = 4+4+5+4+4 = 21 each; day 28 = 4.
//   Total 27 + 63 + 4 = 94 ⇒ directLabor = 94 × 40 = 3760; burden 20% = 752. No OT (< 40/week).
// Revenue = 5 × 200 + 4 × 300 + 1000 = 3200. Materials = 50 + 60 + 100 = 210.
// Miles = A 5 × 30 + B 4 × 30 + C (15 + 15) = 300. Fuel: 300/15 = 20 gal + equipment
//   0.4 gal/h × (5 × 2.5 + 4 × 3.75) = 0.4 × 27.5 = 11 gal ⇒ 31 gal × $4 = 124.
// Maintenance = 300 × 0.20 = 60. Overhead $730/month ⇒ $24/day × 29 = 696.
// Marketing $365/month ⇒ $12/day × 29 = 348 (spend scale 0 ⇒ no leads).
// Depreciation = 29 × (20 + 10) = 870.
// Interest (day 28) = 12,000 × 0.005 + 5,840 × 0.01 = 60 + 58.4 = 118.4.
// Principal (day 28) = (1032.797156… − 60) + (274.909077… − 58.4).
// Net profit = 3200 − 3760 − 752 − 210 − 124 − 60 − 696 − 348 − 870 − 118.4 = −3738.4.
// Collections, delay round(10 × 1) = 10 days: day 10: 200, 12: 300, 14: 1000, 17: 200, 19: 300,
//   24: 200, 26: 300 ⇒ 2500. AR at end = 3200 − 2500 = 700 (A d21, B d23, A d28).
// Payroll period 14 ⇒ paydays 13 and 27: (27 + 21) × 40 × 1.2 = 2304; 42 × 40 × 1.2 = 2016.
//   accrued payroll at end = 4 × 40 × 1.2 = 192.
// Cash = 10,000 + 2500 − 4320 − (210 + 124 + 60 + 696 + 348) − 1460 − 118.4 − principal.
// ───────────────────────────────────────────────────────────────────────────
const PMT1 = (12000 * 0.005) / (1 - Math.pow(1.005, -12));
const PMT2 = (5840 * 0.01) / (1 - Math.pow(1.01, -24));

function benchmarkB(): Scenario {
  const co = deterministicCompany({
    startMonth: 1,
    jobTypes: [
      jobType({ id: 'mow', standardLaborHours: 4, basePrice: 200, materialCost: 10, equipmentFuelGalPerHour: 0.4 }),
      jobType({ id: 'big', standardLaborHours: 20, basePrice: 1000, materialCost: 100, intervalDays: 28, splittable: true }),
    ],
    employees: [employee('e1', 'c1', { hourlyWage: 25, skill: 3 }), employee('e2', 'c1', { hourlyWage: 15, skill: 1 })],
    vehicles: [
      vehicle('v1', {
        seats: 2,
        mpg: 15,
        maintenanceCostPerMile: 0.2,
        asset: {
          purchasePrice: 36500,
          usefulLifeYears: 5,
          salvageValue: 0,
          ageYears: 1,
          financing: { kind: 'loan', balance: 12000, annualRate: 0.06, monthsRemaining: 12 },
        },
      }),
    ],
    customers: [
      customer('A', 6, 8, 'mow', { phase: 6 / 7 }),
      customer('B', -6, 8, 'mow', { phase: 4 / 7, sizeFactor: 1.5 }),
      customer('C', 0, 5, 'big', { phase: 24 / 28 }),
    ],
  });
  co.policies.minPaidHoursPerShift = 4;
  co.workforce.payrollBurdenRate = 0.2;
  co.workforce.crewSizeCoordinationLoss = 0.2;
  co.workforce.payPeriodDays = 14;
  co.market.marketingMonthlySpend = 365;
  co.costs = { fuelPricePerGallon: 4, avgSpeedMph: 30, roadFactor: 1.5, stopOverheadHours: 0.25, overhead: [{ id: 'o', name: 'Office', monthlyAmount: 730 }] };
  co.finance = {
    startingCash: 10000,
    minCashReserve: 1000,
    lineOfCredit: { limit: 0, annualRate: 0 },
    ar: { collectionDaysMean: 10, collectionDaysJitter: 0, badDebtRate: 0 },
    newLoan: { annualRate: 0.12, termMonths: 24, downPaymentFraction: 0.2 },
  };
  return scenario(co, {
    horizonDays: 29,
    actions: [
      {
        day: 0,
        action: {
          type: 'acquire-equipment',
          crewId: null,
          method: 'loan',
          spec: {
            name: 'Aerator',
            equipmentTypeId: 'aerator',
            maintenanceCostPerHour: 3,
            purchasePrice: 7300,
            usefulLifeYears: 2,
            salvageValue: 0,
            leaseMonthly: 0,
          },
        },
      },
    ],
  });
}

describe('benchmark B: loans, AR delay, split job', () => {
  const s = benchmarkB();
  const r = runSimulation(s);
  const t = r.totals;
  const principal = PMT1 - 60 + (PMT2 - 58.4);

  it('satisfies all invariants', () => assertInvariants(s, r));

  it('income statement matches the hand calculation', () => {
    near(t.income.revenue, 3200, 'revenue');
    near(t.income.directLabor, 3760, 'directLabor');
    near(t.income.payrollBurden, 752, 'burden');
    near(t.income.materials, 210, 'materials');
    near(t.income.fuel, 124, 'fuel');
    near(t.income.maintenance, 60, 'maintenance');
    near(t.income.overhead, 696, 'overhead');
    near(t.income.marketing, 348, 'marketing');
    near(t.income.depreciation, 870, 'depreciation');
    near(t.income.interest, 118.4, 'interest');
    near(t.income.netProfit, -3738.4, 'netProfit');
    near(t.ops.overtimeHours, 0, 'no overtime');
  });

  it('split job: materials on first day, revenue on completion day', () => {
    near(r.days[3].income.materials, 100, 'materials day 3');
    near(r.days[3].income.revenue, 0, 'no revenue on split day');
    near(r.days[4].income.revenue, 1000, 'revenue day 4');
    near(r.crewLogs![3][0].endClock, 8, 'split day endClock');
    near(r.crewLogs![4][0].endClock, 6, 'completion day endClock');
    expect(r.crewLogs![3][0].stops[0].completed).toBe(false);
    expect(r.crewLogs![1][0].notDeployedReason).toBe('no-work');
    near(r.days[1].ops.paidHours, 8, 'no-work day paid min 4 × 2');
    near(r.days[1].ops.idleHours, 8, 'no-work day idle');
  });

  it('loans: payments only on the first of the month after acquisition', () => {
    near(r.days[0].cashFlow.capex, 1460, 'down payment');
    near(t.cashFlow.capex, 1460, 'capex');
    near(r.days[28].cashFlow.principalPaid, principal, 'principal day 28');
    near(t.cashFlow.principalPaid, principal, 'principal total');
    near(r.days[28].cashFlow.interestPaid, 118.4, 'interest paid day 28');
    near(r.days[28].balance.loanBalance, 12000 + 5840 - principal, 'loan balance');
    near(r.days[27].balance.loanBalance, 17840, 'loan balance before payment');
  });

  it('collections are delayed by exactly 10 days', () => {
    const expected: Record<number, number> = { 10: 200, 12: 300, 14: 1000, 17: 200, 19: 300, 24: 200, 26: 300 };
    r.days.forEach((d) => near(d.cashFlow.collections, expected[d.day] ?? 0, `collections day ${d.day}`));
    near(t.cashFlow.collections, 2500, 'collections');
    near(r.days[28].balance.accountsReceivable, 700, 'AR end');
    near(r.days[9].balance.accountsReceivable, 200 + 300 + 1000 + 200 + 300, 'AR day 9');
  });

  it('payroll, cash and balance sheet', () => {
    near(r.days[13].cashFlow.payrollPaid, 2304, 'payday 13');
    near(r.days[27].cashFlow.payrollPaid, 2016, 'payday 27');
    near(r.days[28].balance.accruedPayroll, 192, 'accrued');
    const cash = 10000 + 2500 - 4320 - (210 + 124 + 60 + 696 + 348) - 1460 - 118.4 - principal;
    const b = r.days[28].balance;
    near(b.cash, cash, 'cash');
    near(b.netFixedAssets, 29200 + 7300 - 870, 'NFA');
    near(b.availableCash, cash - 192 - 1000 + 0, 'available cash');
    near(b.equity, 10000 + 29200 - 12000 - 3738.4, 'equity');
    expect(r.days.some((d) => d.cashShortfall)).toBe(false);
  });

  it('monthly summaries split at March 1st', () => {
    expect(r.months.map((m) => [m.month, m.startDay, m.endDay])).toEqual([
      [1, 0, 27],
      [2, 28, 28],
    ]);
    near(r.months[1].income.interest, 118.4, 'March interest');
    near(r.months[0].income.revenue, 3000, 'Feb revenue');
    near(r.months[1].income.revenue, 200, 'Mar revenue');
  });
});
