/**
 * Conditions (S9): shocks in the store apply to baseline and draft alike, persist (v3, migrated from v2),
 * and show up on the timeline. Expected values are written by hand or from independent sums.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shock, SimulationResult } from '../../src/simulation';
import { isShock, migratePersisted, STORAGE_VERSION } from '../../src/services/persistence';
import { shockBars } from '../../src/services/planTimeline';
import { useStore } from '../../src/services/store';
import { dayFeed } from '../../src/services/playback';
import { PRESETS, describeShock, dayNumbersOf, percentChange, windowFromDayNumbers, windowText, WHOLE_HORIZON_END } from '../../src/components/conditions/shocks';

const fuelOf = (r: SimulationResult) => Object.values(r.jobTypeStats).reduce((a, s) => a + s.fuel, 0);
const fuel30: Shock = { type: 'multiplier', target: 'fuel-price', factor: 1.3, fromDay: 0, toDay: WHOLE_HORIZON_END };

function flush() {
  vi.runAllTimers();
}

describe('persistence v3', () => {
  const v2 = {
    version: 2,
    industryId: 'landscaping',
    seed: 7,
    horizonMonths: 6,
    baselineActions: [],
    draft: { actions: [{ day: 3, action: { type: 'set-marketing-spend', monthlySpend: 900 } }], rules: [] },
    patch: { 'policies.shiftHours': 9 },
    selectedDay: 4,
    view: 'business',
  };
  it('migrates v2 to the current version with no shocks and loses nothing', () => {
    const m = migratePersisted(structuredClone(v2))!;
    expect(STORAGE_VERSION).toBe(4);
    expect(m.version).toBe(4);
    expect(m.shocks).toEqual([]);
    expect(m.draft).toEqual(v2.draft);
    expect(m.patch).toEqual(v2.patch);
    expect(m.view).toBe('business');
  });
  it('migrates v1 through to v3', () => {
    const v1 = { ...v2, version: 1, draftActions: v2.draft.actions } as Record<string, unknown>;
    delete v1.draft;
    const m = migratePersisted(v1)!;
    expect(m.version).toBe(4);
    expect(m.shocks).toEqual([]);
    expect(m.draft.actions).toEqual(v2.draft.actions);
  });
  it('round-trips v3 shocks of every type', () => {
    const shocks: Shock[] = [
      fuel30,
      { type: 'outage', assetId: 'veh-1', fromDay: 10, toDay: 17 },
      { type: 'absence', employeeIds: ['e1', 'e2'], fromDay: 0, toDay: 5 },
      { type: 'weather', state: 'rainout', fromDay: 2, toDay: 16 },
    ];
    const m = migratePersisted(JSON.parse(JSON.stringify({ ...v2, version: 3, shocks })))!;
    expect(m.shocks).toEqual(shocks);
    expect(migratePersisted(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
  it('rejects malformed shocks in v3', () => {
    const bad = (s: unknown) => migratePersisted({ ...v2, version: 3, shocks: [s] });
    expect(migratePersisted({ ...v2, version: 3 })).toBeNull();
    expect(bad({ type: 'multiplier', target: 'demand', factor: -1, fromDay: 0, toDay: 5 })).toBeNull();
    expect(bad({ type: 'multiplier', target: 'demand', factor: 1, fromDay: 5, toDay: 5 })).toBeNull();
    expect(bad({ type: 'weather', state: 'hail', fromDay: 0, toDay: 5 })).toBeNull();
    expect(bad({ type: 'outage', fromDay: 0, toDay: 5 })).toBeNull();
    expect(bad({ type: 'nope', fromDay: 0, toDay: 5 })).toBeNull();
    expect(isShock(fuel30)).toBe(true);
  });
});

describe('store shocks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    useStore.getState().resetEverything();
    flush();
    vi.useRealTimers();
  });

  it('starts empty and add/update/remove edit the list', () => {
    expect(useStore.getState().shocks).toEqual([]);
    useStore.getState().addShock(fuel30);
    useStore.getState().addShock({ type: 'weather', state: 'rainout', fromDay: 0, toDay: 14 });
    expect(useStore.getState().shocks).toHaveLength(2);
    useStore.getState().updateShock(0, { ...fuel30, factor: 1.5 });
    expect((useStore.getState().shocks[0] as { factor: number }).factor).toBe(1.5);
    useStore.getState().removeShock(1);
    expect(useStore.getState().shocks).toEqual([{ ...fuel30, factor: 1.5 }]);
    useStore.getState().updateShock(9, fuel30);
    expect(useStore.getState().shocks).toHaveLength(1);
  });

  it('fuel price +30% for the whole horizon raises fuel by exactly 30% in baseline and draft; removing it restores the numbers', () => {
    const st = useStore.getState();
    // A pending decision so the draft is simulated separately from the baseline.
    st.setDraftAction({ type: 'set-marketing-spend', monthlySpend: 1500 }, 10);
    flush();
    const b0 = fuelOf(useStore.getState().baselineResult);
    const d0 = fuelOf(useStore.getState().draftResult);
    expect(b0).toBeGreaterThan(0);
    expect(d0).toBeGreaterThan(0);
    expect(useStore.getState().draftResult).not.toBe(useStore.getState().baselineResult);

    useStore.getState().addShock(fuel30);
    flush();
    const s1 = useStore.getState();
    expect(s1.baselineIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(fuelOf(s1.baselineResult)).toBeCloseTo(b0 * 1.3, 6);
    expect(fuelOf(s1.draftResult)).toBeCloseTo(d0 * 1.3, 6);

    useStore.getState().removeShock(0);
    flush();
    const s2 = useStore.getState();
    expect(fuelOf(s2.baselineResult)).toBe(b0);
    expect(fuelOf(s2.draftResult)).toBe(d0);
  });

  it('income-statement fuel also rises by exactly 30% (the Financials fuel line)', () => {
    const fuelLine = (r: SimulationResult) => r.totals.income.fuel;
    flush();
    const f0 = fuelLine(useStore.getState().baselineResult);
    useStore.getState().addShock(fuel30);
    flush();
    expect(fuelLine(useStore.getState().baselineResult)).toBeCloseTo(f0 * 1.3, 6);
  });

  it('a shock on the draft-free baseline is shared: draft equals baseline when there are no pending decisions', () => {
    useStore.getState().addShock(fuel30);
    flush();
    const s = useStore.getState();
    expect(s.draftResult).toBe(s.baselineResult);
  });
});

describe('condition helpers', () => {
  it('converts 1-based inclusive day numbers to engine windows and back', () => {
    expect(windowFromDayNumbers(1, 14)).toEqual({ fromDay: 0, toDay: 14 });
    expect(windowFromDayNumbers(31, 37)).toEqual({ fromDay: 30, toDay: 37 });
    expect(dayNumbersOf({ fromDay: 30, toDay: 37 }, 90)).toEqual({ first: 31, last: 37 });
    expect(dayNumbersOf({ fromDay: 0, toDay: WHOLE_HORIZON_END }, 90)).toEqual({ first: 1, last: 90 });
  });
  it('describes shocks in plain language', () => {
    const ctx = { nameOf: (id: string) => ({ v1: 'Truck 1' })[id as 'v1'] ?? id, horizonDays: 90, startMonth: 2 };
    expect(percentChange(1.3)).toBe('+30%');
    expect(percentChange(0.8)).toBe('−20%');
    expect(describeShock(fuel30, ctx)).toBe('Fuel price ×1.3 (+30%), the whole horizon');
    expect(describeShock({ type: 'outage', assetId: 'v1', fromDay: 0, toDay: 7 }, ctx)).toContain('Truck 1 out of service, Day 1');
    expect(windowText({ fromDay: 10, toDay: 400 }, 90, 2)).toContain('to the end of the horizon');
  });
  it('presets build valid shocks with engine days', () => {
    const ctx = { startDay: 11, monthDays: 31, quarterDays: 92, vehicleId: 'v1' };
    const by = Object.fromEntries(PRESETS.map((p) => [p.id, p.make(ctx)]));
    expect(by['fuel30']).toEqual(fuel30);
    expect(by['wet-spring']).toEqual({ type: 'weather', state: 'rainout', fromDay: 10, toDay: 24 });
    expect(by['demand-20']).toEqual({ type: 'multiplier', target: 'demand', factor: 0.8, fromDay: 10, toDay: 102 });
    expect(by['truck-out']).toEqual({ type: 'outage', assetId: 'v1', fromDay: 10, toDay: 17 });
    expect(by['absence-wave']).toEqual({ type: 'multiplier', target: 'absence', factor: 2, fromDay: 10, toDay: 41 });
    expect(by['slow-collections']).toMatchObject({ target: 'collection-days', factor: 1.5 });
    expect(PRESETS.find((p) => p.id === 'truck-out')!.make({ ...ctx, vehicleId: null })).toBeNull();
  });
  it('lays out timeline bars: clipped to the horizon, overlapping bars on separate rows', () => {
    const { bars, rows } = shockBars(
      [
        { fromDay: 0, toDay: 400 },
        { fromDay: 10, toDay: 24 },
        { fromDay: 40, toDay: 45 },
        { fromDay: 95, toDay: 99 },
      ],
      90,
      10,
    );
    expect(bars).toEqual([
      { index: 0, fromDay: 0, toDay: 90, row: 0 },
      { index: 1, fromDay: 10, toDay: 24, row: 1 },
      { index: 2, fromDay: 40, toDay: 45, row: 1 },
    ]);
    expect(rows).toBe(2);
  });
  it('playback feed names a shock from its index', () => {
    const f = dayFeed(5, [{ day: 5, type: 'shock-ended', shockIndex: 1 } as never], [], (id) => id, (i) => (i === 1 ? 'Rain' : undefined));
    expect(f).toEqual([{ kind: 'shock-end', text: 'Condition ended: Rain' }]);
  });
});
