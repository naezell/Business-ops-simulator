/**
 * financial-model.md §7 — end-of-day line of credit: interest, draw, repay, shortfall.
 * locStep(cashBefore, locBalance, limit, annualRate). Expected values are hand-computed.
 */
import { describe, expect, it } from 'vitest';
import { locStep } from '../../src/simulation';

describe('locStep: draw when cash is negative, capped by the limit', () => {
  it('draws exactly the shortfall when there is room', () => {
    // interest 0; cash −5,000 < 0 → draw = min(5,000, 20,000 − 0) = 5,000; cash = 0; balance = 5,000.
    const s = locStep(-5000, 0, 20000, 0.11);
    expect(s).toEqual({ interest: 0, draw: 5000, repay: 0, cash: 0, locBalance: 5000, shortfall: false });
  });

  it('draws only up to the limit and reports a shortfall beyond it', () => {
    // draw = min(30,000, 20,000 − 10,000) = 10,000; cash = −30,000 + 10,000 = −20,000; balance = 20,000.
    const s = locStep(-30000, 10000, 20000, 0);
    expect(s.draw).toBe(10000);
    expect(s.cash).toBe(-20000);
    expect(s.locBalance).toBe(20000);
    expect(s.shortfall).toBe(true);
  });

  it('a line already at its limit draws nothing and the cash hole stays visible', () => {
    // interest = 20,000 × 0.11 / 365 = 2,200 / 365 ≈ 6.027397; cash = −100 − 6.027397 = −106.027397;
    // draw = min(106.03, 20,000 − 20,000) = 0; shortfall = true.
    const s = locStep(-100, 20000, 20000, 0.11);
    expect(s.interest).toBeCloseTo(6.027397, 5);
    expect(s.draw).toBe(0);
    expect(s.cash).toBeCloseTo(-106.027397, 5);
    expect(s.shortfall).toBe(true);
  });
});

describe('locStep: repay when cash is positive and a balance is outstanding', () => {
  it('repays part of the balance from a smaller surplus', () => {
    // repay = min(5,000, 3,000) = 3,000; cash = 0; balance = 2,000.
    const s = locStep(3000, 5000, 20000, 0);
    expect(s).toEqual({ interest: 0, draw: 0, repay: 3000, cash: 0, locBalance: 2000, shortfall: false });
  });

  it('repays in full and keeps the surplus as cash', () => {
    // repay = min(5,000, 8,000) = 5,000; cash = 8,000 − 5,000 = 3,000; balance = 0.
    const s = locStep(8000, 5000, 20000, 0);
    expect(s.repay).toBe(5000);
    expect(s.cash).toBe(3000);
    expect(s.locBalance).toBe(0);
  });

  it('with no balance and positive cash nothing moves', () => {
    expect(locStep(4000, 0, 20000, 0.11)).toEqual({ interest: 0, draw: 0, repay: 0, cash: 4000, locBalance: 0, shortfall: false });
  });
});

describe('locStep: interest accrues on the opening balance before cash moves', () => {
  it('10,000 at 36.5% a year charges 10.00 of interest, then repays from the rest', () => {
    // interest = 10,000 × 0.365 / 365 = 10.00; cash = 1,000 − 10 = 990 ≥ 0;
    // repay = min(10,000, 990) = 990; cash = 0; balance = 10,000 − 990 = 9,010.
    const s = locStep(1000, 10000, 20000, 0.365);
    expect(s.interest).toBeCloseTo(10, 6);
    expect(s.repay).toBeCloseTo(990, 6);
    expect(s.cash).toBeCloseTo(0, 6);
    expect(s.locBalance).toBeCloseTo(9010, 6);
  });

  it('interest can turn a zero surplus into a small draw', () => {
    // interest = 1,000 × 0.365 / 365 = 1.00; cash = 0.5 − 1 = −0.5; draw = min(0.5, 19,000) = 0.5;
    // cash = 0; balance = 1,000 + 0.5 = 1,000.5.
    const s = locStep(0.5, 1000, 20000, 0.365);
    expect(s.interest).toBeCloseTo(1, 10);
    expect(s.draw).toBeCloseTo(0.5, 10);
    expect(s.cash).toBeCloseTo(0, 10);
    expect(s.locBalance).toBeCloseTo(1000.5, 10);
    expect(s.shortfall).toBe(false);
  });
});
