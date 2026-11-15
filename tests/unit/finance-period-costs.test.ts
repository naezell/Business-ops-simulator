/**
 * financial-model.md §3–§4 — daily accrual of period costs (overhead, marketing, leases)
 * and fuel cost. Expected values are hand-computed.
 */
import { describe, expect, it } from 'vitest';
import { dailyFromMonthly, fuelCost } from '../../src/simulation';

describe('dailyFromMonthly: monthly × 12 / 365 (overhead, marketing, leases)', () => {
  it('overhead of 1,500 a month accrues 18,000 / 365 = 49.3151 a day', () => {
    // 1,500 × 12 = 18,000; 18,000 / 365 ≈ 49.315068.
    expect(dailyFromMonthly(1500)).toBeCloseTo(49.315068, 5);
  });

  it('marketing of 800 a month accrues 9,600 / 365 = 26.3014 a day', () => {
    // 800 × 12 = 9,600; 9,600 / 365 ≈ 26.301370.
    expect(dailyFromMonthly(800)).toBeCloseTo(26.30137, 5);
  });

  it('a lease of 450 a month accrues 5,400 / 365 = 14.7945 a day', () => {
    // 450 × 12 = 5,400; 5,400 / 365 ≈ 14.794521.
    expect(dailyFromMonthly(450)).toBeCloseTo(14.794521, 5);
  });

  it('a zero monthly amount accrues nothing', () => {
    expect(dailyFromMonthly(0)).toBe(0);
  });

  it('365 consecutive daily accruals add up to exactly 12 months', () => {
    // 365 × (1,500 × 12 / 365) = 1,500 × 12 = 18,000.
    let total = 0;
    for (let day = 0; day < 365; day++) total += dailyFromMonthly(1500);
    expect(total).toBeCloseTo(18000, 6);
  });
});

describe('fuelCost = (vehicleMiles / mpg + equipmentGallons) × fuelPrice', () => {
  it('100 miles at 20 mpg plus 3 equipment gallons at $3.60 is 28.80', () => {
    // vehicle gallons = 100 / 20 = 5; total = 5 + 3 = 8; cost = 8 × 3.6 = 28.80.
    expect(fuelCost(100, 20, 3, 3.6)).toBeCloseTo(28.8, 10);
  });

  it('with mpg 0 the vehicle burns nothing (guard), only equipment gallons count', () => {
    // vehicle gallons = 0; total = 0 + 3 = 3; cost = 3 × 3.6 = 10.80.
    expect(fuelCost(100, 0, 3, 3.6)).toBeCloseTo(10.8, 10);
  });

  it('200 miles at 25 mpg plus 1.5 equipment gallons at $3.50 is 33.25', () => {
    // vehicle gallons = 200 / 25 = 8; total = 8 + 1.5 = 9.5; cost = 9.5 × 3.5 = 33.25.
    expect(fuelCost(200, 25, 1.5, 3.5)).toBeCloseTo(33.25, 10);
  });

  it('no driving and no equipment burns no fuel', () => {
    expect(fuelCost(0, 20, 0, 3.6)).toBe(0);
  });
});
