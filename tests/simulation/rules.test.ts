/**
 * E5: decision rules (simulation-design §9; implementation-contracts §3 row "Rules", common C, D, F).
 * Expected firing days are computed by hand from the calendar in the comments.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, validateScenario, type CompanyConfig, type DecisionRule, type Scenario, type SimulationResult, type VehicleSpec } from '../../src/simulation';
import { compare, safeRatio, substituteEach, trailing } from '../../src/simulation/rules';
import { assertInvariants } from './invariants';
import { customer, deterministicCompany, employee, scenario, vehicle } from './helpers';
import { stochasticMid } from './scenarios';

const firings = (r: SimulationResult, id: string) => r.events.filter((e) => e.type === 'rule-fired' && e.ruleId === id).map((e) => e.day);
function run(s: Scenario): SimulationResult {
  const r = runSimulation(s);
  assertInvariants(s, r);
  return r;
}

const marketingRule = (over: Partial<DecisionRule> = {}): DecisionRule => ({
  id: 'feb-marketing',
  name: 'Market harder in February',
  when: [{ observable: 'month', op: '==', value: 1 }],
  then: [{ type: 'set-marketing-spend', monthlySpend: 900 }],
  cooldownDays: 0,
  maxFirings: 1,
  ...over,
});

describe('rules: firing semantics', () => {
  // startMonth 0 (January); January has 31 days, so day 31 is 1 February and day 59 is 1 March.
  it('a month rule fires on the first day of that month only (maxFirings 1)', () => {
    const r = run(scenario(deterministicCompany(), { horizonDays: 120, rules: [marketingRule()] }));
    expect(firings(r, 'feb-marketing')).toEqual([31]);
  });

  it('respects cooldownDays and maxFirings', () => {
    // cooldown 10, max 3: days 31, 41, 51 (all in February, which runs to day 58).
    const r = run(scenario(deterministicCompany(), { horizonDays: 120, rules: [marketingRule({ cooldownDays: 10, maxFirings: 3 })] }));
    expect(firings(r, 'feb-marketing')).toEqual([31, 41, 51]);
    // cooldown 20, max 5: days 31, 51 (71 is in March).
    const r2 = run(scenario(deterministicCompany(), { horizonDays: 120, rules: [marketingRule({ cooldownDays: 20, maxFirings: 5 })] }));
    expect(firings(r2, 'feb-marketing')).toEqual([31, 51]);
  });

  it('activeFromDay / activeToDay bound the window', () => {
    const rule: DecisionRule = { ...marketingRule({ cooldownDays: 7, maxFirings: 99 }), when: [], activeFromDay: 10, activeToDay: 30 };
    const r = run(scenario(deterministicCompany(), { horizonDays: 40, rules: [rule] }));
    expect(firings(r, 'feb-marketing')).toEqual([10, 17, 24]);
  });

  it('a rule-driven run equals the scripted run with the same actions on the firing days', () => {
    const base = scenario(stochasticMid(4).company, { horizonDays: 120, seed: 4 });
    // startMonth 3 (April): 1 June is day 30 + 31 = 61.
    const ruled = run({ ...base, rules: [marketingRule({ when: [{ observable: 'month', op: '==', value: 5 }] })] });
    const fired = firings(ruled, 'feb-marketing');
    expect(fired).toEqual([61]);
    const scripted = run({ ...base, actions: [{ day: fired[0], action: { type: 'set-marketing-spend', monthlySpend: 900 } }] });
    expect(ruled.days).toEqual(scripted.days);
    const strip = (r: SimulationResult) => r.events.filter((e) => e.type !== 'rule-fired');
    expect(strip(ruled)).toEqual(strip(scripted));
  });

  it('prefix identity: a rule first firing on day d leaves days < d unchanged', () => {
    const base = scenario(stochasticMid(2).company, { horizonDays: 90, seed: 2 });
    const a = run(base);
    const b = run({ ...base, rules: [{ ...marketingRule(), when: [{ observable: 'day', op: '>=', value: 45 }] }] });
    expect(firings(b, 'feb-marketing')).toEqual([45]);
    expect(b.days.slice(0, 45)).toEqual(a.days.slice(0, 45));
  });

  it('observables read the previous day: cash below a threshold reacts one day later', () => {
    // No revenue; overhead 36 500/year = 100/day exactly (36 500 / 365); starting cash 10 000.
    // End-of-day cash: day t → 10 000 − 100 (t + 1). cash < 9 500 first at the end of day 5,
    // so the rule fires on day 6.
    const base = deterministicCompany();
    const company: CompanyConfig = { ...base, costs: { ...base.costs, overhead: [{ id: 'o', name: 'o', monthlyAmount: 36500 / 12 }] } };
    const r = run(
      scenario(company, {
        horizonDays: 10,
        rules: [{ ...marketingRule(), id: 'low-cash', when: [{ observable: 'cash', op: '<', value: 9500 }], then: [{ type: 'set-marketing-spend', monthlySpend: 0 }] }],
      }),
    );
    expect(r.days[5].balance.cash).toBeCloseTo(9400, 9);
    expect(firings(r, 'low-cash')).toEqual([6]);
  });

  it('a scoped observable whose entity no longer exists makes the condition false', () => {
    const rule: DecisionRule = {
      id: 'small-crew',
      name: 'n',
      when: [{ observable: 'crew-size', scope: { crewId: 'c1' }, op: '<', value: 5 }],
      then: [{ type: 'set-marketing-spend', monthlySpend: 1 }],
      cooldownDays: 1,
      maxFirings: 99,
    };
    const r = run(scenario(deterministicCompany(), { horizonDays: 6, rules: [rule], actions: [{ day: 3, action: { type: 'remove-crew', crewId: 'c1' } }] }));
    // Actions run before rules, so on day 3 the crew is already gone: fires on days 0, 1, 2 only.
    expect(firings(r, 'small-crew')).toEqual([0, 1, 2]);
  });
});

describe('rules: forEach', () => {
  const spec: VehicleSpec = { name: 'New truck', seats: 3, mpg: 20, maintenanceCostPerMile: 0, purchasePrice: 30000, usefulLifeYears: 5, salvageValue: 5000, leaseMonthly: 0 };

  it('a forEach vehicle upkeep rule replaces only the vehicle that crosses the threshold', () => {
    // Two crews, same routes; v1 costs 1/mile in upkeep, v2 0.01/mile. Threshold 50 is crossed by v1 only.
    const company = deterministicCompany({
      employees: [employee('e1', 'c1'), employee('e2', 'c2')],
      crews: [
        { id: 'c1', name: 'Crew 1', vehicleId: 'v1' },
        { id: 'c2', name: 'Crew 2', vehicleId: 'v2' },
      ],
      vehicles: [vehicle('v1', { maintenanceCostPerMile: 1 }), vehicle('v2', { maintenanceCostPerMile: 0.01 })],
      customers: Array.from({ length: 10 }, (_, i) => customer(`k${i}`, 5 + (i % 2), i % 2 === 0 ? 3 : -3, 'mow', { phase: i / 10 })),
    });
    const rule: DecisionRule = {
      id: 'replace-worn',
      name: 'Replace a truck when upkeep is excessive',
      forEach: 'vehicle',
      when: [{ observable: 'asset-upkeep-365d', scope: { assetId: '$each' }, op: '>', value: 50 }],
      then: [{ type: 'replace-asset', assetId: '$each', spec, method: 'cash' }],
      cooldownDays: 1000,
      maxFirings: 1,
    };
    const r = run(scenario(company, { horizonDays: 28, rules: [rule] }));
    const fired = r.events.filter((e) => e.type === 'rule-fired');
    expect(fired.map((e) => e.type === 'rule-fired' && e.entityId)).toEqual(['v1']);
    const disposed = r.events.filter((e) => e.type === 'asset-disposed').map((e) => e.type === 'asset-disposed' && e.assetId);
    expect(disposed).toEqual(['v1']);
    // the replacement carries the stable rule tag in its id and takes over crew c1
    const day = fired[0].day;
    const newId = `a-d${day}-rule:replace-worn@v1:1:0-0`;
    expect(r.crewLogs![day].find((l) => l.crewId === 'c1')!.vehicleId).toBe(newId);
    // upkeep before firing exceeded 50 on v1: the firing day is the first day after crossing
    const v1Upkeep = (t: number) => r.days.slice(0, t).reduce((s, _d, i) => s + (r.crewLogs![i].find((l) => l.crewId === 'c1')?.miles ?? 0), 0);
    expect(v1Upkeep(day)).toBeGreaterThan(50);
    expect(v1Upkeep(day - 1)).toBeLessThanOrEqual(50);
  });
});

describe('rules: determinism and identities on a stochastic company', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, () => {
      const base = stochasticMid(seed);
      const crew = base.company.crews[0].id;
      const s: Scenario = {
        ...base,
        rules: [
          {
            id: 'backlog-hire',
            name: 'Hire when the backlog stays high',
            when: [
              { observable: 'backlog-hours', op: '>', value: 5 },
              { observable: 'missed-rate-28d', op: '>', value: 0.01 },
            ],
            then: [{ type: 'hire-employee', crewId: crew, hire: { hourlyWage: 20, skill: 1, productivity: 0.9 } }],
            cooldownDays: 30,
            maxFirings: 3,
          },
          {
            id: 'crew-floor',
            name: 'Keep crews staffed',
            forEach: 'crew',
            when: [{ observable: 'crew-size', scope: { crewId: '$each' }, op: '<', value: 2 }],
            then: [{ type: 'hire-employee', crewId: '$each', hire: { hourlyWage: 19, skill: 1, productivity: 1 } }],
            cooldownDays: 14,
            maxFirings: 5,
          },
          {
            id: 'slow-month',
            name: 'Cut marketing in slow months',
            when: [{ observable: 'utilization-28d', op: '<', value: 0.9 }, { observable: 'day', op: '>', value: 30 }],
            then: [{ type: 'set-marketing-spend', monthlySpend: 100 }],
            cooldownDays: 60,
            maxFirings: 2,
          },
        ],
      };
      const r1 = run(s);
      const r2 = runSimulation(s);
      expect(r2).toEqual(r1);
      expect(r1.events.some((e) => e.type === 'rule-fired')).toBe(true);
    });
  }
});

describe('rules: pure helpers (hand values)', () => {
  it('compare, safeRatio, trailing, substituteEach', () => {
    expect([compare(1, '<', 2), compare(2, '<=', 2), compare(3, '>', 2), compare(2, '>=', 3), compare(2, '==', 2), compare(2, '!=', 2)]).toEqual([true, true, true, false, true, false]);
    expect(safeRatio(1, 0)).toBe(0);
    expect(safeRatio(1, 4)).toBe(0.25);
    const days = [1, 2, 3, 4, 5].map((v) => ({ ops: { jobsCompleted: v } }) as never);
    // last 3 records before day 5: 3 + 4 + 5 = 12; before day 2 with n 28: 1 + 2 = 3
    expect(trailing(days, 5, 3, (d: { ops: { jobsCompleted: number } }) => d.ops.jobsCompleted)).toBe(12);
    expect(trailing(days, 2, 28, (d: { ops: { jobsCompleted: number } }) => d.ops.jobsCompleted)).toBe(3);
    expect(substituteEach({ a: '$each', b: ['$each', 'x'], c: 1 }, 'v9')).toEqual({ a: 'v9', b: ['v9', 'x'], c: 1 });
  });
});

describe('rules: validation (IC §3 F)', () => {
  const s = scenario(deterministicCompany(), { horizonDays: 5 });
  const errs = (rules: DecisionRule[]) => validateScenario({ ...s, rules }).filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.message}`);

  it('accepts a well-formed rule', () => {
    expect(errs([marketingRule()])).toEqual([]);
  });
  it('rejects unknown observables, dangling scope ids, $each without forEach, bad counters and windows', () => {
    expect(errs([marketingRule({ when: [{ observable: 'mood' as never, op: '>', value: 1 }] })])).toEqual(['rules[0].when[0].observable: unknown observable mood']);
    expect(errs([marketingRule({ when: [{ observable: 'crew-size', scope: { crewId: 'ghost' }, op: '>', value: 1 }] })])).toEqual(['rules[0].when[0].scope: unknown crew ghost']);
    expect(errs([marketingRule({ when: [{ observable: 'asset-age-years', op: '>', value: 1 }] })])).toEqual(['rules[0].when[0].scope: asset-age-years needs scope.assetId']);
    expect(errs([marketingRule({ then: [{ type: 'dispose-asset', assetId: '$each' }] })])).toEqual(["rules[0]: '$each' used without forEach"]);
    expect(errs([marketingRule({ forEach: 'crew', when: [{ observable: 'asset-age-years', scope: { assetId: '$each' }, op: '>', value: 1 }] })])).toEqual([
      "rules[0].when[0].scope: '$each' does not match forEach crew",
    ]);
    expect(errs([marketingRule({ cooldownDays: -1 })])).toEqual(['rules[0].cooldownDays: must be an integer >= 0']);
    expect(errs([marketingRule({ activeFromDay: 5, activeToDay: 5 })])).toEqual(['rules[0].activeToDay: must be an integer > activeFromDay']);
    expect(errs([marketingRule(), marketingRule()])).toEqual(['rules[1].id: duplicate rule id feb-marketing']);
  });
});
