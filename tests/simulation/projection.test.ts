/**
 * Task O3 (frontend requests #1–#3): applyActionsAtDayZero, CrewDayLog hours and the
 * name on employee-hired events.
 */
import { describe, expect, it } from 'vitest';
import { applyActionsAtDayZero, runSimulation } from '../../src/simulation';
import type { CompanyConfig, PlannedAction, SimulationResult } from '../../src/simulation';
import { scenario, stochasticCompany } from './helpers';

const truckSpec = {
  name: 'New truck',
  seats: 3,
  mpg: 16,
  maintenanceCostPerMile: 0.1,
  purchasePrice: 40000,
  usefulLifeYears: 6,
  salvageValue: 8000,
  leaseMonthly: 700,
};
const mowerSpec = {
  name: 'New mower',
  equipmentTypeId: 'mower',
  maintenanceCostPerHour: 1.2,
  purchasePrice: 8000,
  usefulLifeYears: 5,
  salvageValue: 500,
  leaseMonthly: 220,
};
const trimmerSpec = { ...mowerSpec, name: 'New trimmer', equipmentTypeId: 'trimmer', purchasePrice: 600, leaseMonthly: 30 };

function company(): CompanyConfig {
  const c = stochasticCompany(60, 2);
  c.finance = { ...c.finance, startingCash: 200000, lineOfCredit: { limit: 50000, annualRate: 0.1 } };
  return c;
}

/** Day-0 actions of every structural kind, plus one the engine rejects. Indices matter for ids. */
const actions: PlannedAction[] = [
  /* 0 */ { day: 0, action: { type: 'remove-employee', employeeId: 'e0b' } },
  /* 1 */ { day: 0, action: { type: 'hire-employee', crewId: 'c1', hire: { name: 'Pat', hourlyWage: 19, skill: 2, productivity: 1 } } },
  /* 2 */ {
    day: 0,
    action: {
      type: 'add-crew',
      name: 'Crew 3',
      hires: [
        { name: 'Ana', hourlyWage: 24, skill: 3, productivity: 1 },
        { hourlyWage: 18, skill: 1, productivity: 0.95 },
      ],
      vehicle: { spec: truckSpec, method: 'loan' },
      equipment: [
        { spec: mowerSpec, method: 'lease' },
        { spec: trimmerSpec, method: 'cash' },
      ],
    },
  },
  /* 3 */ { day: 0, action: { type: 'hire-employee', crewId: 'nope', hire: { hourlyWage: 18, skill: 1, productivity: 1 } } },
  /* 4 */ { day: 0, action: { type: 'acquire-equipment', spec: mowerSpec, method: 'loan', crewId: null } },
  /* 5 */ { day: 0, action: { type: 'remove-crew', crewId: 'c2' } },
  /* 6 */ { day: 0, action: { type: 'set-policy', patch: { routing: 'nearest', maxOvertimeHoursPerDay: 1 } } },
  /* 7 */ { day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: 0.95 } },
  /* 8 */ { day: 0, action: { type: 'set-marketing-spend', monthlySpend: 900 } },
];

describe('applyActionsAtDayZero', () => {
  const base = company();
  const { company: projected, rejected } = applyActionsAtDayZero(base, actions);

  it('assigns the engine id scheme and applies every structural change', () => {
    // Ids by hand from the action indices: hire #1 → h-d0-1-0; crew #2 → crew-d0-2, its truck a-d0-2-0,
    // its kit a-d0-2-1 / a-d0-2-2, its hires h-d0-2-0 / h-d0-2-1; spare mower #4 → a-d0-4-0.
    const ids = projected.employees.map((e) => e.id);
    expect(ids).not.toContain('e0b');
    expect(ids).not.toContain('e1a'); // crew c2 closed
    expect(ids).toEqual(expect.arrayContaining(['h-d0-1-0', 'h-d0-2-0', 'h-d0-2-1', 'floater']));
    expect(projected.employees.find((e) => e.id === 'h-d0-1-0')).toMatchObject({ name: 'Pat', crewId: 'c1', tenureDays: 0 });
    expect(projected.employees.find((e) => e.id === 'h-d0-2-1')!.name).toBe('h-d0-2-1');
    expect(projected.crews.map((c) => c.id)).toEqual(['c1', 'crew-d0-2']);
    expect(projected.crews[1]).toEqual({ id: 'crew-d0-2', name: 'Crew 3', vehicleId: 'a-d0-2-0' });
    // Loan truck: 20%... down payment fraction from the company; balance = price × (1 − dp), term from newLoan.
    const nl = base.finance.newLoan;
    expect(projected.vehicles.find((v) => v.id === 'a-d0-2-0')!.asset).toEqual({
      purchasePrice: 40000,
      usefulLifeYears: 6,
      salvageValue: 8000,
      ageYears: 0,
      financing: { kind: 'loan', balance: 40000 * (1 - nl.downPaymentFraction), annualRate: nl.annualRate, monthsRemaining: nl.termMonths },
    });
    expect(projected.equipment.find((e) => e.id === 'a-d0-2-1')).toMatchObject({ crewId: 'crew-d0-2', asset: { financing: { kind: 'lease', monthlyPayment: 220 } } });
    expect(projected.equipment.find((e) => e.id === 'a-d0-2-2')).toMatchObject({ crewId: 'crew-d0-2', asset: { financing: { kind: 'owned' } } });
    expect(projected.equipment.find((e) => e.id === 'a-d0-4-0')!.crewId).toBeNull();
    // Closing c2 returns its kit to the yard.
    expect(projected.equipment.filter((e) => e.id === 'm1' || e.id === 't1').map((e) => e.crewId)).toEqual([null, null]);
    expect(projected.policies.routing).toBe('nearest');
    expect(projected.policies.maxOvertimeHoursPerDay).toBe(1);
    expect(projected.pricing.globalMultiplier).toBe(0.95);
    expect(projected.market.marketingMonthlySpend).toBe(900);
    // The input company is untouched.
    expect(base.employees.some((e) => e.id === 'e0b')).toBe(true);
    expect(base.pricing.globalMultiplier).toBe(company().pricing.globalMultiplier);
  });

  it('reports exactly the engine rejection', () => {
    const r = runSimulation({ ...scenario(base, { horizonDays: 1 }), actions });
    const ev = r.events.filter((e) => e.type === 'action-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].index).toBe(3);
    expect(ev).toHaveLength(1);
    expect(ev[0].type === 'action-rejected' && ev[0].reason).toBe(rejected[0].reason);
  });

  it('simulating {company, actions} and {projected, []} gives identical rosters, kits and operations every day', () => {
    const H = 60;
    const a: SimulationResult = runSimulation({ ...scenario(base, { horizonDays: H, seed: 3 }), actions });
    const b: SimulationResult = runSimulation({ ...scenario(projected, { horizonDays: H, seed: 3 }), actions: [] });
    // Same crews deployed with the same members, vehicle, kit and stops on every day.
    expect(b.crewLogs).toEqual(a.crewLogs);
    for (let d = 0; d < H; d++) {
      expect(b.days[d].ops, `ops day ${d}`).toEqual(a.days[d].ops);
      expect(b.days[d].activeCustomers).toBe(a.days[d].activeCustomers);
      expect(b.days[d].activeEmployees).toBe(a.days[d].activeEmployees);
    }
    const ia = a.totals.income;
    const ib = b.totals.income;
    for (const line of ['revenue', 'directLabor', 'payrollBurden', 'materials', 'fuel', 'maintenance', 'equipmentLeases', 'overhead', 'marketing', 'depreciation', 'badDebt'] as const) {
      expect(ib[line], line).toBeCloseTo(ia[line], 6);
    }
    // What legitimately differs: the day-0 hiring costs (3 hires), and the day-0 capex
    // (trimmer for cash + the down payment on truck and spare mower). Financed purchases are
    // non-cash and the first loan payment falls on the next first-of-month either way, so the
    // loan balances agree on every day.
    expect(base.workforce.hiringCostPerHire).toBeGreaterThan(0);
    expect(ia.hiringCosts - ib.hiringCosts).toBeCloseTo(3 * base.workforce.hiringCostPerHire, 6);
    const dp = base.finance.newLoan.downPaymentFraction;
    for (let d = 0; d < H; d++) expect(b.days[d].balance.loanBalance, `loan day ${d}`).toBeCloseTo(a.days[d].balance.loanBalance, 6);
    expect(a.days[0].cashFlow.capex - b.days[0].cashFlow.capex).toBeCloseTo(600 + dp * 40000 + dp * 8000, 6);
    expect(a.days[0].cashFlow.capex).toBeGreaterThan(0);
  });
});

describe('CrewDayLog hours (frontend request #3)', () => {
  const r = runSimulation(scenario(company(), { horizonDays: 45, seed: 9 }));

  it('crew on-site and travel hours times the members deployed add up to the day totals', () => {
    let deployedDays = 0;
    for (let d = 0; d < r.horizonDays; d++) {
      let onSite = 0;
      let travel = 0;
      for (const l of r.crewLogs![d]) {
        onSite += l.memberIds.length * l.onSiteHours;
        travel += l.memberIds.length * l.travelHours;
        if (l.deployed) {
          deployedDays += 1;
          // The crew clock starts at 0 at the depot: on-site + travel (incl. return) = back-at-depot clock.
          expect(l.onSiteHours + l.travelHours).toBeCloseTo(l.endClock, 9);
        } else {
          expect(l.onSiteHours).toBe(0);
          expect(l.travelHours).toBe(0);
        }
      }
      expect(onSite).toBeCloseTo(r.days[d].ops.onSiteHours, 6);
      expect(travel).toBeCloseTo(r.days[d].ops.travelHours, 6);
    }
    expect(deployedDays).toBeGreaterThan(20);
  });
});

describe('employee-hired events carry a name (frontend request #2)', () => {
  it('names action hires and auto-backfill hires', () => {
    const c = company();
    c.workforce = { ...c.workforce, annualTurnoverRate: 0.95, timeToFillDays: 5 };
    c.policies = { ...c.policies, autoBackfill: true };
    const r = runSimulation({ ...scenario(c, { horizonDays: 120, seed: 2 }), actions: [actions[1]] });
    const hired = r.events.filter((e): e is Extract<typeof e, { type: 'employee-hired' }> => e.type === 'employee-hired');
    expect(hired.find((e) => e.employeeId === 'h-d0-0-0')!.name).toBe('Pat');
    const backfills = hired.filter((e) => e.employeeId.includes('~'));
    expect(backfills.length).toBeGreaterThan(0);
    // A backfill is named after the person who quit: "<their name> (backfill)".
    const names = new Map<string, string>(c.employees.map((x) => [x.id, x.name]));
    names.set('h-d0-0-0', 'Pat');
    for (const e of hired) {
      if (!e.employeeId.includes('~')) continue;
      const quitter = e.employeeId.slice(0, e.employeeId.lastIndexOf('~'));
      expect(e.name, e.employeeId).toBe(`${names.get(quitter)} (backfill)`);
      names.set(e.employeeId, e.name!);
    }
  });
});
