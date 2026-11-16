/**
 * Independent benchmark scenarios B1–B12 (implementation-contracts §7, H13).
 *
 * Each builder returns the scenario(s) for one benchmark. The comment above each builder states the
 * hand answer, derived from the specs (simulation-design §2–§6, financial-model §1–§9), not from engine
 * output. Builders are literals or simple arithmetic only: no Math.random, no Date, no dates.
 *
 * Built on tests/simulation/helpers.ts `deterministicCompany()`, where every stochastic rate is 0,
 * except B2 (one-off arrivals are random draws) and B9 (stochastic by design).
 *
 * Conventions used in the hand answers: day 0 is a Monday and the 1st of January (startMonth 0).
 * Day d is a workday when d mod 7 < workDaysPerWeek. Payroll is paid on days with (d + 1) mod 14 = 0.
 * First-of-month days after day 0 are 31 (Feb 1), 59 (Mar 1), 90 (Apr 1), 120 (May 1), 151 (Jun 1).
 */
import type {
  Action,
  Customer,
  FinanceParams,
  MarketParams,
  Policies,
  Scenario,
  Shock,
  VehicleSpec,
  WorkforceParams,
} from '../../src/simulation';
import { customer, deterministicCompany, employee, jobType, scenario, vehicle, stochasticCompany } from '../simulation/helpers';

// ───────────── Small builders (overrides merged into the deterministic defaults) ─────────────

const det = () => deterministicCompany();
export const fin = (p: Partial<FinanceParams>): FinanceParams => ({ ...det().finance, ...p });
export const pol = (p: Partial<Policies>): Policies => ({ ...det().policies, ...p });
export const wf = (p: Partial<WorkforceParams>): WorkforceParams => ({ ...det().workforce, ...p });
export const mkt = (p: Partial<MarketParams>): MarketParams => ({ ...det().market, ...p });

/** `n` weekly mow customers on the given coordinates, phases k/n (staggered visits). */
export function mowCustomers(n: number, at: (i: number) => [number, number] = (i) => [1 + 0.5 * i, 0]): Customer[] {
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = at(i);
    return customer(`k${i}`, x, y, 'mow', { phase: i / n });
  });
}

/** The B-series "mow" job: 1 labor hour, $50, weekly. */
export const mow = () => jobType();

const SHIFT8 = pol({ shiftHours: 8, workDaysPerWeek: 5, minPaidHoursPerShift: 0 });

// ───────────── B1 ─────────────

/**
 * B1 — deterministic company, price +10%, all elasticities 0.
 * Hand answer: the price multiplier is 1.0 → 1.1 from day 0 (set-price replaces globalMultiplier, so
 * 1.1 / 1.0 − 1 = +10%). Demand is unchanged (elasticities 0), so the same orders are created and
 * completed in both runs and every order is priced 1.1×.
 *   revenue_repriced = 1.1 × revenue_base  (ratio exactly 1.1)
 *   directLabor, payrollBurden, materials, fuel, maintenance are identical (price does not move costs)
 *   badDebt = 0 (badDebtRate 0 here), so netProfit_repriced − netProfit_base = revenue Δ.
 */
export function b1PriceUp(): { base: Scenario; repriced: Scenario } {
  const company = deterministicCompany({
    jobTypes: [mow()],
    employees: [employee('e1', 'c1', { hourlyWage: 20 }), employee('e2', 'c1', { hourlyWage: 20 })],
    customers: mowCustomers(10),
    policies: SHIFT8,
    costs: { fuelPricePerGallon: 3, avgSpeedMph: 30, roadFactor: 1, stopOverheadHours: 0, overhead: [] },
  });
  const base = scenario(company, { horizonDays: 56 });
  return {
    base,
    repriced: { ...base, actions: [{ day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.1 } }] },
  };
}

// ───────────── B2 ─────────────

/**
 * B2 — as B1, but the unit price elasticity applies to one-offs only (oneOffPriceElasticity = 1).
 * Hand answer: one-off arrival rate ∝ P^(−1). A +10% price on the one-off type scales the arrival rate by
 * 1/1.1 and the revenue per job by 1.1, so one-off revenue is unchanged to first order:
 *   E[revenue_repriced] / E[revenue_base] = (1/1.1) × 1.1 = 1.
 * One-off arrivals are random draws, so this is a statistical check over seeds (within sampling noise,
 * about 1/√N for N one-off jobs), not an exact equality. Not asserted in this file.
 */
export function b2OneOffElasticity(): { base: Scenario; repriced: Scenario } {
  const cleanup = jobType({
    id: 'cleanup',
    kind: 'one-off',
    intervalDays: undefined,
    annualRatePerCustomer: 1.5,
    standardLaborHours: 6,
    basePrice: 420,
    materialCost: 40,
    minCrewSize: 2,
    minSkill: 2,
    splittable: true,
    seasonality: Array.from({ length: 12 }, () => 1),
    lateAfterDays: 14,
    cancelAfterDays: 40,
  });
  const company = deterministicCompany({
    jobTypes: [mow(), cleanup],
    employees: [employee('e1', 'c1', { hourlyWage: 20, skill: 2 }), employee('e2', 'c1', { hourlyWage: 20, skill: 2 })],
    customers: mowCustomers(40),
    policies: pol({ shiftHours: 8, workDaysPerWeek: 5, minPaidHoursPerShift: 0 }),
    market: mkt({ oneOffPriceElasticity: 1 }),
  });
  const base = scenario(company, { horizonDays: 365 });
  return {
    base,
    repriced: { ...base, actions: [{ day: 0, action: { type: 'set-price', jobTypeId: 'cleanup', multiplier: 1.1 } }] },
  };
}

// ───────────── B3 ─────────────

/**
 * B3 — a crew at exactly full capacity; add 10% more customers.
 * Hand answer: two employees × 8 h × 5 workdays = 80 person-hours a week. 80 customers on a 7-day interval
 * with 1 labor hour each demand 80 h a week, so the crew is exactly full (zero travel: all customers at the
 * depot). With 88 customers the demand is 88 h a week, so 8 h a week (8 visits) cannot be served. Those
 * visits pile up. With FIFO routing an order waits about backlog / 11.4 calendar days (80 a week ÷ 7). The backlog
 * grows by 8 a week, so the wait reaches cancelAfterDays (14) only after about 20 weeks (≈ day 140): cancellations
 * start then. That is why the horizon is 210 days, not 84 (measured: 84 days gives 0 cancellations, 570 late jobs
 * and a backlog of 114). Expected:
 *   late jobs appear in the grown run immediately; cancelled jobs appear after about day 140;
 *   revenue rises by less than 10%: the served count is capped at 80 a week, so the gain is ≈ 0 in steady state.
 * Not asserted in this file (the lead writes assertions).
 */
export function b3CapacityBound(): { base: Scenario; grown: Scenario } {
  const mowAtDepot = jobType({ lateAfterDays: 3, cancelAfterDays: 14 });
  const build = (n: number) =>
    scenario(
      deterministicCompany({
        jobTypes: [mowAtDepot],
        employees: [employee('e1', 'c1', { hourlyWage: 20 }), employee('e2', 'c1', { hourlyWage: 20 })],
        customers: Array.from({ length: n }, (_, i) => customer(`k${i}`, 0, 0, 'mow', { phase: i / n })),
        policies: SHIFT8,
      }),
      { horizonDays: 210 },
    );
  return { base: build(80), grown: build(88) };
}

// ───────────── B4 ─────────────

/**
 * B4 — idle company (no customers); add a crew at day 0 with two hires and an owned van.
 * Hand answer (horizon 28 days = 4 full weeks = 20 workdays):
 *   each hire is guaranteed 8 h a workday at $20 (minPaidHoursPerShift = 8): 2 × 8 × 20 = $320 a workday.
 *   directLabor Δ      = 20 × 320                     = 6 400
 *   payrollBurden Δ    = 0.18 × 6 400                 = 1 152
 *   depreciation Δ     = (36 500 − 0) / (10 × 365)    = 10 a day × 28 = 280
 *   revenue Δ          = 0 (no customers)
 *   netProfit Δ        = −(6 400 + 1 152 + 280)       = −7 832
 *   cash: van bought outright (method cash) = −36 500 on day 0.
 *         Payroll paid on days 13 and 27: each covers 10 workdays = 10 × 320 × 1.18 = 3 776; total −7 552.
 *         cash Δ (day 27) = −36 500 − 7 552 = −44 052.
 *   equity Δ (day 27) = cash Δ + NFA Δ (36 500 − 280) − accrued payroll Δ (0) = −7 832 = netProfit Δ.
 * The base company has the same two-person crew c1, so its own guaranteed pay cancels in the comparison.
 */
export function b4IdleAddCrew(): { base: Scenario; withCrew: Scenario } {
  const company = deterministicCompany({
    policies: pol({ shiftHours: 8, workDaysPerWeek: 5, minPaidHoursPerShift: 8 }),
    workforce: wf({ payrollBurdenRate: 0.18 }),
  });
  const van: VehicleSpec = {
    name: 'Van',
    seats: 2,
    mpg: 15,
    maintenanceCostPerMile: 0,
    purchasePrice: 36500,
    usefulLifeYears: 10,
    salvageValue: 0,
    leaseMonthly: 0,
  };
  const base = scenario(company, { horizonDays: 28 });
  const addCrew: Action = {
    type: 'add-crew',
    name: 'Crew 2',
    hires: [
      { hourlyWage: 20, skill: 2, productivity: 1 },
      { hourlyWage: 20, skill: 2, productivity: 1 },
    ],
    vehicle: { spec: van, method: 'cash' },
    equipment: [],
  };
  return { base, withCrew: { ...base, actions: [{ day: 0, action: addCrew }] } };
}

// ───────────── B5 ─────────────

/**
 * B5 — the same truck bought by cash, by loan, or by lease on day 0; idle company; horizon 60 days.
 * Truck: price 30 000, life 5 y, salvage 5 000, mpg 15, leaseMonthly 700. Loan terms (finance.newLoan):
 * 6% annual, 36 months, 20% down.
 * Hand answers:
 *   daily depreciation (cash and loan) = (30 000 − 5 000) / (5 × 365) = 13.6986… ; over 60 days = 821.9178…
 *   lease: 700 × 12 / 365 = 23.0137… a day; over 60 days = 1 380.8219… ; no depreciation, no asset on the balance sheet.
 *   loan: capex 6 000 (20% down); balance 24 000; r = 0.005; pmt = 24 000 × 0.005 / (1 − 1.005^−36) = 730.1265…
 *         payments on day 31 and day 59 (first-of-month after acquisition): interest 120 on day 31, then
 *         interest 116.9494… on the new balance of 23 389.87… on day 59. Total interest 236.9494…
 * Opening cash 40 000 (so the cash method never goes negative; the line of credit is 0).
 * Profit (netProfit, horizon total):
 *   profit_loan − profit_cash   = −(interest on loan)                       (depreciation is the same in both)
 *   profit_cash − profit_lease  = lease cost − depreciation = 1 380.8219… − 821.9178… = 558.9041…
 * Cash (end of day 59):
 *   cash_cash  = S − 30 000
 *   cash_loan  = S − 6 000 − 2 pmt
 *   cash_lease = S − 1 380.8219…
 */
export function b5AcquisitionMethods(): { cash: Scenario; loan: Scenario; lease: Scenario } {
  const truck: VehicleSpec = {
    name: 'Truck',
    seats: 2,
    mpg: 15,
    maintenanceCostPerMile: 0,
    purchasePrice: 30000,
    usefulLifeYears: 5,
    salvageValue: 5000,
    leaseMonthly: 700,
  };
  const company = deterministicCompany({
    finance: fin({ startingCash: 40000, newLoan: { annualRate: 0.06, termMonths: 36, downPaymentFraction: 0.2 } }),
  });
  const make = (method: 'cash' | 'loan' | 'lease'): Scenario =>
    scenario(company, {
      horizonDays: 60,
      actions: [{ day: 0, action: { type: 'acquire-vehicle', spec: truck, method, crewId: null } }],
    });
  return { cash: make('cash'), loan: make('loan'), lease: make('lease') };
}

// ───────────── B6 ─────────────

/**
 * B6 — dispose of a financed truck at book value above salvage.
 * Truck: price 30 000, life 5 y, salvage 5 000, age 1 y ⇒ opening book 25 000. Loan 12 000, 6%, 24 months.
 * Disposal on day 10. No loan payment falls before day 31, so the balance is still 12 000 on day 9.
 * Hand answer:
 *   daily depreciation = 25 000 / 1 825 = 13.6986…; book on day 10 = 25 000 − 10 × 13.6986… = 24 863.0137…
 *   proceeds P = 5 000 + 0.8 × (24 863.0137 − 5 000) = 20 890.4109…
 *   gain = P − B = −3 972.6027…
 *   principal paid (payoff) = 12 000 ; loan balance 0 after day 10 ; NFA 0 after day 10.
 *   equity Δ on day 10 = (P − 12 000) − B − (−12 000) = P − B = gain.
 * Engine assertions for B6 already exist in tests/simulation/disposal-actions.test.ts.
 */
export function b6DisposeAtBookAboveSalvage(): Scenario {
  const company = deterministicCompany({
    vehicles: [
      vehicle('v1', {
        asset: {
          purchasePrice: 30000,
          usefulLifeYears: 5,
          salvageValue: 5000,
          ageYears: 1,
          financing: { kind: 'loan', balance: 12000, annualRate: 0.06, monthsRemaining: 24 },
        },
      }),
    ],
  });
  return scenario(company, { horizonDays: 20, actions: [{ day: 10, action: { type: 'dispose-asset', assetId: 'v1' } }] });
}

// ───────────── B7 ─────────────

/**
 * B7 — hire at day `hireDay` in a company whose demand starts on day 45, with a 45-day ramp.
 * Demand is 0 until day 45 (demand shock × 0 on days 0–44), so there is no work and no revenue before then.
 * Hand answer for the cost difference (hire on day 0 minus hire on day 30, same wage and guarantee):
 *   the day-0 hire is paid its guaranteed 8 h on every workday from day 0; the day-30 hire from day 30.
 *   Workdays in days 0–29 (Mon–Fri): 4 weeks × 5 + Mon/Tue of week 5 = 22 workdays.
 *   Loaded pay difference = 22 × 8 h × $20 × (1 + 0.18) = 4 153.60.
 *   (The brief said "30 days"; with a 5-day week the paid days are 22. Calendar days are not paid.)
 * Revenue: equal only if the ramp does not change completions. A day-0 hire is ramped by day 45 and a day-30
 * hire is not (tenure 15 at day 45), so revenue after day 45 may differ. Not asserted in this file.
 */
export function b7HireAt(hireDay: number): Scenario {
  const company = deterministicCompany({
    customers: mowCustomers(12),
    policies: pol({ shiftHours: 8, workDaysPerWeek: 5, minPaidHoursPerShift: 8 }),
    workforce: wf({ payrollBurdenRate: 0.18, rampDays: 45, rampStartProductivity: 0.6 }),
  });
  const demandOff: Shock = { type: 'multiplier', target: 'demand', factor: 0, fromDay: 0, toDay: 45 };
  return scenario(company, {
    horizonDays: 90,
    shocks: [demandOff],
    actions: [{ day: hireDay, action: { type: 'hire-employee', crewId: 'c1', hire: { hourlyWage: 20, skill: 2, productivity: 1 } } }],
  });
}

// ───────────── B8 ─────────────

/**
 * B8 — demand × 0.8 on the deterministic company (20 weekly mow customers, phase 0, 70 days).
 * Hand answer: recurring accrual per day = seasonality × M / interval = 1 × 0.8 / 7. Over 70 days the accrual
 * reaches 70 × 0.8 / 7 = 8.0, so each customer creates exactly 8 visits, against 10 with M = 1 (70 / 7).
 * Totals: 20 × 8 = 160 recurring visits against 200. Engine assertions already exist in
 * tests/simulation/shocks.test.ts.
 */
export function b8DemandShock(): { base: Scenario; shocked: Scenario } {
  const company = deterministicCompany({
    customers: Array.from({ length: 20 }, (_, i) => customer(`k${i}`, 1 + 0.5 * (i % 5), 0.5 * Math.floor(i / 5), 'mow', { phase: 0 })),
  });
  const base = scenario(company, { horizonDays: 70 });
  const shock: Shock = { type: 'multiplier', target: 'demand', factor: 0.8, fromDay: 0, toDay: 70 };
  return { base, shocked: { ...base, shocks: [shock] } };
}

// ───────────── B9 ─────────────

/**
 * B9 — two identical stochastic scenarios that differ only in seed (1 and 2), 60 days.
 * Hand answer: the draws differ, so the outcomes differ. The opening balance sheet is the same in both: no
 * fixed assets (price 0), no loans, AR 0, accrued payroll 0, so opening equity = startingCash = 10 000.
 * On day 0: equity_0 − netProfit_0 = 10 000 in both runs, because equity_t − equity_{t−1} = netProfit_t.
 * The identities of financial-model §9 hold in both runs.
 */
export function b9SeedPair(): [Scenario, Scenario] {
  const company = deterministicCompany({
    customers: mowCustomers(30, (i) => [0.4 * (i % 6), 0.4 * Math.floor(i / 6)]),
    market: mkt({ organicLeadsPerMonth: 4, leadSeasonality: Array.from({ length: 12 }, () => 1), baseConversionRate: 0.6, baseMonthlyChurn: 0.02 }),
    workforce: wf({ absenceRate: 0.1 }),
    weather: { rainoutProbByMonth: Array.from({ length: 12 }, () => 0.2), partialProbByMonth: Array.from({ length: 12 }, () => 0.1), partialDayFraction: 0.5 },
    reliability: {
      vehicle: { dailyProb: 0.01, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 2, repairCostMin: 100, repairCostMax: 300 },
      equipment: { dailyProb: 0, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 1, repairCostMin: 0, repairCostMax: 0 },
    },
    policies: pol({ shiftHours: 8, workDaysPerWeek: 5, minPaidHoursPerShift: 4 }),
    finance: fin({ startingCash: 10000 }),
  });
  return [scenario(company, { horizonDays: 60, seed: 1 }), scenario(company, { horizonDays: 60, seed: 2 })];
}

/** A stochastic reference company for other benchmarks that need realistic noise (uses the shared helper). */
export function stochasticReference(nCustomers = 40): Scenario {
  return scenario(stochasticCompany(nCustomers, 2), { horizonDays: 90, seed: 3 });
}

// ───────────── B10 ─────────────

export interface StationaryOptions {
  workDaysPerWeek?: number;
  intervalDays?: number;
}

/**
 * B10 — every stochastic rate 0, run for three years (1 095 days). Year 2 must equal year 3 on every flow line
 * when dynamics are off (stationarity).
 *
 * The years are the engine's 365-day blocks: year 2 = days 365–729, year 3 = days 730–1094. The calendar has
 * 365-day years (simulation-engine §2), so day 365 is a Jan 1 again, and seasonality by month repeats.
 * Weekdays do not: 365 = 52 × 7 + 1, so year 2 starts on a Tuesday and year 3 on a Wednesday.
 *
 * Default setup (exact by construction, options workDaysPerWeek = 7, intervalDays = 5):
 *  - every day is a workday, so nothing depends on the weekday;
 *  - intervalDays 5 divides 365, so each customer's accrual is restored after 365 days (365 / 5 = 73 visits a year);
 *  - constant seasonality, so the daily accrual is the same every day;
 *  - the guaranteed 8 h a workday (minPaidHoursPerShift = shift) makes each day's wage the same. This matters: a
 *    14-day pay cycle pays a 364-day window of accrual each year, which is not a multiple of the year, so with
 *    variable daily wages the year-2 and year-3 payrolls pick up different days (measured: 1.33 apart with minPaid 0);
 *  - weekly overtime is booked on day mod 7 = 6 for full weeks only, the same amount each week.
 * Other options (for example 5 workdays and intervalDays 7) break the 365-day periodicity; the
 * test reports the numbers instead of loosening the comparison.
 */
export function b10Stationary(opts: StationaryOptions = {}): Scenario {
  const workDaysPerWeek = opts.workDaysPerWeek ?? 7;
  const intervalDays = opts.intervalDays ?? 5;
  const mowEvery = jobType({ intervalDays, lateAfterDays: 3, cancelAfterDays: 14 });
  const company = deterministicCompany({
    jobTypes: [mowEvery],
    employees: [employee('e1', 'c1', { hourlyWage: 20 }), employee('e2', 'c1', { hourlyWage: 20 })],
    customers: Array.from({ length: 20 }, (_, i) => customer(`k${i}`, 0.5 * (i % 5), 0.5 * Math.floor(i / 5), 'mow', { phase: i / 20 })),
    policies: pol({ shiftHours: 8, workDaysPerWeek, minPaidHoursPerShift: 8, maxOvertimeHoursPerDay: 0 }),
  });
  return scenario(company, { horizonDays: 1095, seed: 1 });
}

// ───────────── B11 ─────────────

/**
 * B11 — fatigue-only company with constant 50-hour weeks (two employees, 10-hour shifts, 5 workdays,
 * guaranteed 10 h, overtime threshold 100 so none is booked). Fatigue parameters: θ = 45, κ_p = 0.2,
 * κ_q = 2, κ_a = 1.
 * Hand answer from day 28 on: h̄ = 200 × 7 / 28 = 50 (each employee); fatigue = (50 − 45) / 10 = 0.5;
 * productivity multiplier = max(0.7, 1 − 0.2 × 0.5) = 0.9; quit multiplier 1 + 2 × 0.5 = 2; absence multiplier 1.5.
 * Engine assertions already exist in tests/simulation/dynamics.test.ts (B11 block).
 */
export function b11FatigueOnly(): Scenario {
  const company = deterministicCompany({
    customers: Array.from({ length: 80 }, (_, i) => customer(`k${i}`, 0.5 + (i % 8) * 0.05, Math.floor(i / 8) * 0.05, 'mow', { phase: (i % 7) / 7 })),
    policies: pol({ shiftHours: 10, workDaysPerWeek: 5, minPaidHoursPerShift: 10, maxOvertimeHoursPerDay: 0 }),
    workforce: wf({
      overtimeWeeklyThresholdHours: 100,
      annualTurnoverRate: 0.6,
      absenceRate: 0.04,
      fatigueThresholdHours: 45,
      productivityFatigueLoss: 0.2,
      quitFatigueWeight: 2,
      absenceFatigueWeight: 1,
    }),
  });
  return scenario(company, { horizonDays: 70 });
}

// ───────────── B12 ─────────────

/**
 * B12 — owner distribution above X = 10 000 with constant positive cash flow.
 * Starting cash = X = 10 000, no reserve, no line of credit, collections the same day. 40 weekly mow customers
 * at $50 a visit (≈ $2 000 a week of revenue) against two employees' wages for the hours worked. Net cash is
 * positive every month; the test asserts each distribution is positive, so this is checked, not assumed.
 * Distributions fall on first-of-month days after day 0: 31, 59, 90 and 120 (horizon 150).
 * Hand identities:
 *  - on each distribution day, cash after the distribution = X = 10 000 (month-end cash equals X);
 *  - the distribution equals the net cash generated since the previous distribution (cash starts at X, so the
 *    first one includes day 0);
 *  - cumulative distributions = cumulative net cash generated above X (net cash excluding distributions,
 *    summed up to the last distribution day);
 *  - owner distributions are not an expense: netProfit is the same as in the same run without X.
 */
export function b12OwnerDistribution(): { withDistribution: Scenario; withoutDistribution: Scenario } {
  const build = (distributeAbove: number | undefined) =>
    deterministicCompany({
      jobTypes: [mow()],
      employees: [employee('e1', 'c1', { hourlyWage: 20 }), employee('e2', 'c1', { hourlyWage: 20 })],
      customers: mowCustomers(40, (i) => [0.5 * (i % 8), 0.5 * Math.floor(i / 8)]),
      policies: pol({ shiftHours: 8, workDaysPerWeek: 5, minPaidHoursPerShift: 0 }),
      finance: fin({
        startingCash: 10000,
        minCashReserve: 0,
        ownerDistributionCashAbove: distributeAbove,
      }),
    });
  return {
    withDistribution: scenario(build(10000), { horizonDays: 150 }),
    withoutDistribution: scenario(build(undefined), { horizonDays: 150 }),
  };
}
