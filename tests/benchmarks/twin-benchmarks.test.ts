/**
 * Digital-twin benchmarks B1, B4, B5, B9, B10 and B12 (implementation-contracts §7, H13). The scenarios are
 * built in tests/fixtures/benchmarks.ts, where each hand answer is documented. Every expected value below
 * is computed from the spec arithmetic written in the test, never by calling the engine to produce an
 * expectation. B2 and B3 are not asserted here (random draws, and the lead's assertions). B6, B8 and B11 have
 * engine tests in tests/simulation/.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, type Scenario, type SimulationResult } from '../../src/simulation';
import { assertInvariants } from '../simulation/invariants';
import {
  b10Stationary,
  b12OwnerDistribution,
  b1PriceUp,
  b4IdleAddCrew,
  b5AcquisitionMethods,
  b9SeedPair,
} from '../fixtures/benchmarks';

function run(s: Scenario): SimulationResult {
  const r = runSimulation(s);
  assertInvariants(s, r);
  return r;
}

const TOL = 1e-6;
const near = (actual: number, expected: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: got ${actual}, expected ${expected}`).toBeLessThanOrEqual(TOL * Math.max(1, Math.abs(expected)));

// ───────────────────────── B1 ─────────────────────────

describe('B1: price +10%, all elasticities 0', () => {
  const { base, repriced } = b1PriceUp();
  const rb = run(base);
  const rr = run(repriced);

  it('the same orders are created and completed (demand and capacity do not depend on price)', () => {
    expect(rr.totals.ops.jobsCreated).toBe(rb.totals.ops.jobsCreated);
    expect(rr.totals.ops.jobsCompleted).toBe(rb.totals.ops.jobsCompleted);
  });

  it('revenue is 1.1 × the base revenue: every order is priced 1.1 / 1.0 = 1.1 times as high', () => {
    expect(rb.totals.income.revenue).toBeGreaterThan(0);
    near(rr.totals.income.revenue, 1.1 * rb.totals.income.revenue, 'revenue');
  });

  it('costs are unchanged: labor, burden, materials, fuel, maintenance and overhead', () => {
    for (const k of ['directLabor', 'payrollBurden', 'materials', 'fuel', 'maintenance', 'overhead', 'depreciation'] as const) {
      near(rr.totals.income[k], rb.totals.income[k], k);
    }
  });

  it('bad debt is 0 here, so profit Δ = revenue Δ: 0.1 × revenue_base', () => {
    expect(rb.totals.income.badDebt).toBe(0);
    expect(rr.totals.income.badDebt).toBe(0);
    near(rr.totals.income.netProfit - rb.totals.income.netProfit, rr.totals.income.revenue - rb.totals.income.revenue, 'profit Δ');
    near(rr.totals.income.netProfit - rb.totals.income.netProfit, 0.1 * rb.totals.income.revenue, 'profit Δ vs 10% of base revenue');
  });
});

// ───────────────────────── B4 ─────────────────────────

describe('B4: idle company, add a crew (two hires at $20, 8 h guaranteed, 18% burden, owned van $36 500 over 10 years)', () => {
  const { base, withCrew } = b4IdleAddCrew();
  const rb = run(base);
  const rw = run(withCrew);
  // Hand arithmetic (horizon 28 days = 20 workdays): 2 × 8 × 20 = 320 a workday; 20 × 320 = 6 400;
  // burden 0.18 × 6 400 = 1 152; depreciation 36 500 / 3 650 = 10 a day × 28 = 280.
  const laborΔ = 20 * 2 * 8 * 20;
  const burdenΔ = 0.18 * laborΔ;
  const depΔ = (36500 / (10 * 365)) * 28;
  const profitΔ = -(laborΔ + burdenΔ + depΔ);

  it('revenue is unchanged (no customers)', () => {
    expect(rb.totals.income.revenue).toBe(0);
    expect(rw.totals.income.revenue).toBe(0);
  });

  it('direct labor rises by the new crew’s guaranteed pay: 6 400', () => {
    near(rw.totals.income.directLabor - rb.totals.income.directLabor, laborΔ, 'direct labor Δ');
  });

  it('payroll burden rises by 18% of that pay: 1 152', () => {
    near(rw.totals.income.payrollBurden - rb.totals.income.payrollBurden, burdenΔ, 'burden Δ');
  });

  it('depreciation rises by 280 over 28 days (no salvage)', () => {
    near(rw.totals.income.depreciation - rb.totals.income.depreciation, depΔ, 'depreciation Δ');
  });

  it('net profit falls by 7 832', () => {
    near(rw.totals.income.netProfit - rb.totals.income.netProfit, profitΔ, 'net profit Δ');
    near(rw.totals.income.netProfit - rb.totals.income.netProfit, -7832, 'net profit Δ literal');
  });

  it('cash on day 27: −36 500 van, and two paydays (days 13 and 27) of 3 776 each', () => {
    // Each payday covers 10 workdays: 10 × 320 × 1.18 = 3 776; two paydays in 28 days: 7 552.
    const paid = 2 * (10 * 320 * 1.18);
    const cashΔ = rw.days[27].balance.cash - rb.days[27].balance.cash;
    near(cashΔ, -36500 - paid, 'cash Δ on day 27');
    near(cashΔ, -44052, 'cash Δ literal');
  });

  it('equity Δ on day 27 equals profit Δ: cash Δ + (36 500 − 280) − 0 accrued = −7 832', () => {
    const eqΔ = rw.days[27].balance.equity - rb.days[27].balance.equity;
    near(eqΔ, profitΔ, 'equity Δ');
  });
});

// ───────────────────────── B5 ─────────────────────────

describe('B5: the same truck bought by cash, loan or lease (idle company, 60 days)', () => {
  const { cash, loan, lease } = b5AcquisitionMethods();
  const rc = run(cash);
  const rl = run(loan);
  const rs = run(lease);

  // Independent arithmetic written from financial-model §5–§6.
  const dep = ((30000 - 5000) / (5 * 365)) * 60;
  const leaseCost = ((700 * 12) / 365) * 60;
  const r = 0.06 / 12;
  const B0 = 24000;
  const pmt = (B0 * r) / (1 - Math.pow(1 + r, -36));
  const i1 = B0 * r;
  const B1 = B0 - (pmt - i1);
  const i2 = B1 * r;
  const B2 = B1 - (pmt - i2);

  it('depreciation is 821.9178… for the owned cases and 0 for the lease', () => {
    near(rc.totals.income.depreciation, dep, 'cash depreciation');
    near(rl.totals.income.depreciation, dep, 'loan depreciation');
    expect(rs.totals.income.depreciation).toBe(0);
  });

  it('the lease costs 700 × 12 / 365 a day: 1 380.8219… over 60 days', () => {
    near(rs.totals.income.equipmentLeases, leaseCost, 'lease cost');
    expect(rc.totals.income.equipmentLeases).toBe(0);
  });

  it('interest is 0 for cash and the two loan payments’ interest for the loan: 120 + 116.9494…', () => {
    expect(rc.totals.income.interest).toBe(0);
    near(rl.totals.income.interest, i1 + i2, 'loan interest');
  });

  it('profit: loan − cash = −interest (depreciation is the same in both)', () => {
    near(rl.totals.income.netProfit - rc.totals.income.netProfit, -(i1 + i2), 'loan vs cash profit');
  });

  it('profit: cash − lease = lease cost − depreciation = 558.9041…', () => {
    near(rc.totals.income.netProfit - rs.totals.income.netProfit, leaseCost - dep, 'cash vs lease profit');
    expect(rc.totals.income.netProfit - rs.totals.income.netProfit).toBeCloseTo(558.9041, 4);
  });

  it('cash on day 59: cash −30 000 up front; loan −6 000 down and 2 × pmt; lease −1 380.82 of leases', () => {
    const S = 40000;
    near(rc.days[59].balance.cash, S - 30000, 'cash-method cash');
    near(rl.days[59].balance.cash, S - 6000 - 2 * pmt, 'loan cash');
    near(rs.days[59].balance.cash, S - leaseCost, 'lease cash');
  });

  it('the loan balance after the two payments is B2 = 22 776.70…', () => {
    near(rl.days[59].balance.loanBalance, B2, 'loan balance');
  });
});

// ───────────────────────── B9 ─────────────────────────

describe('B9: two identical stochastic scenarios that differ only in seed', () => {
  const [s1, s2] = b9SeedPair();
  const r1 = run(s1);
  const r2 = run(s2);

  it('the draws differ: the outcomes are not the same', () => {
    const sameTotals =
      r1.totals.ops.jobsCompleted === r2.totals.ops.jobsCompleted &&
      r1.totals.ops.absentShifts === r2.totals.ops.absentShifts &&
      r1.totals.income.revenue === r2.totals.income.revenue;
    expect(sameTotals).toBe(false);
  });

  it('the opening balance is 10 000 in both runs: equity_0 − netProfit_0 (no assets, no loans, AR 0)', () => {
    near(r1.days[0].balance.equity - r1.days[0].income.netProfit, 10000, 'opening equity, seed 1');
    near(r2.days[0].balance.equity - r2.days[0].income.netProfit, 10000, 'opening equity, seed 2');
  });

  it('the same seed reproduces the same result (determinism)', () => {
    const again = runSimulation(s1);
    expect(again.totals).toEqual(r1.totals);
  });
});

// ───────────────────────── B10 ─────────────────────────

/** Flatten the numeric leaves of a flow object (balance sheets are excluded: they are stocks). */
function numericLeaves(obj: unknown, path = ''): Map<string, number> {
  const out = new Map<string, number>();
  if (typeof obj === 'number') out.set(path, obj);
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) for (const [p, n] of numericLeaves(v, path ? `${path}.${k}` : k)) out.set(p, n);
  }
  return out;
}

describe('B10: every stochastic rate 0, three years; year 2 equals year 3 on every flow line (dynamics off)', () => {
  it('the default periodic setup (7 workdays a week, customer interval 5 days) is stationary', () => {
    const s = b10Stationary();
    const r = run(s);
    expect(r.years.length).toBe(3);
    const flows = (y: (typeof r.years)[number]) => ({ income: y.income, cashFlow: y.cashFlow, ops: y.ops });
    const a = numericLeaves(flows(r.years[1]));
    const b = numericLeaves(flows(r.years[2]));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    const mismatches: string[] = [];
    for (const [k, v] of a) {
      const w = b.get(k)!;
      if (Math.abs(v - w) > 1e-9 * Math.max(1, Math.abs(v), Math.abs(w))) mismatches.push(`${k}: year2 ${v} vs year3 ${w}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('year 2 and year 3 both contain 261 workdays only in the 5-day-week setup (checked on the calendar: 365 = 52 × 7 + 1)', () => {
    // With 5 workdays a week, a 365-day year starting on a Mon, Tue or Wed has 52 × 5 + 1 = 261 workdays.
    const r = run(b10Stationary({ workDaysPerWeek: 5, intervalDays: 7 }));
    const workdays = (from: number, to: number) => r.days.slice(from, to).filter((d) => d.isWorkday).length;
    expect(workdays(365, 730)).toBe(261);
    expect(workdays(730, 1095)).toBe(261);
  });
});

// ───────────────────────── B12 ─────────────────────────

describe('B12: owner distribution above X = 10 000 with constant positive cash flow', () => {
  const { withDistribution, withoutDistribution } = b12OwnerDistribution();
  const r = run(withDistribution);
  const n = run(withoutDistribution);
  const X = 10000;
  const events = r.events.filter((e): e is Extract<typeof e, { type: 'owner-distribution' }> => e.type === 'owner-distribution');
  /** Net cash flow excluding owner distributions (the distribution is added back). */
  const netExcl = (day: number) => r.days[day].cashFlow.netCashFlow + r.days[day].cashFlow.ownerDistributions;

  it('distributions fall on the first-of-month days after day 0: 31, 59, 90, 120', () => {
    expect(events.map((e) => e.day)).toEqual([31, 59, 90, 120]);
  });

  it('after each distribution, cash equals X = 10 000 (the month-end balance)', () => {
    for (const e of events) near(r.days[e.day].balance.cash, X, `cash after distribution on day ${e.day}`);
  });

  it('each distribution equals the net cash generated since the previous one (cash started at X, so day 0 counts)', () => {
    let prev = -1;
    for (const e of events) {
      let gen = 0;
      for (let k = prev + 1; k <= e.day; k++) gen += netExcl(k);
      near(e.amount, gen, `distribution on day ${e.day}`);
      expect(e.amount).toBeGreaterThan(0);
      prev = e.day;
    }
  });

  it('cumulative distributions = cumulative net cash generated above X', () => {
    const cumD = events.reduce((a, e) => a + e.amount, 0);
    let cumGen = 0;
    for (let k = 0; k <= events[events.length - 1].day; k++) cumGen += netExcl(k);
    near(cumD, cumGen, 'cumulative distributions');
    near(cumD, r.totals.cashFlow.ownerDistributions, 'totals.cashFlow.ownerDistributions');
  });

  it('owner distributions are not an expense: net profit is the same as without the distribution', () => {
    near(r.totals.income.netProfit, n.totals.income.netProfit, 'net profit with and without distributions');
    expect(n.totals.cashFlow.ownerDistributions).toBe(0);
  });
});
