/**
 * financial-model.md §1 (receivables) and §2 (labor): weekly overtime, payroll burden,
 * payday cadence, collection delay and bad debt. Expected values are hand-computed.
 */
import { describe, expect, it } from 'vitest';
import {
  collectionDelay,
  isBadDebt,
  isOvertimeSettlementDay,
  isPayday,
  payrollBurden,
  weeklyOvertime,
  weeklyOvertimePremium,
} from '../../src/simulation';

describe('weekly overtime premium = (overtimeMultiplier − 1) × wage × max(0, weekPaid − threshold)', () => {
  it('38 paid hours against a 40-hour threshold: no overtime, premium 0', () => {
    // otHours = max(0, 38 − 40) = max(0, −2) = 0; premium = 0.5 × 20 × 0 = 0.
    expect(weeklyOvertimePremium(38, 40, 1.5, 20)).toBe(0);
  });

  it('exactly 40 paid hours: no overtime, premium 0', () => {
    // otHours = max(0, 40 − 40) = 0; premium = 0.
    expect(weeklyOvertimePremium(40, 40, 1.5, 20)).toBe(0);
  });

  it('46 paid hours at $20 and multiplier 1.5: 6 overtime hours, premium 60', () => {
    // otHours = 46 − 40 = 6; premium = (1.5 − 1) × 20 × 6 = 0.5 × 120 = 60.
    expect(weeklyOvertimePremium(46, 40, 1.5, 20)).toBeCloseTo(60, 10);
    expect(weeklyOvertime(46, 40, 1.5, 20).otHours).toBe(6);
  });

  it('a double-time multiplier of 2 doubles the 46-hour case to 120', () => {
    // otHours = 6; premium = (2 − 1) × 20 × 6 = 120.
    expect(weeklyOvertimePremium(46, 40, 2, 20)).toBeCloseTo(120, 10);
  });

  it('settlement happens on Sundays (dayOfWeek 6) and on the final horizon day', () => {
    // day 6 is a Sunday; day 13 is the next Sunday.
    expect(isOvertimeSettlementDay(6, 30)).toBe(true);
    expect(isOvertimeSettlementDay(13, 30)).toBe(true);
    // day 5 is a Saturday, not a settlement day, in a 30-day horizon.
    expect(isOvertimeSettlementDay(5, 30)).toBe(false);
    // horizon 26 ends on day 25 (a Friday, 25 mod 7 = 4): that partial week is settled on day 25.
    expect(isOvertimeSettlementDay(25, 26)).toBe(true);
    expect(isOvertimeSettlementDay(24, 26)).toBe(false);
  });
});

describe('payroll burden = rate × directLabor', () => {
  it('18% of 5,000 of direct labor is 900', () => {
    // 0.18 × 5,000 = 900.
    expect(payrollBurden(0.18, 5000)).toBeCloseTo(900, 10);
  });

  it('25% of 4,000 is 1,000', () => {
    // 0.25 × 4,000 = 1,000.
    expect(payrollBurden(0.25, 4000)).toBe(1000);
  });

  it('a zero burden rate adds nothing', () => {
    expect(payrollBurden(0, 5000)).toBe(0);
  });
});

describe('payday: (day + 1) mod payPeriodDays == 0', () => {
  it('with a 14-day period, days 13 and 27 are paydays and day 0 is not', () => {
    // (13 + 1) mod 14 = 0; (27 + 1) mod 14 = 0; (0 + 1) mod 14 = 1.
    expect(isPayday(13, 14)).toBe(true);
    expect(isPayday(27, 14)).toBe(true);
    expect(isPayday(0, 14)).toBe(false);
    expect(isPayday(12, 14)).toBe(false);
  });

  it('a one-day period pays every day; a zero period never pays', () => {
    // (0 + 1) mod 1 = 0, so every day is a payday.
    expect(isPayday(0, 1)).toBe(true);
    expect(isPayday(5, 1)).toBe(true);
    expect(isPayday(13, 0)).toBe(false);
  });
});

describe('collection delay = round(mean × (1 − jitter + 2 × jitter × u)), never negative', () => {
  it('with jitter 0 every draw collects on the mean delay', () => {
    // 20 × (1 − 0 + 0) = 20 for any u.
    expect(collectionDelay(20, 0, 0)).toBe(20);
    expect(collectionDelay(20, 0, 0.5)).toBe(20);
    expect(collectionDelay(20, 0, 0.999999)).toBe(20);
  });

  it('a zero mean collects the same day', () => {
    // 0 × anything = 0.
    expect(collectionDelay(0, 0.5, 0.5)).toBe(0);
  });

  it('with jitter 0.5 and mean 20, the lower extreme (u → 0) is 10 days', () => {
    // 20 × (1 − 0.5 + 0) = 20 × 0.5 = 10.
    expect(collectionDelay(20, 0.5, 0)).toBe(10);
  });

  it('with jitter 0.5 and mean 20, the upper extreme (u → 1) is 30 days', () => {
    // u = 0.999999: 20 × (1 − 0.5 + 2 × 0.5 × 0.999999) = 20 × 1.499999 = 29.99998 → round → 30.
    expect(collectionDelay(20, 0.5, 0.999999)).toBe(30);
  });

  it('the midpoint draw u = 0.5 collects on the mean', () => {
    // 20 × (0.5 + 0.5) = 20.
    expect(collectionDelay(20, 0.5, 0.5)).toBe(20);
  });

  it('a quarter jitter on 12 days spans 9 to 15 days', () => {
    // u = 0: 12 × 0.75 = 9; u → 1: 12 × 1.25 = 15.
    expect(collectionDelay(12, 0.25, 0)).toBe(9);
    expect(collectionDelay(12, 0.25, 0.999999)).toBe(15);
  });
});

describe('bad debt: an invoice is uncollectible when u < badDebtRate', () => {
  it('with a 2% rate, a draw of 0.019 writes the invoice off', () => {
    // 0.019 < 0.02.
    expect(isBadDebt(0.02, 0.019)).toBe(true);
  });

  it('a draw equal to the rate does not write off (strict inequality)', () => {
    // 0.02 < 0.02 is false.
    expect(isBadDebt(0.02, 0.02)).toBe(false);
  });

  it('a draw of 0.5 never writes off at a 2% rate, and a zero rate never does', () => {
    expect(isBadDebt(0.02, 0.5)).toBe(false);
    expect(isBadDebt(0, 0)).toBe(false);
  });
});
