/**
 * financial-model.md §5 — loan payment and monthly amortization.
 * Every expected value below is worked out by hand in the comments; the function
 * under test is never used to produce an expectation.
 */
import { describe, expect, it } from 'vitest';
import { loanMonthStep, loanPayment } from '../../src/simulation';

describe('loanPayment: level annuity pmt = B·r / (1 − (1 + r)^−n)', () => {
  it('20,000 at 6% a year over 48 months is 469.70 a month', () => {
    // r = 0.06 / 12 = 0.005, n = 48.
    // 1.005^48 ≈ 1.270489, so 1.005^−48 ≈ 0.787098 and 1 − 0.787098 = 0.212902.
    // pmt = 20000 × 0.005 / 0.212902 = 100 / 0.212902 ≈ 469.70.
    expect(loanPayment(20000, 0.06, 48)).toBeCloseTo(469.7, 2);
  });

  it('zero interest rate gives principal / n', () => {
    // 12,000 / 36 = 333.333…
    expect(loanPayment(12000, 0, 36)).toBeCloseTo(333.3333, 4);
    // 6,000 / 12 = 500 exactly.
    expect(loanPayment(6000, 0, 12)).toBe(500);
  });

  it('one month remaining pays the balance plus one month of interest', () => {
    // pmt = B·r / (1 − 1/(1+r)) = B·r × (1 + r) / r = B(1 + r).
    // 1,000 × (1 + 0.005) = 1,005.00 (the one payment clears principal and one month of interest).
    expect(loanPayment(1000, 0.06, 1)).toBeCloseTo(1005, 6);
  });
});

describe('loanMonthStep: interest and principal split of a monthly payment', () => {
  const pmt = 469.7; // the 20,000 / 6% / 48 payment, rounded to cents.

  it('first payment: interest 100.00, principal 369.70, balance 19,630.30', () => {
    // interest = 20,000 × 0.06 / 12 = 100.00
    // principal = 469.70 − 100.00 = 369.70
    // balance = 20,000 − 369.70 = 19,630.30
    const s = loanMonthStep(20000, 0.06, pmt, 48);
    expect(s.interest).toBeCloseTo(100.0, 6);
    expect(s.principal).toBeCloseTo(369.7, 6);
    expect(s.balance).toBeCloseTo(19630.3, 6);
    expect(s.monthsRemaining).toBe(47);
  });

  it('second payment: interest 98.15, principal 371.55, balance 19,258.75', () => {
    // interest = 19,630.30 × 0.06 / 12 = 19,630.30 × 0.005 = 98.1515 → 98.15
    // principal = 469.70 − 98.1515 = 371.5485 → 371.55
    // balance = 19,630.30 − 371.5485 = 19,258.7515 → 19,258.75
    const first = loanMonthStep(20000, 0.06, pmt, 48);
    const second = loanMonthStep(first.balance, 0.06, pmt, first.monthsRemaining);
    expect(second.interest).toBeCloseTo(98.15, 2);
    expect(second.principal).toBeCloseTo(371.55, 2);
    expect(second.balance).toBeCloseTo(19258.75, 2);
    expect(second.monthsRemaining).toBe(46);
  });

  it('final scheduled payment (one month remaining) retires the whole balance', () => {
    // interest = 1,000 × 0.06 / 12 = 5.00; principal = whole balance = 1,000.00; balance = 0.
    const s = loanMonthStep(1000, 0.06, 0, 1);
    expect(s).toEqual({ interest: 5, principal: 1000, balance: 0, monthsRemaining: 0 });
  });

  it('principal never exceeds the balance', () => {
    // interest = 100 × 0.06 / 12 = 0.50; pmt − interest = 499.50 > 100, so principal = 100; balance = 0.
    const s = loanMonthStep(100, 0.06, 500, 5);
    expect(s.principal).toBe(100);
    expect(s.balance).toBe(0);
    expect(s.interest).toBeCloseTo(0.5, 10);
  });

  it('with zero rate every payment is all principal', () => {
    // interest = 0; principal = 100; balance = 1,200 − 100 = 1,100; 12 − 1 = 11 months left.
    const s = loanMonthStep(1200, 0, 100, 12);
    expect(s).toEqual({ interest: 0, principal: 100, balance: 1100, monthsRemaining: 11 });
  });

  it('a settled loan (zero balance or no months left) changes nothing', () => {
    expect(loanMonthStep(0, 0.06, 469.7, 10)).toEqual({ interest: 0, principal: 0, balance: 0, monthsRemaining: 10 });
    expect(loanMonthStep(5000, 0.06, 469.7, 0)).toEqual({ interest: 0, principal: 0, balance: 5000, monthsRemaining: 0 });
  });
});
