import { describe, expect, it } from 'vitest';
import { STREAM, hashString, rand01, runSimulation, validateScenario, type CompanyConfig, type Scenario } from '../../src/simulation';
import { customer, deterministicCompany, employee, equipment, jobType, months, scenario, spiralCustomers, stochasticCompany, vehicle } from './helpers';
import { assertInvariants } from './invariants';

function run(s: Scenario) {
  const r = runSimulation(s);
  assertInvariants(s, r);
  return r;
}

/** Deterministic company with n weekly customers spread on a spiral (phases staggered). */
function busyCompany(n: number, over: Partial<CompanyConfig> = {}): CompanyConfig {
  return deterministicCompany({ customers: spiralCustomers(n, () => 'mow', 8).map((c) => ({ ...c, sizeFactor: 1 })), ...over });
}

describe('empty companies', () => {
  it('no customers: valid with a warning, no revenue, wages still paid', () => {
    const s = scenario(deterministicCompany({ customers: [] }), { horizonDays: 14 });
    expect(validateScenario(s).filter((i) => i.severity === 'error')).toEqual([]);
    const r = run(s);
    expect(r.warnings.some((w) => w.includes('no customers'))).toBe(true);
    expect(r.totals.income.revenue).toBe(0);
    expect(r.totals.ops.jobsCreated).toBe(0);
    expect(r.crewLogs![0][0].notDeployedReason).toBe('no-work');
  });

  it('no employees: crews are understaffed, demand goes unserved as crew-size', () => {
    const s = scenario(busyCompany(10, { employees: [] }), { horizonDays: 14 });
    const r = run(s);
    expect(r.warnings.some((w) => w.includes('no employees'))).toBe(true);
    expect(r.totals.income.directLabor).toBe(0);
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.totals.ops.crewDaysNotDeployed).toBe(10);
    expect(r.totals.ops.unservedHoursByReason['crew-size']).toBeGreaterThan(0);
    expect(r.crewLogs![0][0].notDeployedReason).toBe('understaffed');
  });

  it('no crews: unserved as no-crew; crewless employees are paid the minimum shift', () => {
    const co = busyCompany(10, { crews: [], employees: [employee('e1', null)] });
    co.policies.minPaidHoursPerShift = 3;
    const r = run(scenario(co, { horizonDays: 7 }));
    const u = r.totals.ops.unservedHoursByReason;
    expect(u['no-crew']).toBeGreaterThan(0);
    expect(u.capacity + u.vehicle + u.equipment + u.skill + u['crew-size'] + u.weather).toBe(0);
    expect(r.totals.ops.paidHours).toBe(15);
    expect(r.totals.ops.idleHours).toBe(15);
  });

  it('crew without vehicle (and no spare): not deployed for vehicle, members paid minimum', () => {
    const co = busyCompany(10, { crews: [{ id: 'c1', name: 'c1', vehicleId: null }], vehicles: [] });
    co.policies.minPaidHoursPerShift = 2;
    const r = run(scenario(co, { horizonDays: 7 }));
    expect(r.warnings.some((w) => w.includes('no vehicle'))).toBe(true);
    expect(r.crewLogs![0][0].notDeployedReason).toBe('vehicle');
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.totals.ops.unservedHoursByReason.vehicle).toBeGreaterThan(0);
    expect(r.totals.ops.paidHours).toBe(2 * 2 * 5);
  });

  it('crew without vehicle borrows an unassigned spare', () => {
    const co = busyCompany(10, { crews: [{ id: 'c1', name: 'c1', vehicleId: null }], vehicles: [vehicle('spare')] });
    const r = run(scenario(co, { horizonDays: 7 }));
    expect(r.crewLogs![0][0].vehicleId).toBe('spare');
    expect(r.totals.ops.jobsCompleted).toBeGreaterThan(0);
  });
});

describe('equipment nobody has', () => {
  const make = (withSkid: boolean, seed: number): Scenario => {
    const co = busyCompany(80, {
      jobTypes: [jobType({ requiredEquipmentTypes: withSkid ? [] : ['skid'], cancelAfterDays: 5 })],
      equipment: [],
    });
    co.market.baseMonthlyChurn = 0.02;
    co.market.serviceFailureChurnWeight = 3;
    co.market.serviceFailureHalfLifeDays = 60;
    co.employees = [employee('e1', 'c1'), employee('e2', 'c1'), employee('e3', 'c1')];
    return scenario(co, { horizonDays: 180, seed });
  };

  it('all unserved hours land in equipment, jobs are cancelled, warning raised', () => {
    const s = make(false, 1);
    const r = run(s);
    const u = r.totals.ops.unservedHoursByReason;
    expect(r.warnings.some((w) => w.includes('no crew can perform job type mow'))).toBe(true);
    expect(u.equipment).toBeGreaterThan(0);
    expect(u.capacity + u.vehicle + u.skill + u['crew-size'] + u.weather + u['no-crew']).toBe(0);
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.totals.ops.jobsCancelled).toBeGreaterThan(0);
    expect(r.totals.ops.lostRevenue).toBeGreaterThan(0);
  });

  it('service failures raise churn (same random numbers, failure score is the only difference)', () => {
    let churnMissing = 0;
    let churnOk = 0;
    for (const seed of [1, 2, 3]) {
      churnMissing += runSimulation(make(false, seed), { detail: 'summary' }).totals.ops.churnedCustomers;
      churnOk += runSimulation(make(true, seed), { detail: 'summary' }).totals.ops.churnedCustomers;
    }
    expect(churnMissing).toBeGreaterThan(churnOk * 1.5);
  });
});

describe('excess demand and losses', () => {
  it('excess demand: backlog grows, cancellations, capacity attribution', () => {
    const co = busyCompany(120, { jobTypes: [jobType({ standardLaborHours: 1.5, cancelAfterDays: 14 })] });
    const r = run(scenario(co, { horizonDays: 42 }));
    const u = r.totals.ops.unservedHoursByReason;
    expect(u.capacity).toBeGreaterThan(0);
    expect(u.equipment + u.skill + u['crew-size'] + u.vehicle).toBe(0);
    expect(r.days[13].backlogJobs).toBeGreaterThan(r.days[4].backlogJobs);
    expect(r.totals.ops.jobsCancelled).toBeGreaterThan(0);
    expect(r.totals.missedJobRate).toBeGreaterThan(0);
  });

  it('unprofitable pricing: negative net profit, still consistent', () => {
    const co = busyCompany(30, { pricing: { globalMultiplier: 0.1, byJobType: {} } });
    const r = run(scenario(co, { horizonDays: 60 }));
    expect(r.totals.income.netProfit).toBeLessThan(0);
    expect(r.totals.netMargin).toBeLessThan(0);
  });

  it('negative cash beyond the line of credit: shortfall flagged, run continues', () => {
    const co = busyCompany(5, { pricing: { globalMultiplier: 0.1, byJobType: {} } });
    co.finance.startingCash = 500;
    co.finance.lineOfCredit = { limit: 1000, annualRate: 0.1 };
    co.workforce.payPeriodDays = 7;
    co.costs.overhead = [{ id: 'rent', name: 'Rent', monthlyAmount: 3000 }];
    const r = run(scenario(co, { horizonDays: 60 }));
    expect(r.days.length).toBe(60);
    expect(r.totals.shortfallDays).toBeGreaterThan(0);
    const first = r.days.find((d) => d.cashShortfall)!;
    expect(first.balance.locBalance).toBeCloseTo(1000, 9);
    const ev = r.events.find((e) => e.type === 'cash-shortfall' && e.day === first.day);
    expect(ev && ev.type === 'cash-shortfall' && ev.amount).toBeCloseTo(-first.balance.cash, 9);
    expect(r.days[59].balance.cash).toBeLessThan(0);
    expect(r.totals.income.interest).toBeGreaterThan(0);
    expect(r.days[59].balance.availableCash).toBeLessThan(0);
  });
});

describe('breakdowns', () => {
  it('dailyProb = 1: every vehicle is down every workday, the crew never deploys', () => {
    const co = busyCompany(10);
    co.reliability.vehicle = { dailyProb: 1, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 1, repairCostMin: 100, repairCostMax: 100 };
    const r = run(scenario(co, { horizonDays: 14 }));
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.totals.ops.crewDaysNotDeployed).toBe(10);
    expect(r.totals.ops.unservedHoursByReason.vehicle).toBeGreaterThan(0);
    expect(r.totals.income.maintenance).toBeCloseTo(1000, 9); // 10 workdays × $100
    expect(r.events.filter((e) => e.type === 'vehicle-breakdown').length).toBe(10);
  });

  it('when the crew vehicle breaks but a spare does not, the crew deploys with the spare', () => {
    // dailyProb 1 breaks every vehicle (spares too), so instead find, from the RNG itself,
    // a day where v1 breaks and the spare does not at dailyProb 0.5.
    const p = 0.5;
    const k1 = hashString('v1');
    const ks = hashString('spare');
    let day = -1;
    for (let d = 0; d < 5; d++) {
      if (rand01(1, STREAM.VEHICLE_BREAKDOWN, k1, d, 0) < p && !(rand01(1, STREAM.VEHICLE_BREAKDOWN, ks, d, 0) < p)) {
        day = d;
        break;
      }
    }
    expect(day).toBeGreaterThanOrEqual(0);
    const co = busyCompany(10);
    co.reliability.vehicle = { dailyProb: p, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 1, repairCostMin: 0, repairCostMax: 0 };
    const noSpare = run(scenario(structuredClone(co), { horizonDays: 5 }));
    co.vehicles.push(vehicle('spare'));
    const withSpare = run(scenario(co, { horizonDays: 5 }));
    expect(noSpare.crewLogs![day][0].notDeployedReason).toBe('vehicle');
    expect(withSpare.crewLogs![day][0].deployed).toBe(true);
    expect(withSpare.crewLogs![day][0].vehicleId).toBe('spare');
  });
});

describe('workforce and weather extremes', () => {
  it('absence rate 1: nobody works, nobody is paid', () => {
    const co = busyCompany(10);
    co.workforce.absenceRate = 1;
    co.policies.minPaidHoursPerShift = 4;
    const r = run(scenario(co, { horizonDays: 14 }));
    expect(r.totals.ops.paidHours).toBe(0);
    expect(r.totals.income.directLabor).toBe(0);
    expect(r.totals.ops.absentShifts).toBe(20);
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.crewLogs![0][0].absentIds).toEqual(['e1', 'e2']);
  });

  it('rainout probability 1: no weather-sensitive work, members paid rainout hours', () => {
    const co = busyCompany(10, { jobTypes: [jobType({ weatherSensitive: true })] });
    co.weather.rainoutProbByMonth = months(1);
    co.policies.minPaidHoursPerShift = 4;
    co.policies.rainoutPaidHours = 1.5;
    const r = run(scenario(co, { horizonDays: 14 }));
    expect(r.days.every((d) => d.weather === 'rainout')).toBe(true);
    expect(r.totals.ops.jobsCompleted).toBe(0);
    expect(r.totals.ops.paidHours).toBeCloseTo(10 * 2 * 1.5, 9);
    const u = r.totals.ops.unservedHoursByReason;
    expect(u.weather).toBeGreaterThan(0);
    expect(u.capacity).toBe(0);
    expect(r.crewLogs![0][0].notDeployedReason).toBe('weather');
  });

  it('partial days: weather-sensitive jobs only started before the cutoff', () => {
    const co = busyCompany(60, { jobTypes: [jobType({ weatherSensitive: true })] });
    co.weather.partialProbByMonth = months(1);
    co.weather.partialDayFraction = 0.5; // start cutoff at 4 h
    const r = run(scenario(co, { horizonDays: 14 }));
    for (const logs of r.crewLogs!) for (const l of logs) for (const st of l.stops) expect(st.arrive).toBeLessThanOrEqual(4 + 1e-9);
    expect(r.totals.ops.unservedHoursByReason.weather).toBeGreaterThan(0);
  });

  it('high churn: demand declines', () => {
    const co = busyCompany(100);
    co.market.baseMonthlyChurn = 0.4;
    const r = run(scenario(co, { horizonDays: 90 }));
    expect(r.days[89].activeCustomers).toBeLessThan(40);
    expect(r.months[2].ops.jobsCreated).toBeLessThan(r.months[0].ops.jobsCreated);
    expect(r.customers!.filter((c) => c.churnedDay !== null).length).toBe(r.totals.ops.churnedCustomers);
  });
});

describe('horizons', () => {
  it('horizon of one day', () => {
    const co = busyCompany(20);
    const r = run(scenario(co, { horizonDays: 1 }));
    expect(r.days.length).toBe(1);
    expect(r.months.length).toBe(1);
    expect(r.totals.startDay).toBe(0);
    expect(r.totals.endDay).toBe(0);
    // overtime is settled on the final day even though it is a Monday
    expect(r.days[0].ops.overtimeHours).toBe(0);
  });

  it('horizon ending mid-week settles partial-week overtime on the final day', () => {
    // one employee, 4 one-hour jobs at (0,0) per weekday, shift 8 + 4 overtime ⇒ paid 12 h/day max.
    const customers = Array.from({ length: 30 }, (_, i) => customer(`k${i}`, 0, 0, 'mow', { phase: 6 / 7 }));
    const co = deterministicCompany({
      customers,
      employees: [employee('e1', 'c1')],
      jobTypes: [jobType({ intervalDays: 1 })],
    });
    co.policies.maxOvertimeHoursPerDay = 4;
    co.policies.workDaysPerWeek = 7;
    const r = run(scenario(co, { horizonDays: 10 })); // ends Wednesday (day 9)
    // 12 paid h/day: week 1 = 84 ⇒ OT 44 on day 6; days 7–9 = 36 ⇒ 0 OT on day 9
    expect(r.days[6].ops.overtimeHours).toBeCloseTo(44, 9);
    expect(r.days[9].ops.overtimeHours).toBe(0);
    const r2 = run(scenario(co, { horizonDays: 11 })); // days 7–10 = 48 ⇒ OT 8 settled on day 10
    expect(r2.days[10].ops.overtimeHours).toBeCloseTo(8, 9);
    expect(r2.days[10].income.directLabor).toBeCloseTo(12 * 20 + 0.5 * 20 * 8, 9);
  });
});

describe('validation', () => {
  it('reports errors and makes runSimulation throw', () => {
    const co = deterministicCompany({ customers: [customer('a', 1, 1, 'ghost'), customer('a', 2, 2, 'mow')] });
    co.employees.push(employee('e9', 'nocrew'));
    co.weather.rainoutProbByMonth = [0.1];
    co.workforce.absenceRate = -0.1;
    co.jobTypes.push(jobType({ id: 'bad', intervalDays: 0 }));
    const s = scenario(co, { horizonDays: 0 });
    const errs = validateScenario(s).filter((i) => i.severity === 'error').map((i) => i.path);
    expect(errs).toEqual(
      expect.arrayContaining([
        'horizonDays',
        'company.customers',
        'company.customers[0].recurringJobTypeId',
        'company.employees[2].crewId',
        'company.weather.rainoutProbByMonth',
        'company.workforce.absenceRate',
        'company.jobTypes[1].intervalDays',
      ]),
    );
    expect(() => runSimulation(s)).toThrow(/Invalid scenario/);
  });

  it('dangling crew vehicle and equipment crew are errors', () => {
    const co = deterministicCompany({ crews: [{ id: 'c1', name: 'c', vehicleId: 'vx' }], equipment: [equipment('m', 'mower', 'cx')] });
    const paths = validateScenario(scenario(co)).map((i) => i.path);
    expect(paths).toContain('company.crews[0].vehicleId');
    expect(paths).toContain('company.equipment[0].crewId');
  });

  it('a stochastic company is valid apart from warnings', () => {
    expect(validateScenario(scenario(stochasticCompany())).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
