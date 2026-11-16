/**
 * H6 — the shared scenario fixtures are valid, deterministic, simulate 30 days, and
 * allRatesZero() zeroes the stochastic rates without mutating its input.
 */
import { describe, expect, it } from 'vitest';
import { runSimulation, validateScenario } from '../../src/simulation';
import type { Scenario } from '../../src/simulation';
import {
  allRatesZero,
  capacityBound,
  cashPoor,
  demandBound,
  emptyCompany,
  FIXTURE_HORIZON_DAYS,
  missingEquipment,
  soloOperator,
} from '../fixtures/scenarios';

const builders: [string, () => Scenario][] = [
  ['emptyCompany', emptyCompany],
  ['soloOperator', soloOperator],
  ['capacityBound', capacityBound],
  ['demandBound', demandBound],
  ['cashPoor', cashPoor],
  ['missingEquipment', missingEquipment],
];

describe.each(builders)('%s', (_name, build) => {
  it('passes validateScenario with no errors', () => {
    const errors = validateScenario(build()).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('simulates the 30-day horizon without throwing', () => {
    const result = runSimulation(build());
    expect(result.horizonDays).toBe(FIXTURE_HORIZON_DAYS);
    expect(result.days).toHaveLength(FIXTURE_HORIZON_DAYS);
  });

  it('two builds are deeply equal (deterministic literals)', () => {
    expect(build()).toEqual(build());
  });

  it('its allRatesZero variant is valid and simulates 30 days', () => {
    const zeroed = allRatesZero(build());
    expect(validateScenario(zeroed).filter((i) => i.severity === 'error')).toEqual([]);
    expect(runSimulation(zeroed).days).toHaveLength(FIXTURE_HORIZON_DAYS);
  });
});

describe('allRatesZero', () => {
  it('sets every stochastic rate to 0 on a copy and leaves the input unchanged', () => {
    const base = capacityBound();
    const snapshot = JSON.parse(JSON.stringify(base)) as Scenario;
    const zeroed = allRatesZero(base);

    expect(base).toEqual(snapshot);
    expect(zeroed).not.toBe(base);
    expect(zeroed.company).not.toBe(base.company);

    const c = zeroed.company;
    expect(c.workforce.absenceRate).toBe(0);
    expect(c.workforce.annualTurnoverRate).toBe(0);
    expect(c.reliability.vehicle.dailyProb).toBe(0);
    expect(c.reliability.equipment.dailyProb).toBe(0);
    expect(c.weather.rainoutProbByMonth.every((v) => v === 0)).toBe(true);
    expect(c.weather.partialProbByMonth.every((v) => v === 0)).toBe(true);
    expect(c.market.organicLeadsPerMonth).toBe(0);
    expect(c.market.marketingMaxLeadsPerMonth).toBe(0);
    expect(c.market.baseMonthlyChurn).toBe(0);
    expect(c.finance.ar.collectionDaysJitter).toBe(0);
    expect(c.finance.ar.badDebtRate).toBe(0);
  });

  it('zeroes the annual rate of one-off job types and keeps recurring job types as they were', () => {
    const base = emptyCompany();
    base.company.jobTypes = [
      { ...soloOperator().company.jobTypes[0], id: 'cleanup', kind: 'one-off', intervalDays: undefined, annualRatePerCustomer: 1.5 },
    ];
    const zeroed = allRatesZero(base);
    expect(zeroed.company.jobTypes[0].annualRatePerCustomer).toBe(0);

    const recurring = allRatesZero(soloOperator());
    expect(recurring.company.jobTypes[0].intervalDays).toBe(7);
  });
});

describe('builder intent (each fixture does what its name says)', () => {
  it('the empty company creates no work and no crew days', () => {
    const r = runSimulation(emptyCompany());
    expect(r.totals.ops.jobsCreated).toBe(0);
    expect(r.totals.ops.crewDaysDeployed).toBe(0);
  });

  it('the solo operator deploys its crew on workdays and completes jobs', () => {
    const r = runSimulation(soloOperator());
    expect(r.totals.ops.crewDaysDeployed).toBeGreaterThan(0);
    expect(r.totals.ops.jobsCompleted).toBeGreaterThan(0);
  });

  it('the capacity-bound company has more jobs created than completed', () => {
    const r = runSimulation(capacityBound());
    expect(r.totals.ops.jobsCreated).toBeGreaterThan(r.totals.ops.jobsCompleted);
  });

  it('the cash-poor company runs a cash shortfall at some point', () => {
    const r = runSimulation(cashPoor());
    expect(r.days.some((d) => d.cashShortfall)).toBe(true);
  });

  it('the missing-equipment company completes no mowing and blames equipment for the unserved hours', () => {
    const r = runSimulation(missingEquipment());
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.totals.ops.unservedHoursByReason.equipment).toBeGreaterThan(0);
  });
});
