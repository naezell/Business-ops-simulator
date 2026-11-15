/**
 * Integration: the UI's roster projection (src/services/derive.ts) is a thin layer over the engine's
 * applyActionsAtDayZero. Expected values come from the hand-built company below.
 */
import { describe, expect, it } from 'vitest';
import type { PlannedAction } from '../../src/simulation';
import { projectCompany } from '../../src/services/derive';
import { deterministicCompany, employee, vehicle } from '../simulation/helpers';

function company() {
  return deterministicCompany({
    crews: [
      { id: 'c1', name: 'Crew 1', vehicleId: 'v1' },
      { id: 'c2', name: 'Crew 2', vehicleId: 'v2' },
    ],
    employees: [employee('e1', 'c1'), employee('e2', 'c1'), employee('e3', 'c2')],
    vehicles: [vehicle('v1'), vehicle('v2')],
  });
}

const hire = (crewId: string, name?: string): PlannedAction => ({
  day: 0,
  action: { type: 'hire-employee', crewId, hire: { hourlyWage: 21, skill: 2, productivity: 1, ...(name ? { name } : {}) } },
});

describe('projectCompany (thin wrapper over applyActionsAtDayZero)', () => {
  it('tags base, adopted and draft hires with engine ids and draft indices', () => {
    const co = company();
    const p = projectCompany(co, [hire('c1', 'Ann')], [{ day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.1 } }, hire('c2')]);
    const byId = Object.fromEntries(p.employees.map((e) => [e.id, e]));
    expect(p.employees.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'h-d0-0-0', 'h-d0-2-0']);
    expect(byId.e1.origin).toBe('base');
    expect(byId['h-d0-0-0']).toMatchObject({ origin: 'adopted', draftIndex: -1, name: 'Ann', crewId: 'c1', tenureDays: 0 });
    // Combined index 2 = draft index 1; an unnamed hire shows as "New hire".
    expect(byId['h-d0-2-0']).toMatchObject({ origin: 'draft', draftIndex: 1, name: 'New hire', crewId: 'c2', removed: false });
    expect(p.pricing.globalMultiplier).toBe(1.1);
  });

  it('keeps removed people and crews listed, marked with the removing action', () => {
    const p = projectCompany(company(), [{ day: 0, action: { type: 'remove-employee', employeeId: 'e1' } }], [
      hire('c2'),
      { day: 0, action: { type: 'remove-crew', crewId: 'c2' } },
    ]);
    const byId = Object.fromEntries(p.employees.map((e) => [e.id, e]));
    expect(byId.e1).toMatchObject({ removed: true, removedOrigin: 'adopted', removedByDraftIndex: -1 });
    expect(byId.e2.removed).toBe(false);
    // remove-crew is draft index 1: its members (base e3 and the draft hire) are removed with it.
    expect(byId.e3).toMatchObject({ removed: true, removedOrigin: 'draft', removedByDraftIndex: 1 });
    expect(byId['h-d0-1-0']).toMatchObject({ origin: 'draft', draftIndex: 0, removed: true, removedByDraftIndex: 1 });
    const c2 = p.crews.find((c) => c.id === 'c2')!;
    expect(c2).toMatchObject({ removed: true, removedOrigin: 'draft', removedByDraftIndex: 1 });
  });

  it('drops actions the engine rejects (hire into an unknown crew)', () => {
    const p = projectCompany(company(), [], [hire('nope')]);
    expect(p.employees.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
