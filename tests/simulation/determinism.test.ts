import { describe, expect, it } from 'vitest';
import { STREAM, hashString, rand01, runSimulation, type Scenario, type SimulationResult } from '../../src/simulation';
import { allActions, stochasticMid, truckSpec, mowerSpec } from './scenarios';

function absencePattern(r: SimulationResult, employeeIds: Set<string>): string[] {
  const out: string[] = [];
  r.crewLogs!.forEach((logs, day) => {
    for (const l of logs) for (const id of l.absentIds) if (employeeIds.has(id)) out.push(`${day}:${id}`);
  });
  return out.sort();
}

function quitPattern(r: SimulationResult, ids: Set<string>): string[] {
  return r.events.filter((e) => e.type === 'employee-quit' && ids.has(e.employeeId)).map((e) => `${e.day}:${(e as { employeeId: string }).employeeId}`);
}

function breakdowns(r: SimulationResult, ids: Set<string>): string[] {
  return r.events
    .filter((e) => (e.type === 'vehicle-breakdown' && ids.has(e.vehicleId)) || (e.type === 'equipment-breakdown' && ids.has(e.equipmentId)))
    .map((e) => JSON.stringify(e));
}

describe('determinism', () => {
  it('same scenario twice gives deeply equal results (full and summary)', () => {
    const s = allActions();
    expect(runSimulation(s)).toEqual(runSimulation(s));
    expect(runSimulation(s, { detail: 'summary' })).toEqual(runSimulation(s, { detail: 'summary' }));
  });

  it('summary mode produces the same numbers as full mode', () => {
    const s = stochasticMid(9);
    const a = runSimulation(s);
    const b = runSimulation(s, { detail: 'summary' });
    expect(b.days).toEqual(a.days);
    expect(b.totals).toEqual(a.totals);
    expect(b.events).toEqual(a.events);
  });

  it('does not mutate the input scenario', () => {
    const s = allActions();
    const copy = structuredClone(s);
    const r = runSimulation(s);
    expect(s).toEqual(copy);
    // the result does not alias the input
    const applied = r.events.find((e) => e.type === 'action-applied');
    expect(applied).toBeDefined();
    (applied as { action: { type: string } }).action.type = 'mutated';
    expect(s).toEqual(copy);
  });

  it('different seeds give different results', () => {
    const a = runSimulation(stochasticMid(1), { detail: 'summary' });
    const b = runSimulation(stochasticMid(2), { detail: 'summary' });
    expect(a.days.map((d) => d.weather)).not.toEqual(b.days.map((d) => d.weather));
    expect(a.totals.income.revenue).not.toBe(b.totals.income.revenue);
  });

  it('rand01 is a pure function of its arguments, in [0,1), roughly uniform', () => {
    expect(rand01(1, 2, 3, 4, 5)).toBe(rand01(1, 2, 3, 4, 5));
    expect(rand01(1, 2, 3, 4, 5)).not.toBe(rand01(1, 2, 3, 4, 6));
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = rand01(7, STREAM.WEATHER, 0, i, 0);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
      sq += u * u;
    }
    expect(sum / n).toBeCloseTo(0.5, 1.5);
    expect(sq / n - (sum / n) ** 2).toBeCloseTo(1 / 12, 2);
  });

  it('hashString is FNV-1a 32-bit', () => {
    // Known FNV-1a test vectors.
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
});

describe('common random numbers', () => {
  const base = stochasticMid(17);
  const baseRes = runSimulation(base);
  const empIds = new Set(base.company.employees.map((e) => e.id));
  const assetIds = new Set([...base.company.vehicles.map((v) => v.id), ...base.company.equipment.map((e) => e.id)]);

  function expectSameDraws(variant: Scenario) {
    const r = runSimulation(variant);
    expect(r.days.map((d) => d.weather)).toEqual(baseRes.days.map((d) => d.weather));
    expect(absencePattern(r, empIds)).toEqual(absencePattern(baseRes, empIds));
    expect(quitPattern(r, empIds)).toEqual(quitPattern(baseRes, empIds));
    expect(breakdowns(r, assetIds)).toEqual(breakdowns(baseRes, assetIds));
    return r;
  }

  it('sanity: the base run has absences, quits and breakdowns to compare', () => {
    expect(absencePattern(baseRes, empIds).length).toBeGreaterThan(5);
    expect(quitPattern(baseRes, empIds).length).toBeGreaterThan(0);
    expect(breakdowns(baseRes, assetIds).length).toBeGreaterThan(0);
  });

  it('changing price keeps weather, absences, quits and breakdowns', () => {
    const v = structuredClone(base);
    v.company.pricing.globalMultiplier = 1.4;
    const r = expectSameDraws(v);
    expect(r.totals.income.revenue).not.toBe(baseRes.totals.income.revenue);
  });

  it('changing policies keeps weather, absences, quits and breakdowns', () => {
    const v = structuredClone(base);
    v.company.policies = { ...v.company.policies, routing: 'fifo', shiftHours: 7, maxOvertimeHoursPerDay: 0 };
    const r = expectSameDraws(v);
    expect(r.totals.ops.travelHours).not.toBe(baseRes.totals.ops.travelHours);
  });

  it('a set-price action mid-run keeps the draws too', () => {
    const v = structuredClone(base);
    v.actions = [{ day: 30, action: { type: 'set-price', jobTypeId: 'mow', multiplier: 1.3 } }];
    expectSameDraws(v);
  });

  it('adding a crew keeps weather, absences, quits and breakdowns of pre-existing entities', () => {
    const v = structuredClone(base);
    v.actions = [
      {
        day: 0,
        action: {
          type: 'add-crew',
          name: 'New',
          hires: [
            { hourlyWage: 20, skill: 3, productivity: 1 },
            { hourlyWage: 18, skill: 1, productivity: 1 },
          ],
          vehicle: { spec: truckSpec, method: 'cash' },
          equipment: [
            { spec: mowerSpec, method: 'cash' },
            { spec: { ...mowerSpec, equipmentTypeId: 'trimmer' }, method: 'cash' },
          ],
        },
      },
    ];
    const r = expectSameDraws(v);
    expect(r.crewStats['crew-d0-0'].daysDeployed).toBeGreaterThan(0);
  });
});
