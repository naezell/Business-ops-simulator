/**
 * E7: floating idle workers (simulation-design §7; implementation-contracts §3 row "Floating").
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, type CompanyConfig, type Scenario, type SimulationResult } from '../../src/simulation';
import { assertInvariants } from './invariants';
import { customer, deterministicCompany, employee, scenario, vehicle } from './helpers';
import { stochasticMid } from './scenarios';

function run(s: Scenario): SimulationResult {
  const r = runSimulation(s);
  assertInvariants(s, r);
  return r;
}

/** Two crews of two on three-seat trucks, lots of work; e5 has no crew. */
function twoCrews(float: boolean): CompanyConfig {
  const base = deterministicCompany({
    employees: [employee('e1', 'c1'), employee('e2', 'c1'), employee('e3', 'c2', { skill: 3 }), employee('e4', 'c2'), employee('e5', null, { skill: 1 })],
    crews: [
      { id: 'c1', name: 'Crew 1', vehicleId: 'v1' },
      { id: 'c2', name: 'Crew 2', vehicleId: 'v2' },
    ],
    vehicles: [vehicle('v1'), vehicle('v2')],
    customers: Array.from({ length: 60 }, (_, i) => customer(`k${i}`, 0.5 + (i % 6) * 0.1, Math.floor(i / 6) * 0.1, 'mow', { phase: (i % 7) / 7 })),
  });
  return { ...base, policies: { ...base.policies, minPaidHoursPerShift: 8, floatIdleWorkers: float } };
}

describe('floating idle workers', () => {
  it('crewless employee e5 joins the crew with the fewest members; with c2 out of a truck its members float to c1', () => {
    // Day 0: both crews deploy with 2 of 3 seats; pool = [e5] → joins c1 (tie on size, config order).
    // Days 2–4: v2 out (outage) → c2 cannot deploy; pool = e3 (skill 3), e4, e5 (skill 1) in that order;
    // c1 has one free seat → e3 joins; e4 and e5 stay in the pool (paid idle).
    const s = scenario(twoCrews(true), { horizonDays: 7, shocks: [{ type: 'outage', assetId: 'v2', fromDay: 2, toDay: 5 }] });
    const r = run(s);
    const log = (d: number, c: string) => r.crewLogs![d].find((l) => l.crewId === c)!;
    expect(log(0, 'c1').memberIds).toEqual(['e1', 'e2', 'e5']);
    expect(log(0, 'c2').memberIds).toEqual(['e3', 'e4']);
    expect(log(2, 'c1').memberIds).toEqual(['e1', 'e2', 'e3']);
    expect(log(2, 'c2').deployed).toBe(false);
    expect(log(2, 'c2').memberIds).toEqual(['e4']);
    // Paid hours unchanged: everyone present is paid 8 h either way (minPaid = shift, no overtime).
    expect(r.days[2].ops.paidHours).toBe(5 * 8);
  });

  it('completed work rises versus floating off when one crew lacks its truck and another is short a member', () => {
    const shocks: Scenario['shocks'] = [
      { type: 'outage', assetId: 'v2', fromDay: 0, toDay: 14 },
      { type: 'absence', employeeIds: ['e2'], fromDay: 0, toDay: 14 },
    ];
    const off = run(scenario(twoCrews(false), { horizonDays: 14, shocks }));
    const on = run(scenario(twoCrews(true), { horizonDays: 14, shocks }));
    expect(on.totals.ops.completedLaborHours).toBeGreaterThan(off.totals.ops.completedLaborHours);
    expect(on.totals.ops.jobsCompleted).toBeGreaterThan(off.totals.ops.jobsCompleted);
    // Same people paid the same hours: the gain is pure utilisation.
    expect(on.totals.ops.paidHours).toBe(off.totals.ops.paidHours);
  });

  it('no employee is on two crews on one day; identities hold (stochastic, several seeds)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const base = stochasticMid(seed);
      const co = base.company;
      const s: Scenario = {
        ...base,
        company: { ...co, policies: { ...co.policies, floatIdleWorkers: true }, workforce: { ...co.workforce, absenceRate: 0.15 } },
        shocks: [{ type: 'outage', assetId: co.vehicles[0].id, fromDay: 30, toDay: 60 }],
      };
      const r = run(s); // assertInvariants checks memberIds are unique across crews every day
      for (const day of r.crewLogs!) {
        const ids = day.flatMap((l) => l.memberIds);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('off by default: floatIdleWorkers missing equals false', () => {
    const a = runSimulation(scenario(twoCrews(false), { horizonDays: 10 }));
    const co = twoCrews(false);
    const { floatIdleWorkers: _omit, ...policies } = co.policies;
    const b = runSimulation(scenario({ ...co, policies }, { horizonDays: 10 }));
    expect(b).toEqual(a);
  });
});
