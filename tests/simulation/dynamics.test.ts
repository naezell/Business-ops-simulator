/**
 * E6: workforce, customer and asset dynamics (simulation-design §3–§5; implementation-contracts §3 rows
 * "Fatigue", "Learning, raises, pay, tenure", "Referrals / saturation / tenure churn", "Aging upkeep"; B11).
 * Expected values are derived by hand in the comments.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, type CompanyConfig, type Scenario, type SimulationResult } from '../../src/simulation';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { assertInvariants } from './invariants';
import { customer, deterministicCompany, employee, months, scenario, vehicle } from './helpers';
import { stochasticMid } from './scenarios';

function run(s: Scenario): SimulationResult {
  const r = runSimulation(s);
  assertInvariants(s, r);
  return r;
}

/**
 * Overloaded deterministic company: one crew of two (productivity 1, tenure 1000, ramp off), 10-hour
 * shifts paid in full (minPaid = shift), 5 workdays, many nearby customers so the crew always works.
 * Every employee is paid exactly 10 h on each workday ⇒ 50 h per calendar week.
 */
function overloaded(over: Partial<CompanyConfig['workforce']> = {}, shift = 10): CompanyConfig {
  const base = deterministicCompany({
    customers: Array.from({ length: 80 }, (_, i) => customer(`k${i}`, 0.5 + (i % 8) * 0.05, Math.floor(i / 8) * 0.05, 'mow', { phase: (i % 7) / 7 })),
  });
  return {
    ...base,
    policies: { ...base.policies, shiftHours: shift, minPaidHoursPerShift: shift },
    workforce: { ...base.workforce, overtimeWeeklyThresholdHours: 100, ...over },
  };
}

/** Standard hours completed per on-site person-hour on day d = mean productivity of the deployed crew. */
const rateOn = (r: SimulationResult, d: number) => r.days[d].ops.completedLaborHours / r.days[d].ops.onSiteHours;

describe('fatigue (B11)', () => {
  it('constant 50-hour weeks: from day 28 h̄ = 50, fatigue = (50 − 45)/10 = 0.5, productivity × (1 − 0.2 × 0.5) = 0.9', () => {
    const r = run(scenario(overloaded({ fatigueThresholdHours: 45, productivityFatigueLoss: 0.2 }), { horizonDays: 70 }));
    // Paid hours: 10 on every workday for both employees.
    for (const d of r.days) if (d.isWorkday) expect(d.ops.paidHours).toBe(20);
    // Days 0–6: n < 7 ⇒ h̄ = 0 ⇒ productivity 1.
    for (let d = 0; d < 5; d++) expect(rateOn(r, d)).toBeCloseTo(1, 9);
    // Days ≥ 28: the last 28 days hold 20 workdays × 10 h = 200 h ⇒ h̄ = 200 × 7 / 28 = 50.
    for (let d = 28; d < 70; d++) if (r.days[d].isWorkday) expect(rateOn(r, d)).toBeCloseTo(0.9, 9);
    // Day 14 (Monday): n = 14, last 14 days = 10 workdays = 100 h ⇒ h̄ = 50 as well.
    expect(rateOn(r, 14)).toBeCloseTo(0.9, 9);
    // Day 7 (Monday): n = 7, days 0–6 hold 5 workdays = 50 h ⇒ h̄ = 50.
    expect(rateOn(r, 7)).toBeCloseTo(0.9, 9);
  });

  it('no fatigue below the threshold (8-hour shifts, 40-hour weeks, θ = 45)', () => {
    const r = run(scenario(overloaded({ fatigueThresholdHours: 45, productivityFatigueLoss: 0.2 }, 8), { horizonDays: 42 }));
    // From day 28 the window is exactly four weeks: 20 workdays × 8 h = 160 h ⇒ h̄ = 40 < 45 ⇒ no fatigue.
    for (let d = 28; d < 42; d++) if (r.days[d].isWorkday) expect(rateOn(r, d)).toBeCloseTo(1, 9);
    // Before day 28 the window n = day is not always whole weeks (simulation-design §3 as written):
    // day 11 (Thu): days 0–10 hold 9 workdays = 72 h ⇒ h̄ = 72 × 7 / 11 = 45.818… ⇒ fatigue 0.0818…
    // ⇒ productivity 1 − 0.2 × 0.0818… = 0.98364 (a transient of the short window).
    expect(rateOn(r, 11)).toBeCloseTo(1 - 0.2 * ((72 * 7) / 11 - 45) / 10, 9);
    // day 10 (Wed): days 0–9 hold 8 workdays = 64 h ⇒ h̄ = 44.8 < 45 ⇒ 1.
    expect(rateOn(r, 10)).toBeCloseTo(1, 9);
  });

  it('productivity loss is floored at 0.7', () => {
    // fatigue 0.5, loss 1 ⇒ 1 − 0.5 = 0.5 → floor 0.7.
    const r = run(scenario(overloaded({ fatigueThresholdHours: 45, productivityFatigueLoss: 1 }), { horizonDays: 35 }));
    expect(rateOn(r, 30)).toBeCloseTo(0.7, 9);
  });

  it('10-hour shifts raise quits versus 8-hour shifts over a year (several seeds)', () => {
    let q8 = 0;
    let q10 = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const base = stochasticMid(seed);
      const co = base.company;
      const dyn = { ...co.workforce, annualTurnoverRate: 0.4, fatigueThresholdHours: 42, quitFatigueWeight: 3 };
      const mk = (shift: number): Scenario => ({
        ...base,
        horizonDays: 365,
        company: { ...co, workforce: dyn, policies: { ...co.policies, shiftHours: shift, minPaidHoursPerShift: shift } },
      });
      q8 += run(mk(8)).totals.ops.quits;
      q10 += run(mk(10)).totals.ops.quits;
    }
    expect(q10).toBeGreaterThan(q8);
  });
});

describe('learning, raises, pay and tenure', () => {
  it('learning: productivity = 1 + G (1 − e^(−τ/L)) at the employees’ tenure', () => {
    // Tenure 1000 at day 0; on day d, τ = 1000 + d. G = 0.15, L = 120.
    const r = run(scenario(overloaded({ learningGain: 0.15, learningDays: 120 }, 8), { horizonDays: 10 }));
    for (const d of [0, 3, 8]) expect(rateOn(r, d)).toBeCloseTo(1 + 0.15 * (1 - Math.exp(-(1000 + d) / 120)), 9);
  });

  it('learning for a new hire: τ = 0 on the hire day ⇒ learn = 1; τ = 60 ⇒ 1 + 0.2 (1 − e^(−0.5))', () => {
    // A solo crew whose only member is hired on day 0 by an action (ramp off).
    const base = overloaded({ learningGain: 0.2, learningDays: 120 }, 8);
    const company: CompanyConfig = { ...base, employees: [] };
    const s = scenario(company, {
      horizonDays: 61,
      actions: [{ day: 0, action: { type: 'hire-employee', crewId: 'c1', hire: { hourlyWage: 20, skill: 2, productivity: 1 } } }],
    });
    const r = run(s);
    expect(rateOn(r, 0)).toBeCloseTo(1, 9);
    expect(rateOn(r, 60)).toBeCloseTo(1 + 0.2 * (1 - Math.exp(-0.5)), 9); // day 60 is a Thursday
  });

  it('annual raise: wages × 1.03 from day 365 (direct labor Tue day 365 / Mon day 364 = 1.03)', () => {
    const r = run(scenario(overloaded({ annualRaiseRate: 0.03 }, 8), { horizonDays: 367 }));
    expect(r.days[364].ops.paidHours).toBe(r.days[365].ops.paidHours);
    expect(r.days[365].income.directLabor / r.days[364].income.directLabor).toBeCloseTo(1.03, 12);
    expect(r.days[1].income.directLabor).toBe(r.days[364].income.directLabor);
  });

  it('higher wage ⇒ fewer quits (CRN): every quit at the high wage also happens at the low wage no later', () => {
    for (const seed of [1, 2, 3, 4]) {
      const base = stochasticMid(seed);
      const co = base.company;
      const wf = { ...co.workforce, annualTurnoverRate: 0.6, wageQuitElasticity: 2, marketWageBySkill: [20, 20, 22, 26], autoBackfill: false };
      const s: Scenario = { ...base, horizonDays: 300, company: { ...co, workforce: wf, policies: { ...co.policies, autoBackfill: false } } };
      const low = run(s);
      const high = run({ ...s, actions: [{ day: 0, action: { type: 'set-wage', employeeId: 'all', multiplier: 1.25 } }] });
      const quitDay = (r: SimulationResult) => new Map(r.events.flatMap((e) => (e.type === 'employee-quit' ? [[e.employeeId, e.day] as const] : [])));
      const ql = quitDay(low);
      const qh = quitDay(high);
      for (const [id, d] of qh) {
        expect(ql.has(id), `${id} quit at high wage but not at low wage`).toBe(true);
        expect(ql.get(id)!).toBeLessThanOrEqual(d);
      }
      expect(qh.size).toBeLessThanOrEqual(ql.size);
    }
  });

  it('early-tenure quit boost: a new hire quits at least as early as with no boost (CRN)', () => {
    const base = stochasticMid(9);
    const co = base.company;
    const s: Scenario = { ...base, horizonDays: 200, company: { ...co, workforce: { ...co.workforce, annualTurnoverRate: 0.5 } } };
    const plain = run(s);
    const boosted = run({ ...s, company: { ...s.company, workforce: { ...s.company.workforce, earlyTenureQuitBoost: 3 } } });
    expect(boosted.totals.ops.quits).toBeGreaterThanOrEqual(plain.totals.ops.quits);
  });
});

describe('customer dynamics', () => {
  /** No churn, no conversion: the customer set is fixed, so only the lead rate moves. */
  const fixedSet = (refs: number, marketSize?: number, cap = 1): CompanyConfig => {
    const base = deterministicCompany({
      customers: Array.from({ length: 40 }, (_, i) => customer(`k${i}`, (i % 10) * 0.8, Math.floor(i / 10) * 0.8, 'mow', { phase: i / 40 })),
      vehicles: [vehicle('v1', { seats: cap })],
      employees: [employee('e1', 'c1'), employee('e2', 'c1')],
    });
    return {
      ...base,
      jobTypes: [{ ...base.jobTypes[0], cancelAfterDays: 3, standardLaborHours: 2 }],
      market: { ...base.market, organicLeadsPerMonth: 6, leadSeasonality: months(1), referralsPerCustomerYear: refs, marketSize },
    };
  };

  it('better service ⇒ at least as many leads every day (same LEADS draw)', () => {
    // seats 1 ⇒ half the capacity ⇒ cancellations ⇒ failure scores ⇒ lower S ⇒ lower λ.
    const good = run(scenario(fixedSet(12, undefined, 2), { horizonDays: 120, seed: 3 }));
    const bad = run(scenario(fixedSet(12, undefined, 1), { horizonDays: 120, seed: 3 }));
    expect(bad.totals.ops.jobsCancelled).toBeGreaterThan(good.totals.ops.jobsCancelled);
    for (let d = 0; d < 120; d++) expect(good.days[d].ops.leads).toBeGreaterThanOrEqual(bad.days[d].ops.leads);
    expect(good.totals.ops.leads).toBeGreaterThan(bad.totals.ops.leads);
  });

  it('referrals add leads (same draw): referrals on ⇒ leads ≥ referrals off on every day', () => {
    const off = run(scenario(fixedSet(0), { horizonDays: 90, seed: 5 }));
    const on = run(scenario(fixedSet(20), { horizonDays: 90, seed: 5 }));
    for (let d = 0; d < 90; d++) expect(on.days[d].ops.leads).toBeGreaterThanOrEqual(off.days[d].ops.leads);
    expect(on.totals.ops.leads).toBeGreaterThan(off.totals.ops.leads);
  });

  it('marketSize reached ⇒ zero leads', () => {
    const r = run(scenario(fixedSet(20, 40), { horizonDays: 60, seed: 2 }));
    expect(r.totals.ops.leads).toBe(0);
  });

  it('new-customer churn boost: acquired customers churn at least as fast (same CHURN draw)', () => {
    let a = 0;
    let b = 0;
    for (const seed of [1, 2, 3]) {
      const base = stochasticMid(seed);
      const co = base.company;
      a += run({ ...base, horizonDays: 200 }).totals.ops.churnedCustomers;
      b += run({ ...base, horizonDays: 200, company: { ...co, market: { ...co.market, newCustomerChurnBoost: 4 } } }).totals.ops.churnedCustomers;
    }
    expect(b).toBeGreaterThan(a);
  });
});

describe('asset aging upkeep', () => {
  it('maintenance per mile at age 5 with factor 0.1 is 1.5 × the age-0 rate (day 0, hand-computed)', () => {
    // rate 0.2 $/mile; age 5 ⇒ 0.2 × (1 + 0.1 × 5) = 0.3 $/mile on day 0.
    const mk = (age: number): CompanyConfig => {
      const base = overloaded({}, 8);
      return {
        ...base,
        vehicles: [vehicle('v1', { maintenanceCostPerMile: 0.2, asset: { purchasePrice: 0, usefulLifeYears: 5, salvageValue: 0, ageYears: age, financing: { kind: 'owned' } } })],
        reliability: { ...base.reliability, vehicle: { ...base.reliability.vehicle, maintenanceAgeFactorPerYear: 0.1 } },
      };
    };
    const young = run(scenario(mk(0), { horizonDays: 1 }));
    const old = run(scenario(mk(5), { horizonDays: 1 }));
    const miles = young.days[0].ops.milesDriven;
    expect(old.days[0].ops.milesDriven).toBe(miles);
    expect(young.days[0].income.maintenance).toBeCloseTo(0.2 * miles, 9);
    expect(old.days[0].income.maintenance).toBeCloseTo(0.3 * miles, 9);
  });
});

describe('all dynamics on: determinism, prefix identity and identities', () => {
  for (const seed of [1, 2, 3]) {
    it(`twin-90 demo, seed ${seed}`, () => {
      const s = { ...(createDemoTwinScenario() as Scenario), seed };
      const r1 = run(s);
      expect(runSimulation(s)).toEqual(r1);
    });
  }
  it('an action on day d leaves days < d unchanged with dynamics on', () => {
    const s = createDemoTwinScenario() as Scenario;
    const a = run(s);
    const b = run({ ...s, actions: [{ day: 40, action: { type: 'set-wage', employeeId: 'all', multiplier: 1.1 } }] });
    expect(b.days.slice(0, 40)).toEqual(a.days.slice(0, 40));
  });
});
