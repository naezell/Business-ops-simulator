/**
 * Decision-rule helpers (simulation-design §9): edge cases for compare, safeRatio, trailing,
 * substituteEach and mentionsEach in src/simulation/rules.ts. Expected values are worked out by hand
 * in comments. The basic cases already live in tests/simulation/rules.test.ts and are not repeated here.
 */
import { describe, expect, it } from 'vitest';
import { compare, EACH, mentionsEach, safeRatio, substituteEach, trailing } from '../../src/simulation/rules';
import type { DailyRecord } from '../../src/simulation/types';

/** A record carrying only the field the helper reads: ops.jobsCompleted = v. */
const rec = (v: number) => ({ ops: { jobsCompleted: v } }) as unknown as DailyRecord;
const completed = (d: DailyRecord) => d.ops.jobsCompleted;

describe('compare: float and special-value edge cases', () => {
  it('== uses ===, so 0.1 + 0.2 is not equal to 0.3 (0.30000000000000004 in IEEE doubles)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(compare(0.1 + 0.2, '==', 0.3)).toBe(false);
    expect(compare(0.1 + 0.2, '!=', 0.3)).toBe(true);
    expect(compare(0.1 + 0.2, '>', 0.3)).toBe(true);
  });

  it('exact binary fractions compare equal: 0.5 == 0.5, 0.25 < 0.5', () => {
    expect(compare(0.5, '==', 0.5)).toBe(true);
    expect(compare(0.25, '<', 0.5)).toBe(true);
  });

  it('<= and >= include equality at the boundary: 4 <= 4 and 4 >= 4', () => {
    expect(compare(4, '<=', 4)).toBe(true);
    expect(compare(4, '>=', 4)).toBe(true);
    expect(compare(4, '<', 4)).toBe(false);
    expect(compare(4, '>', 4)).toBe(false);
  });

  it('negative zero equals zero under ===: −0 == 0 → true', () => {
    expect(compare(-0, '==', 0)).toBe(true);
  });

  it('NaN is never equal to anything, and != is true: NaN == NaN → false, NaN != NaN → true', () => {
    expect(compare(NaN, '==', NaN)).toBe(false);
    expect(compare(NaN, '!=', NaN)).toBe(true);
    expect(compare(NaN, '<', 1)).toBe(false);
    expect(compare(NaN, '>=', 1)).toBe(false);
  });

  it('infinities order normally: Infinity > 1e308, −Infinity < −1e308', () => {
    expect(compare(Infinity, '>', 1e308)).toBe(true);
    expect(compare(-Infinity, '<', -1e308)).toBe(true);
  });
});

describe('safeRatio: num / den with 0 when den is 0', () => {
  it('0 / 0 gives 0', () => {
    expect(safeRatio(0, 0)).toBe(0);
  });

  it('a non-zero numerator over a zero denominator gives 0, not ±Infinity: −3 / 0 → 0', () => {
    expect(safeRatio(-3, 0)).toBe(0);
    expect(safeRatio(3, 0)).toBe(0);
  });

  it('zero numerator gives 0: 0 / 5 = 0', () => {
    expect(safeRatio(0, 5)).toBe(0);
  });

  it('a negative denominator divides normally: 5 / −2 = −2.5 (no sign clamp)', () => {
    expect(safeRatio(5, -2)).toBe(-2.5);
  });

  it('1 / 3 = 0.333…', () => {
    expect(safeRatio(1, 3)).toBeCloseTo(0.333333333333, 10);
  });
});

describe('trailing: sum over records [day − n, day − 1], clipped at 0', () => {
  const days = [10, 20, 30, 40, 50].map(rec);

  it('day 0 has no earlier records, so the sum is 0 and pick is never called', () => {
    const pick = () => {
      throw new Error('pick must not be called on day 0');
    };
    expect(trailing(days, 0, 28, pick as never)).toBe(0);
  });

  it('day 1 with n 1 reads only record 0: 10', () => {
    expect(trailing(days, 1, 1, completed)).toBe(10);
  });

  it('the current day is excluded: day 2 with n 1 reads record 1 only (20), not record 2 (30)', () => {
    expect(trailing(days, 2, 1, completed)).toBe(20);
  });

  it('n 0 is an empty window: 0', () => {
    expect(trailing(days, 4, 0, completed)).toBe(0);
  });

  it('a window longer than the history is clipped at day 0: day 3 with n 28 sums records 0..2 = 10 + 20 + 30 = 60', () => {
    expect(trailing(days, 3, 28, completed)).toBe(60);
  });

  it('a window exactly equal to the history: day 5 with n 5 sums 10 + 20 + 30 + 40 + 50 = 150', () => {
    expect(trailing(days, 5, 5, completed)).toBe(150);
  });

  it('the pick function selects the field: day 4, n 2 sums jobsCompleted of records 2 and 3 = 30 + 40 = 70', () => {
    expect(trailing(days, 4, 2, completed)).toBe(70);
  });
});

describe('substituteEach: deep copy with $each replaced', () => {
  it('replaces $each inside nested arrays and objects: [["$each", 1], [{ b: "$each" }]] → [["v1", 1], [{ b: "v1" }]]', () => {
    const input = { a: [['$each', 1], [{ b: '$each' }]] };
    expect(substituteEach(input, 'v1')).toEqual({ a: [['v1', 1], [{ b: 'v1' }]] });
  });

  it('replaces a top-level $each string: "$each" → "v1"', () => {
    expect(substituteEach('$each', 'v1')).toBe('v1');
  });

  it('does not mutate the input, and returns new containers', () => {
    const input = { a: ['$each', { b: '$each' }] };
    const out = substituteEach(input, 'v2');
    expect(input).toEqual({ a: ['$each', { b: '$each' }] });
    expect(out).not.toBe(input);
    expect(out.a).not.toBe(input.a);
    expect(out.a[1]).not.toBe(input.a[1]);
  });

  it('leaves look-alike strings, numbers, booleans and null untouched', () => {
    const input = { s: ['$eachx', 'each', '$EACH', ''], n: 0, t: true, z: null };
    expect(substituteEach(input, 'v1')).toEqual({ s: ['$eachx', 'each', '$EACH', ''], n: 0, t: true, z: null });
  });

  it('replaces $each in values only; a key named $each is kept', () => {
    expect(substituteEach({ $each: 1 }, 'v1')).toEqual({ $each: 1 });
    expect(substituteEach({ id: '$each' }, 'v1')).toEqual({ id: 'v1' });
  });

  it('replaces $each in every element of an array of objects: [{ id: "$each" }, { id: "x" }] → [{ id: "v1" }, { id: "x" }]', () => {
    expect(substituteEach([{ id: '$each' }, { id: 'x' }], 'v1')).toEqual([{ id: 'v1' }, { id: 'x' }]);
  });

  it('the EACH constant is the literal string "$each"', () => {
    expect(EACH).toBe('$each');
  });
});

describe('mentionsEach: true iff the literal $each occurs anywhere in the value', () => {
  it('finds $each at the top level, in an array, in an object and deeply nested', () => {
    expect(mentionsEach('$each')).toBe(true);
    expect(mentionsEach(['x', '$each'])).toBe(true);
    expect(mentionsEach({ a: { b: 1, c: '$each' } })).toBe(true);
    expect(mentionsEach([{ a: { b: ['$each'] } }])).toBe(true);
  });

  it('is false for values without $each: primitives, null, undefined, empty containers', () => {
    expect(mentionsEach(1)).toBe(false);
    expect(mentionsEach(null)).toBe(false);
    expect(mentionsEach(undefined)).toBe(false);
    expect(mentionsEach([])).toBe(false);
    expect(mentionsEach({})).toBe(false);
  });

  it('is false for look-alike strings: "$each!", "each" and " $each"', () => {
    expect(mentionsEach('$each!')).toBe(false);
    expect(mentionsEach('each')).toBe(false);
    expect(mentionsEach(' $each')).toBe(false);
  });

  it('checks values only: a key named $each with another value is false', () => {
    expect(mentionsEach({ $each: 'x' })).toBe(false);
  });

  it('agrees with substituteEach: the input mentions $each and the substituted copy does not', () => {
    const input = { a: [{ b: '$each' }] };
    expect(mentionsEach(input)).toBe(true);
    expect(mentionsEach(substituteEach(input, 'v1'))).toBe(false);
  });
});
