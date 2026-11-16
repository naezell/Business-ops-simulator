/**
 * Digital-twin shocks (simulation-design §2): hand-computed unit tests for the pure formulas in
 * src/simulation/conditions.ts. Every expected value is worked out in a comment; none is produced by
 * calling the function under test.
 */
import { describe, expect, it } from 'vitest';
import {
  coveredBy,
  forcedWeather,
  initConditions,
  inWindow,
  multipliersForDay,
  NO_SHOCK,
  scaleProbability,
  shockEventsForDay,
  shockedCollectionDelay,
  shockMultiplier,
  type CondState,
} from '../../src/simulation/conditions';
import type { Shock, ShockTarget } from '../../src/simulation/types';

/** The 13 shock targets, written out by hand (simulation-design §2 table). */
const TARGETS: ShockTarget[] = [
  'demand',
  'leads',
  'churn',
  'fuel-price',
  'materials-cost',
  'absence',
  'turnover',
  'vehicle-breakdown',
  'equipment-breakdown',
  'repair-cost',
  'maintenance-cost',
  'travel-time',
  'collection-days',
];

const mult = (target: ShockTarget, factor: number, fromDay: number, toDay: number): Shock => ({ type: 'multiplier', target, factor, fromDay, toDay });

/** Per-run state built by hand: multiplierShocks is true iff at least one multiplier shock is present. */
function condOf(shocks: Shock[]): CondState {
  return { shocks, multiplierShocks: shocks.some((s) => s.type === 'multiplier'), outages: new Map(), absences: new Map() };
}

/** Expected multipliers: every target 1 except the ones listed in `over`. */
function expectedOnes(over: Partial<Record<ShockTarget, number>> = {}): Record<ShockTarget, number> {
  const out = {} as Record<ShockTarget, number>;
  for (const t of TARGETS) out[t] = over[t] ?? 1;
  return out;
}

// ───────────── inWindow ─────────────

describe('inWindow: half-open window [fromDay, toDay)', () => {
  it('includes fromDay and excludes toDay', () => {
    expect(inWindow(5, 5, 8)).toBe(true);
    expect(inWindow(7, 5, 8)).toBe(true);
    expect(inWindow(8, 5, 8)).toBe(false);
    expect(inWindow(4, 5, 8)).toBe(false);
  });

  it('an empty window [d, d) contains no day', () => {
    expect(inWindow(5, 5, 5)).toBe(false);
    expect(inWindow(4, 5, 5)).toBe(false);
    expect(inWindow(6, 5, 5)).toBe(false);
  });

  it('day 0 is a valid day', () => {
    expect(inWindow(0, 0, 1)).toBe(true);
    expect(inWindow(1, 0, 1)).toBe(false);
  });
});

// ───────────── shockMultiplier ─────────────

describe('shockMultiplier: product of multiplier shocks on one target', () => {
  it('is 1 when there are no shocks', () => {
    expect(shockMultiplier([], 'demand', 3)).toBe(1);
  });

  it('single shock: factor 1.5 on [10, 20)', () => {
    const shocks = [mult('demand', 1.5, 10, 20)];
    expect(shockMultiplier(shocks, 'demand', 9)).toBe(1); // before the window
    expect(shockMultiplier(shocks, 'demand', 10)).toBe(1.5); // fromDay included
    expect(shockMultiplier(shocks, 'demand', 19)).toBe(1.5); // last day inside
    expect(shockMultiplier(shocks, 'demand', 20)).toBe(1); // toDay excluded
  });

  it('overlapping shocks on the same target multiply: demand 2 on [0, 10) and 1.5 on [5, 15)', () => {
    const shocks = [mult('demand', 2, 0, 10), mult('demand', 1.5, 5, 15)];
    expect(shockMultiplier(shocks, 'demand', 3)).toBe(2); // only the first
    expect(shockMultiplier(shocks, 'demand', 7)).toBe(3); // 2 × 1.5
    expect(shockMultiplier(shocks, 'demand', 12)).toBe(1.5); // only the second
    expect(shockMultiplier(shocks, 'demand', 15)).toBe(1); // neither
  });

  it('non-overlapping windows on the same target take the active one only: 2 on [0, 5), 3 on [5, 10)', () => {
    const shocks = [mult('demand', 2, 0, 5), mult('demand', 3, 5, 10)];
    expect(shockMultiplier(shocks, 'demand', 4)).toBe(2);
    expect(shockMultiplier(shocks, 'demand', 5)).toBe(3); // second starts exactly where the first ends
    expect(shockMultiplier(shocks, 'demand', 9)).toBe(3);
    expect(shockMultiplier(shocks, 'demand', 10)).toBe(1);
  });

  it('factors below one compound: 0.5 × 0.5 = 0.25 on [0, 4)', () => {
    const shocks = [mult('demand', 0.5, 0, 4), mult('demand', 0.5, 0, 4)];
    expect(shockMultiplier(shocks, 'demand', 2)).toBe(0.25);
  });

  it('a factor of 0 zeroes the target, even when combined with another shock: 0 × 2 = 0', () => {
    expect(shockMultiplier([mult('leads', 0, 0, 4)], 'leads', 2)).toBe(0);
    expect(shockMultiplier([mult('leads', 2, 0, 4), mult('leads', 0, 0, 4)], 'leads', 2)).toBe(0);
  });

  it('a target that is not shocked stays at 1, even on a day a different target is shocked', () => {
    const shocks = [mult('leads', 2, 0, 10)];
    expect(shockMultiplier(shocks, 'leads', 3)).toBe(2);
    for (const t of TARGETS.filter((x) => x !== 'leads')) expect(shockMultiplier(shocks, t, 3)).toBe(1);
  });

  it('outage, absence and weather shocks do not affect any multiplier', () => {
    const shocks: Shock[] = [
      { type: 'outage', assetId: 'v1', fromDay: 0, toDay: 100 },
      { type: 'absence', employeeIds: ['e1'], fromDay: 0, toDay: 100 },
      { type: 'weather', state: 'rainout', fromDay: 0, toDay: 100 },
    ];
    for (const t of TARGETS) expect(shockMultiplier(shocks, t, 50)).toBe(1);
    // With a demand multiplier present, the non-multiplier shocks leave its value unchanged: 2 both ways.
    expect(shockMultiplier([...shocks, mult('demand', 2, 0, 100)], 'demand', 50)).toBe(2);
    expect(shockMultiplier([mult('demand', 2, 0, 100)], 'demand', 50)).toBe(2);
  });
});

// ───────────── scaleProbability ─────────────

describe('scaleProbability: p × M clamped to [0, 1]', () => {
  it('is exactly p when M = 1 (Object.is identity)', () => {
    for (const p of [0, 0.3, 1, 0.123456789]) expect(Object.is(scaleProbability(p, 1), p)).toBe(true);
  });

  it('scales without clamping: 0.25 × 1.5 = 0.375 (exact in binary)', () => {
    expect(scaleProbability(0.25, 1.5)).toBe(0.375);
    expect(scaleProbability(0.5, 0.5)).toBe(0.25);
  });

  it('clamps at 1: 0.4 × 3 = 1.2 → 1', () => {
    expect(Object.is(scaleProbability(0.4, 3), 1)).toBe(true);
  });

  it('exactly 1 stays 1: 0.5 × 2 = 1', () => {
    expect(Object.is(scaleProbability(0.5, 2), 1)).toBe(true);
  });

  it('factor 0 gives 0: 0.7 × 0 = 0', () => {
    expect(Object.is(scaleProbability(0.7, 0), 0)).toBe(true);
  });

  it('clamps at 0 for a negative product: 0.25 × (−2) = −0.5 → 0', () => {
    expect(Object.is(scaleProbability(0.25, -2), 0)).toBe(true);
  });
});

// ───────────── shockedCollectionDelay ─────────────

describe('shockedCollectionDelay: round(delay × M), never negative', () => {
  it('is exactly the delay when M = 1 (Object.is identity), including non-integers', () => {
    expect(Object.is(shockedCollectionDelay(7, 1), 7)).toBe(true);
    expect(Object.is(shockedCollectionDelay(2.5, 1), 2.5)).toBe(true);
    expect(Object.is(shockedCollectionDelay(0, 1), 0)).toBe(true);
  });

  it('7 × 1.5 = 10.5 → Math.round → 11 (half rounds up)', () => {
    expect(shockedCollectionDelay(7, 1.5)).toBe(11);
  });

  it('5 × 0.3 = 1.5 (IEEE product rounds to exactly 1.5) → 2', () => {
    expect(shockedCollectionDelay(5, 0.3)).toBe(2);
  });

  it('10 × 0.25 = 2.5 → 3; 3 × 0.8 = 2.4 → 2; 4 × 1.2 = 4.8 → 5', () => {
    expect(shockedCollectionDelay(10, 0.25)).toBe(3);
    expect(shockedCollectionDelay(3, 0.8)).toBe(2);
    expect(shockedCollectionDelay(4, 1.2)).toBe(5);
  });

  it('delay 0 stays 0 for any multiplier: 0 × 2 = 0', () => {
    expect(shockedCollectionDelay(0, 2)).toBe(0);
  });

  it('M = 0 gives 0: 5 × 0 = 0', () => {
    expect(shockedCollectionDelay(5, 0)).toBe(0);
  });
});

// ───────────── multipliersForDay ─────────────

describe('multipliersForDay: today’s multiplier per target', () => {
  it('no state (null) gives all ones', () => {
    expect(multipliersForDay(null, 4)).toEqual(expectedOnes());
  });

  it('a run without multiplier shocks gives all ones, even with outage, absence and weather shocks', () => {
    const cond: CondState = {
      shocks: [
        { type: 'outage', assetId: 'v1', fromDay: 0, toDay: 10 },
        { type: 'absence', employeeIds: ['e1'], fromDay: 0, toDay: 10 },
        { type: 'weather', state: 'partial', fromDay: 0, toDay: 10 },
      ],
      multiplierShocks: false,
      outages: new Map(),
      absences: new Map(),
    };
    expect(multipliersForDay(cond, 5)).toEqual(expectedOnes());
  });

  it('a single window: demand 2 on [0, 10) gives demand 2 on day 5 and all ones on day 10', () => {
    const cond = condOf([mult('demand', 2, 0, 10)]);
    expect(multipliersForDay(cond, 5)).toEqual(expectedOnes({ demand: 2 }));
    expect(multipliersForDay(cond, 10)).toEqual(expectedOnes());
  });

  it('overlaps on several targets: demand 2 on [0, 10), demand 1.5 on [5, 8), leads 3 on [5, 10)', () => {
    const cond = condOf([mult('demand', 2, 0, 10), mult('demand', 1.5, 5, 8), mult('leads', 3, 5, 10)]);
    // day 6: demand 2 × 1.5 = 3, leads 3
    expect(multipliersForDay(cond, 6)).toEqual(expectedOnes({ demand: 3, leads: 3 }));
    // day 8: the 1.5 window has ended (toDay 8 excluded): demand 2, leads 3
    expect(multipliersForDay(cond, 8)).toEqual(expectedOnes({ demand: 2, leads: 3 }));
    // day 2: only the demand 2 window: demand 2
    expect(multipliersForDay(cond, 2)).toEqual(expectedOnes({ demand: 2 }));
  });

  it('non-multiplier shocks on the same day leave the multipliers unchanged', () => {
    const cond: CondState = {
      shocks: [mult('churn', 0.5, 0, 10), { type: 'outage', assetId: 'v1', fromDay: 0, toDay: 10 }],
      multiplierShocks: true,
      outages: new Map(),
      absences: new Map(),
    };
    expect(multipliersForDay(cond, 3)).toEqual(expectedOnes({ churn: 0.5 }));
  });
});

// ───────────── forcedWeather ─────────────

describe('forcedWeather: weather forced by a weather shock', () => {
  it('no state gives null', () => {
    expect(forcedWeather(null, 3)).toBeNull();
  });

  it('single window [3, 6): null before, rainout on 3 and 5, null from 6', () => {
    const cond = condOf([{ type: 'weather', state: 'rainout', fromDay: 3, toDay: 6 }]);
    expect(forcedWeather(cond, 2)).toBeNull();
    expect(forcedWeather(cond, 3)).toBe('rainout');
    expect(forcedWeather(cond, 5)).toBe('rainout');
    expect(forcedWeather(cond, 6)).toBeNull();
  });

  it('on overlap the last matching shock in array order wins', () => {
    const cond = condOf([
      { type: 'weather', state: 'clear', fromDay: 0, toDay: 10 },
      { type: 'weather', state: 'rainout', fromDay: 5, toDay: 8 },
    ]);
    expect(forcedWeather(cond, 4)).toBe('clear'); // only the first
    expect(forcedWeather(cond, 6)).toBe('rainout'); // both match; the second is later in the array
    expect(forcedWeather(cond, 8)).toBe('clear'); // second has ended
  });

  it('reversing the array reverses the winner on the overlap', () => {
    const cond = condOf([
      { type: 'weather', state: 'rainout', fromDay: 5, toDay: 8 },
      { type: 'weather', state: 'clear', fromDay: 0, toDay: 10 },
    ]);
    expect(forcedWeather(cond, 6)).toBe('clear');
  });

  it('multiplier, outage and absence shocks never force weather', () => {
    const cond: CondState = {
      shocks: [mult('demand', 2, 0, 10), { type: 'outage', assetId: 'v1', fromDay: 0, toDay: 10 }, { type: 'absence', employeeIds: ['e1'], fromDay: 0, toDay: 10 }],
      multiplierShocks: true,
      outages: new Map(),
      absences: new Map(),
    };
    expect(forcedWeather(cond, 5)).toBeNull();
  });
});

// ───────────── shockEventsForDay ─────────────

describe('shockEventsForDay: shock-started / shock-ended per day', () => {
  // Shock list (index: shape)
  //  0: multiplier demand 2 over [5, 10)
  //  1: outage v1 over [10, 12)
  //  2: absence [e1] over [3, 10)
  //  3: weather rainout over [10, 20)
  //  4: multiplier leads 1.5 over [10, 15)
  const cond = condOf([
    mult('demand', 2, 5, 10),
    { type: 'outage', assetId: 'v1', fromDay: 10, toDay: 12 },
    { type: 'absence', employeeIds: ['e1'], fromDay: 3, toDay: 10 },
    { type: 'weather', state: 'rainout', fromDay: 10, toDay: 20 },
    mult('leads', 1.5, 10, 15),
  ]);

  it('no state gives no events', () => {
    expect(shockEventsForDay(null, 5)).toEqual([]);
  });

  it('a start only: day 3 starts shock 2; day 5 starts shock 0', () => {
    expect(shockEventsForDay(cond, 3)).toEqual([{ type: 'shock-started', shockIndex: 2 }]);
    expect(shockEventsForDay(cond, 5)).toEqual([{ type: 'shock-started', shockIndex: 0 }]);
  });

  it('a day with no boundary gives no events', () => {
    expect(shockEventsForDay(cond, 7)).toEqual([]);
    expect(shockEventsForDay(cond, 9)).toEqual([]); // the day before toDay 10: nothing ends yet
  });

  it('day 10: ends (shocks 0 and 2) come before starts (shocks 1, 3, 4); each group in shock index order', () => {
    expect(shockEventsForDay(cond, 10)).toEqual([
      { type: 'shock-ended', shockIndex: 0 },
      { type: 'shock-ended', shockIndex: 2 },
      { type: 'shock-started', shockIndex: 1 },
      { type: 'shock-started', shockIndex: 3 },
      { type: 'shock-started', shockIndex: 4 },
    ]);
  });

  it('later boundaries: day 12 ends shock 1; day 15 ends shock 4; day 20 ends shock 3', () => {
    expect(shockEventsForDay(cond, 12)).toEqual([{ type: 'shock-ended', shockIndex: 1 }]);
    expect(shockEventsForDay(cond, 15)).toEqual([{ type: 'shock-ended', shockIndex: 4 }]);
    expect(shockEventsForDay(cond, 20)).toEqual([{ type: 'shock-ended', shockIndex: 3 }]);
  });

  it('a zero-length window [4, 4) emits a start on day 4 and no end (ended requires toDay > fromDay)', () => {
    // Not specified in §2; this records the implemented behaviour so a change is noticed.
    const z = condOf([mult('demand', 2, 4, 4)]);
    expect(shockEventsForDay(z, 4)).toEqual([{ type: 'shock-started', shockIndex: 0 }]);
  });
});

// ───────────── initConditions ─────────────

describe('initConditions: per-run state', () => {
  it('undefined and an empty list give null', () => {
    expect(initConditions(undefined)).toBeNull();
    expect(initConditions([])).toBeNull();
  });

  it('only outage, absence and weather shocks: state exists but multiplierShocks is false', () => {
    const st = initConditions([
      { type: 'outage', assetId: 'v1', fromDay: 0, toDay: 3 },
      { type: 'absence', employeeIds: ['e1'], fromDay: 0, toDay: 3 },
      { type: 'weather', state: 'clear', fromDay: 0, toDay: 3 },
    ]);
    expect(st).not.toBeNull();
    expect(st!.multiplierShocks).toBe(false);
  });

  it('a multiplier shock sets multiplierShocks', () => {
    expect(initConditions([mult('leads', 2, 0, 3)])!.multiplierShocks).toBe(true);
  });

  it('outage windows are keyed by asset in array order: v1 → [[3,6],[10,12]], v2 → [[0,2]]', () => {
    const st = initConditions([
      { type: 'outage', assetId: 'v1', fromDay: 3, toDay: 6 },
      { type: 'outage', assetId: 'v2', fromDay: 0, toDay: 2 },
      { type: 'outage', assetId: 'v1', fromDay: 10, toDay: 12 },
    ])!;
    expect(st.outages.get('v1')).toEqual([
      [3, 6],
      [10, 12],
    ]);
    expect(st.outages.get('v2')).toEqual([[0, 2]]);
    expect(st.outages.has('v3')).toBe(false);
  });

  it('an absence shock lists its window under every employee id: e1 and e2 → [[1,4]]', () => {
    const st = initConditions([{ type: 'absence', employeeIds: ['e1', 'e2'], fromDay: 1, toDay: 4 }])!;
    expect(st.absences.get('e1')).toEqual([[1, 4]]);
    expect(st.absences.get('e2')).toEqual([[1, 4]]);
  });

  it('keeps its own copy of the shocks: mutating the input afterwards does not change the state', () => {
    const input: Shock[] = [mult('demand', 1.5, 0, 5)];
    const st = initConditions(input)!;
    (input[0] as { factor: number }).factor = 9;
    expect(shockMultiplier(st.shocks, 'demand', 2)).toBe(1.5);
  });
});

// ───────────── coveredBy ─────────────

describe('coveredBy: day inside any [a, b) window', () => {
  it('undefined and an empty list cover nothing', () => {
    expect(coveredBy(undefined, 3)).toBe(false);
    expect(coveredBy([], 3)).toBe(false);
  });

  it('windows [3,6] and [10,12] with the half-open rule: 2 no, 3 yes, 5 yes, 6 no, 9 no, 10 yes, 11 yes, 12 no', () => {
    const w: [number, number][] = [
      [3, 6],
      [10, 12],
    ];
    expect([2, 3, 5, 6, 9, 10, 11, 12].map((d) => coveredBy(w, d))).toEqual([false, true, true, false, false, true, true, false]);
  });

  it('a zero-length window [4, 4) covers no day', () => {
    expect(coveredBy([[4, 4]], 4)).toBe(false);
  });
});

// ───────────── NO_SHOCK ─────────────

describe('NO_SHOCK: shared all-ones value', () => {
  it('has 1 for each of the 13 targets', () => {
    expect(Object.keys(NO_SHOCK).sort()).toEqual([...TARGETS].sort());
    expect(NO_SHOCK).toEqual(expectedOnes());
  });

  it('is frozen: writing to it throws', () => {
    expect(Object.isFrozen(NO_SHOCK)).toBe(true);
    expect(() => {
      (NO_SHOCK as Record<string, number>).demand = 2;
    }).toThrow(TypeError);
    expect(NO_SHOCK.demand).toBe(1);
  });
});
