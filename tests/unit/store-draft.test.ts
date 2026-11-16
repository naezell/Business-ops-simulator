/**
 * Plan timeline (S8): dated draft decisions in the store, the v1 -> v2 persistence migration,
 * and date-aware roster projection. Expected values are written by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migratePersisted, STORAGE_VERSION } from '../../src/services/persistence';
import { activeOnDay, crewsOnDay, employeesOnDay, projectCompany } from '../../src/services/derive';
import { clampDay, laneOf, monthTicks } from '../../src/services/planTimeline';
import { useStore } from '../../src/services/store';
import { landscaping } from '../../src/business/landscaping';
import type { Action, PlannedAction } from '../../src/simulation';

const hire = (crewId: string): Action => ({ type: 'hire-employee', crewId, hire: { name: 'Laborer', hourlyWage: 18, skill: 1, productivity: 1 } });

describe('persistence migration', () => {
  const v1 = {
    version: 1,
    industryId: 'landscaping',
    seed: 7,
    horizonMonths: 6,
    baselineActions: [{ day: 3, action: { type: 'set-marketing-spend', monthlySpend: 900 } }],
    draftActions: [
      { day: 30, action: { type: 'set-policy', patch: { routing: 'zoned' } } },
      { day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.05 } },
    ],
    patch: { 'policies.shiftHours': 9 },
    selectedDay: 12,
    view: 'business',
  };

  it('moves v1 draftActions into draft.actions with empty rules and loses nothing', () => {
    const m = migratePersisted(structuredClone(v1))!;
    expect(m.version).toBe(STORAGE_VERSION);
    expect(m.draft.actions).toEqual(v1.draftActions);
    expect(m.draft.rules).toEqual([]);
    expect(m.baselineActions).toEqual(v1.baselineActions);
    expect(m.patch).toEqual(v1.patch);
    expect(m.seed).toBe(7);
    expect(m.horizonMonths).toBe(6);
    expect(m.selectedDay).toBe(12);
    expect(m.view).toBe('business');
  });

  it('round-trips a v2 state including rules', () => {
    const rule = { id: 'r1', name: 'Fix breakdowns', when: [], then: [], cooldownDays: 7, maxFirings: 3 };
    const v2 = { ...v1, version: 2, draft: { actions: v1.draftActions, rules: [rule] } } as Record<string, unknown>;
    delete v2.draftActions;
    const m = migratePersisted(JSON.parse(JSON.stringify(v2)))!;
    expect(m.draft.rules).toEqual([rule]);
    expect(migratePersisted(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('rejects corrupt, unknown-version and malformed data', () => {
    expect(migratePersisted(null)).toBeNull();
    expect(migratePersisted('x')).toBeNull();
    expect(migratePersisted({ ...v1, version: 99 })).toBeNull();
    expect(migratePersisted({ ...v1, draftActions: [{ day: -1, action: { type: 'set-policy', patch: {} } }] })).toBeNull();
    expect(migratePersisted({ ...v1, draftActions: undefined })).toBeNull();
    expect(migratePersisted({ ...v1, version: 2, draft: { actions: [], rules: 'nope' } })).toBeNull();
    expect(migratePersisted({ ...v1, version: 2, draft: { actions: [] } })).toBeNull();
  });
});

describe('plan timeline helpers', () => {
  it('derives lanes from action types', () => {
    expect(laneOf(hire('c'))).toBe('people');
    expect(laneOf({ type: 'remove-crew', crewId: 'c' })).toBe('fleet');
    expect(laneOf({ type: 'set-marketing-spend', monthlySpend: 1 })).toBe('pricing');
    expect(laneOf({ type: 'set-policy', patch: {} })).toBe('policies');
  });
  it('clamps days into the horizon', () => {
    expect(clampDay(-5, 90)).toBe(0);
    expect(clampDay(500, 90)).toBe(89);
    expect(clampDay(12.4, 90)).toBe(12);
  });
  it('ticks the first of each month (March start: Mar 31 days, Apr 30)', () => {
    expect(monthTicks(2, 61)).toEqual([
      { day: 0, label: 'Mar' },
      { day: 31, label: 'Apr' },
    ]);
  });
});

describe('date-aware roster projection', () => {
  const company = landscaping.createSampleCompany();
  const crewId = company.crews[0].id;
  const adopted: PlannedAction[] = [];
  it('a hire dated day 30 is on the roster from day 30, not before', () => {
    const p = projectCompany(company, adopted, [{ day: 30, action: hire(crewId) }]);
    const added = p.employees.find((e) => e.origin === 'draft')!;
    expect(added.fromDay).toBe(30);
    expect(employeesOnDay(p, 29)).toHaveLength(company.employees.length);
    expect(employeesOnDay(p, 30)).toHaveLength(company.employees.length + 1);
    expect(employeesOnDay(p, 200).some((e) => e.id === added.id)).toBe(true);
  });
  it('a removal dated day 10 takes the person off the roster from day 10', () => {
    const who = company.employees[0].id;
    const p = projectCompany(company, adopted, [{ day: 10, action: { type: 'remove-employee', employeeId: who } }]);
    const e = p.employees.find((x) => x.id === who)!;
    expect(e.removedDay).toBe(10);
    expect(activeOnDay(e, 9)).toBe(true);
    expect(activeOnDay(e, 10)).toBe(false);
    expect(crewsOnDay(p, 0)).toHaveLength(company.crews.length);
  });
});

describe('store draft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    useStore.getState().resetEverything();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('holds { actions, rules } and mirrors actions as draftActions', () => {
    const s = useStore.getState();
    expect(s.draft).toEqual({ actions: [], rules: [] });
    const crewId = s.company.crews[0].id;
    useStore.getState().setDraftAction(hire(crewId), 30);
    const d = useStore.getState();
    expect(d.draft.actions).toHaveLength(1);
    expect(d.draft.actions[0].day).toBe(30);
    expect(d.draftActions).toBe(d.draft.actions);
  });

  it('moves, clamps and keeps the day when a keyed chip is replaced', () => {
    const st = useStore.getState();
    st.setDraftAction({ type: 'set-marketing-spend', monthlySpend: 1500 }, 20);
    useStore.getState().setDraftAction({ type: 'set-marketing-spend', monthlySpend: 1800 });
    expect(useStore.getState().draft.actions).toEqual([{ day: 20, action: { type: 'set-marketing-spend', monthlySpend: 1800 } }]);
    useStore.getState().moveDraftAction(0, 45);
    expect(useStore.getState().draft.actions[0].day).toBe(45);
    useStore.getState().moveDraftAction(0, 99999);
    expect(useStore.getState().draft.actions[0].day).toBe(useStore.getState().horizonDays - 1);
  });

  it('adopting keeps the dates and empties the draft actions', () => {
    useStore.getState().setDraftAction({ type: 'set-marketing-spend', monthlySpend: 1500 }, 33);
    useStore.getState().adoptDraft();
    const s = useStore.getState();
    expect(s.baselineActions).toEqual([{ day: 33, action: { type: 'set-marketing-spend', monthlySpend: 1500 } }]);
    expect(s.draft.actions).toEqual([]);
  });

  it('keeps rules in state, passes them through draft edits', () => {
    const rule = { id: 'r1', name: 'x', when: [], then: [], cooldownDays: 1, maxFirings: 1 };
    useStore.getState().setDraftRules([rule]);
    useStore.getState().setDraftAction({ type: 'set-policy', patch: { routing: 'zoned' } }, 5);
    expect(useStore.getState().draft.rules).toEqual([rule]);
  });

  it('applyPlannedActions (optimizer) keeps its days', () => {
    useStore.getState().applyPlannedActions([{ day: 14, action: { type: 'set-marketing-spend', monthlySpend: 1200 } }]);
    expect(useStore.getState().draft.actions[0].day).toBe(14);
  });
});
