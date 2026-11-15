/**
 * financial-model.md §5–§6 — opening book value, straight-line depreciation,
 * acquisition flows, and the breakdown hazard that drives repair costs.
 * Expected values are hand-computed in comments.
 */
import { describe, expect, it } from 'vitest';
import {
  acquisitionFlows,
  breakdownProbability,
  dailyDepreciation,
  depreciationForDay,
  openingBookValue,
} from '../../src/simulation';

// Reference truck: price 30,000, salvage 3,000, useful life 6 years.
// Depreciable amount = 30,000 − 3,000 = 27,000.

describe('openingBookValue: max(salvage, price − (price − salvage) × min(1, age / life))', () => {
  it('a new asset (age 0) is worth its price', () => {
    // frac = 0 / 6 = 0; 30,000 − 27,000 × 0 = 30,000.
    expect(openingBookValue(30000, 3000, 6, 0)).toBe(30000);
  });

  it('mid-life (age 3 of 6 years) is worth 16,500', () => {
    // frac = 3 / 6 = 0.5; 30,000 − 27,000 × 0.5 = 30,000 − 13,500 = 16,500.
    expect(openingBookValue(30000, 3000, 6, 3)).toBe(16500);
  });

  it('a quarter of the way through life (age 1.5) is worth 23,250', () => {
    // frac = 1.5 / 6 = 0.25; 30,000 − 27,000 × 0.25 = 30,000 − 6,750 = 23,250.
    expect(openingBookValue(30000, 3000, 6, 1.5)).toBe(23250);
  });

  it('at or beyond the useful life the book value is the salvage value', () => {
    // age 6: frac = 1, 30,000 − 27,000 = 3,000.
    expect(openingBookValue(30000, 3000, 6, 6)).toBe(3000);
    // age 8: frac = min(1, 1.333…) = 1, so still 3,000 and never below salvage.
    expect(openingBookValue(30000, 3000, 6, 8)).toBe(3000);
  });
});

describe('dailyDepreciation: (price − salvage) / (life × 365)', () => {
  it('6-year life: 27,000 / 2,190 = 12.3288 a day', () => {
    // 6 × 365 = 2,190 days; 27,000 / 2,190 ≈ 12.328767.
    expect(dailyDepreciation(30000, 3000, 6)).toBeCloseTo(12.328767, 5);
  });

  it('10-year life: 27,000 / 3,650 = 7.3973 a day', () => {
    // 10 × 365 = 3,650; 27,000 / 3,650 ≈ 7.397260.
    expect(dailyDepreciation(30000, 3000, 10)).toBeCloseTo(7.39726, 5);
  });

  it('is zero when the life is not positive or the asset is not above salvage', () => {
    expect(dailyDepreciation(30000, 3000, 0)).toBe(0);
    expect(dailyDepreciation(3000, 3000, 6)).toBe(0);
  });
});

describe('depreciationForDay: truncated so book value lands exactly on salvage', () => {
  it('books the full daily amount while there is room above salvage', () => {
    // min(12.328767, 30,000 − 3,000) = 12.328767.
    expect(depreciationForDay(30000, 3000, 12.328767)).toBeCloseTo(12.328767, 6);
  });

  it('books only the remaining headroom on the last day', () => {
    // book 3,000.5 is 0.5 above salvage; min(12.33, 0.5) = 0.5.
    expect(depreciationForDay(3000.5, 3000, 12.328767)).toBeCloseTo(0.5, 9);
  });

  it('books nothing at salvage', () => {
    expect(depreciationForDay(3000, 3000, 12.328767)).toBe(0);
  });

  it('over a run longer than the life, total depreciation is 27,000 and book ends at 3,000', () => {
    // 27,000 / 12.328767 = 2,190 full days; after that the book value is at salvage and nothing more is booked.
    const salvage = 3000;
    const daily = dailyDepreciation(30000, salvage, 6);
    let book = 30000;
    let total = 0;
    for (let day = 0; day < 2300; day++) {
      const dep = depreciationForDay(book, salvage, daily);
      book -= dep;
      total += dep;
    }
    expect(total).toBeCloseTo(27000, 6);
    expect(book).toBeCloseTo(3000, 6);
  });
});

describe('acquisitionFlows (financial-model §6)', () => {
  it('cash purchase: capex and fixed assets both equal the price', () => {
    expect(acquisitionFlows('cash', 30000, 0.2, 450)).toEqual({
      capex: 30000,
      assetAddition: 30000,
      newBorrowing: 0,
      leaseDaily: 0,
    });
  });

  it('loan with 20% down: capex 6,000; borrowing 24,000; fixed assets 30,000', () => {
    // capex = 30,000 × 0.2 = 6,000; newBorrowing = 30,000 − 6,000 = 24,000.
    expect(acquisitionFlows('loan', 30000, 0.2, 450)).toEqual({
      capex: 6000,
      assetAddition: 30000,
      newBorrowing: 24000,
      leaseDaily: 0,
    });
  });

  it('loan with no down payment borrows the whole price', () => {
    // capex = 0; newBorrowing = 30,000.
    const f = acquisitionFlows('loan', 30000, 0, 450);
    expect(f.capex).toBe(0);
    expect(f.newBorrowing).toBe(30000);
    expect(f.assetAddition).toBe(30000);
  });

  it('lease: no capex, no fixed asset, daily cost 450 × 12 / 365 = 14.7945', () => {
    // 450 × 12 = 5,400; 5,400 / 365 ≈ 14.794521.
    const f = acquisitionFlows('lease', 30000, 0.2, 450);
    expect(f.capex).toBe(0);
    expect(f.assetAddition).toBe(0);
    expect(f.newBorrowing).toBe(0);
    expect(f.leaseDaily).toBeCloseTo(14.794521, 5);
  });
});

describe('breakdownProbability: min(1, dailyProb × (1 + ageFactor × age)), never negative', () => {
  it('a new asset breaks down at the base daily probability', () => {
    // 0.004 × (1 + 0.25 × 0) = 0.004.
    expect(breakdownProbability(0.004, 0.25, 0)).toBe(0.004);
  });

  it('a 4-year-old asset with ageFactor 0.25 doubles the base probability', () => {
    // 0.004 × (1 + 0.25 × 4) = 0.004 × 2 = 0.008.
    expect(breakdownProbability(0.004, 0.25, 4)).toBeCloseTo(0.008, 12);
  });

  it('is capped at 1', () => {
    // 0.6 × (1 + 1 × 1) = 1.2 → 1.
    expect(breakdownProbability(0.6, 1, 1)).toBe(1);
  });
});
