/**
 * Digital-twin disposal and owner distributions (simulation-design §6): hand-computed unit tests for
 * disposalProceeds, ownerDistribution and DEFAULT_RESALE_SHARE in src/simulation/finance/formulas.ts.
 * Every expected value is worked out in a comment; none is produced by calling the function under test.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RESALE_SHARE, disposalProceeds, ownerDistribution } from '../../src/simulation/finance/formulas';

describe('DEFAULT_RESALE_SHARE', () => {
  it('is 0.8 (simulation-design §6 default share)', () => {
    expect(DEFAULT_RESALE_SHARE).toBe(0.8);
  });
});

describe('disposalProceeds: P = S + share × max(0, B − S)', () => {
  it('B > S: B 10 000, S 2 000, share 0.8 → 2 000 + 0.8 × 8 000 = 2 000 + 6 400 = 8 400', () => {
    expect(disposalProceeds(10000, 2000, 0.8)).toBe(8400);
  });

  it('the default share gives the same result: 2 000 + 0.8 × 8 000 = 8 400', () => {
    expect(disposalProceeds(10000, 2000, DEFAULT_RESALE_SHARE)).toBe(8400);
  });

  it('B = S: 2 000 + 0.8 × 0 = 2 000 (the salvage value)', () => {
    expect(disposalProceeds(2000, 2000, 0.8)).toBe(2000);
  });

  it('B < S: the max(0, ·) floor gives exactly S: 1 500 + 0.8 × max(0, −500) = 1 500 + 0 = 1 500', () => {
    expect(disposalProceeds(1000, 1500, 0.8)).toBe(1500);
    expect(Object.is(disposalProceeds(1000, 1500, 0.8), 1500)).toBe(true);
  });

  it('share 0 always gives S: 2 000 + 0 × 8 000 = 2 000', () => {
    expect(disposalProceeds(10000, 2000, 0)).toBe(2000);
  });

  it('share 1 gives B: 2 000 + 1 × 8 000 = 10 000', () => {
    expect(disposalProceeds(10000, 2000, 1)).toBe(10000);
  });

  it('share 0.5: B 5 000, S 1 000 → 1 000 + 0.5 × 4 000 = 3 000', () => {
    expect(disposalProceeds(5000, 1000, 0.5)).toBe(3000);
  });

  it('zero salvage: B 4 000, S 0, share 0.8 → 0 + 0.8 × 4 000 = 3 200', () => {
    expect(disposalProceeds(4000, 0, 0.8)).toBe(3200);
  });

  it('a fully depreciated asset with no salvage gives 0: B 0, S 0 → 0', () => {
    expect(disposalProceeds(0, 0, 0.8)).toBe(0);
  });

  it('linear in share (B 10 000, S 2 000): share 0, 0.5, 1 → 2 000, 6 000, 10 000', () => {
    // 2 000 + 0 × 8 000; 2 000 + 0.5 × 8 000; 2 000 + 1 × 8 000
    expect([0, 0.5, 1].map((s) => disposalProceeds(10000, 2000, s))).toEqual([2000, 6000, 10000]);
  });
});

describe('gain on disposal = P − B (sign)', () => {
  // [B, S, share, P, gain = P − B]
  const rows: [number, number, number, number, number][] = [
    [10000, 2000, 0.8, 8400, -1600], // 8 400 − 10 000
    [2000, 2000, 0.8, 2000, 0], // no gap between book and salvage
    [10000, 2000, 1, 10000, 0], // full recovery of book value
    [10000, 2000, 0, 2000, -8000], // 2 000 − 10 000
    [5000, 1000, 0.5, 3000, -2000], // 3 000 − 5 000
  ];

  it.each(rows)('B %d, S %d, share %d: P = %d, gain = %d', (b, s, share, p, gain) => {
    const proceeds = disposalProceeds(b, s, share);
    expect(proceeds).toBe(p);
    expect(proceeds - b).toBe(gain);
    expect(proceeds - b).toBeLessThanOrEqual(0);
  });

  it('for B > S and share < 1 the gain is −(1 − share)(B − S): −0.2 × 8 000 = −1 600', () => {
    expect(disposalProceeds(10000, 2000, 0.8) - 10000).toBeCloseTo(-(1 - 0.8) * (10000 - 2000), 6);
  });

  it('B < S (floor active) gives a positive gain of S − B = 1 500 − 1 000 = +500', () => {
    // Note: §6 says the gain is "usually ≤ 0"; the floor makes it positive when book value is below salvage.
    expect(disposalProceeds(1000, 1500, 0.8) - 1000).toBe(500);
  });
});

describe('ownerDistribution: D = max(0, cash − X) while the line of credit is undrawn', () => {
  it('a line-of-credit balance above 0 gives 0, even with cash far above X: 10 000 − 4 000 but LOC 1 → 0', () => {
    expect(ownerDistribution(10000, 4000, 1)).toBe(0);
    expect(ownerDistribution(10000, 4000, 0.01)).toBe(0);
  });

  it('LOC 0 and cash above X: D = 10 000 − 4 000 = 6 000', () => {
    expect(ownerDistribution(10000, 4000, 0)).toBe(6000);
  });

  it('LOC 0 and cash below X: max(0, 3 000 − 4 000) = 0', () => {
    expect(ownerDistribution(3000, 4000, 0)).toBe(0);
  });

  it('LOC 0 and cash exactly at X: max(0, 0) = 0', () => {
    expect(ownerDistribution(4000, 4000, 0)).toBe(0);
  });

  it('X = 0 pays out all positive cash: 2 500 − 0 = 2 500', () => {
    expect(ownerDistribution(2500, 0, 0)).toBe(2500);
  });

  it('X = 0 and negative cash: max(0, −300) = 0', () => {
    expect(ownerDistribution(-300, 0, 0)).toBe(0);
  });

  it('after the distribution, cash equals X: 10 000 − 6 000 = 4 000', () => {
    const d = ownerDistribution(10000, 4000, 0);
    expect(10000 - d).toBe(4000);
  });
});
