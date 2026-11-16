/**
 * simulation-engine.md §6–§8 and §7.1 — ramp, coordination loss, crew rate, quit hazard,
 * road distance, travel time and the clock fit of an order. Expected values are hand-computed.
 */
import { describe, expect, it } from 'vitest';
import {
  coordinationFactor,
  crewRate,
  dailyHazardFromAnnual,
  fitOrder,
  rampFactor,
  roadMiles,
  travelTime,
} from '../../src/simulation';

describe('rampFactor = min(1, start + (1 − start) × tenure / rampDays); 1 when rampDays ≤ 0', () => {
  it('a new hire starts at the starting productivity 0.6', () => {
    // 0.6 + 0.4 × 0 / 30 = 0.6.
    expect(rampFactor(0, 30, 0.6)).toBeCloseTo(0.6, 12);
  });

  it('halfway through a 30-day ramp (15 days) the factor is 0.8', () => {
    // 0.6 + 0.4 × 15 / 30 = 0.6 + 0.2 = 0.8.
    expect(rampFactor(15, 30, 0.6)).toBeCloseTo(0.8, 12);
  });

  it('at 30 days and beyond the factor is 1', () => {
    // 0.6 + 0.4 × 30 / 30 = 1.0; at 100 days 0.6 + 1.333 → capped at 1.
    expect(rampFactor(30, 30, 0.6)).toBeCloseTo(1, 12);
    expect(rampFactor(100, 30, 0.6)).toBe(1);
  });

  it('with no ramp period (rampDays 0) every employee is fully productive', () => {
    expect(rampFactor(5, 0, 0.6)).toBe(1);
  });
});

describe('coordinationFactor = max(0.5, 1 − loss × (n − 1))', () => {
  it('a crew of one has no coordination loss', () => {
    expect(coordinationFactor(1, 0.05)).toBe(1);
  });

  it('three people at 5% loss each: 1 − 0.05 × 2 = 0.9', () => {
    expect(coordinationFactor(3, 0.05)).toBeCloseTo(0.9, 12);
  });

  it('five people at 10% loss: 1 − 0.1 × 4 = 0.6', () => {
    expect(coordinationFactor(5, 0.1)).toBeCloseTo(0.6, 12);
  });

  it('twelve people at 5% loss: 1 − 0.05 × 11 = 0.45, floored at 0.5', () => {
    expect(coordinationFactor(12, 0.05)).toBe(0.5);
  });
});

describe('crewRate = Σ productivity × ramp × coordinationFactor (person-hours per clock hour)', () => {
  it('a veteran (1.0, tenure 1,000) and a 20-day hire (0.9): 1.78 × 0.95 = 1.691', () => {
    // veteran: 1.0 × 1 = 1.0 (ramp 1 after 1,000 days).
    // hire: ramp = 0.6 + 0.4 × 20 / 30 = 0.866667; 0.9 × 0.866667 = 0.78.
    // sum = 1.0 + 0.78 = 1.78; coordination for n = 2 at 5%: 1 − 0.05 = 0.95; rate = 1.78 × 0.95 = 1.691.
    const members = [
      { productivity: 1, tenureDays: 1000 },
      { productivity: 0.9, tenureDays: 20 },
    ];
    expect(crewRate(members, 30, 0.6, 0.05)).toBeCloseTo(1.691, 10);
  });

  it('with no ramp and no coordination loss the rate is the sum of productivities: 1.0 + 1.05 = 2.05', () => {
    const members = [
      { productivity: 1, tenureDays: 0 },
      { productivity: 1.05, tenureDays: 0 },
    ];
    expect(crewRate(members, 0, 1, 0)).toBeCloseTo(2.05, 12);
  });

  it('a single hire in ramp (start 0.5, 10-day ramp, day 0) works at half rate', () => {
    // ramp = 0.5 + 0.5 × 0 / 10 = 0.5; productivity 1 → 0.5; n = 1 → no loss.
    expect(crewRate([{ productivity: 1, tenureDays: 0 }], 10, 0.5, 0.2)).toBeCloseTo(0.5, 12);
  });

  it('twelve members at productivity 1 with 5% loss hit the 0.5 floor: 12 × 0.5 = 6', () => {
    // coordination = max(0.5, 0.45) = 0.5; sum = 12; rate = 12 × 0.5 = 6.
    const members = Array.from({ length: 12 }, () => ({ productivity: 1, tenureDays: 0 }));
    expect(crewRate(members, 0, 1, 0.05)).toBeCloseTo(6, 12);
  });
});

describe('dailyHazardFromAnnual = 1 − (1 − a)^(1/365)', () => {
  it('a 60% annual turnover is a daily quit hazard of 0.0025072, and 365 days compound back to 60%', () => {
    // 0.4^(1/365) = e^(ln 0.4 / 365) = e^(−0.0025104) ≈ 0.9974928; h = 0.0025072.
    const h = dailyHazardFromAnnual(0.6);
    expect(h).toBeCloseTo(0.0025072, 7);
    // Surviving 365 days at h leaves (1 − h)^365 = 0.4, i.e. 60% annual turnover.
    expect(Math.pow(1 - h, 365)).toBeCloseTo(0.4, 9);
  });

  it('zero turnover gives zero hazard', () => {
    expect(dailyHazardFromAnnual(0)).toBe(0);
  });

  it('a 100% annual rate (and anything above it) gives a daily hazard of 1', () => {
    expect(dailyHazardFromAnnual(1)).toBe(1);
    expect(dailyHazardFromAnnual(1.5)).toBe(1);
  });
});

describe('roadMiles = sqrt(dx² + dy²) × roadFactor', () => {
  it('a 3-4-5 triangle with road factor 1 is 5 miles', () => {
    expect(roadMiles(0, 0, 3, 4, 1)).toBeCloseTo(5, 12);
  });

  it('the same leg with road factor 1.3 is 5 × 1.3 = 6.5 miles', () => {
    expect(roadMiles(0, 0, 3, 4, 1.3)).toBeCloseTo(6.5, 12);
  });

  it('the distance from a point to itself is 0', () => {
    expect(roadMiles(1, 1, 1, 1, 2)).toBe(0);
  });
});

describe('travelTime = roadMiles / avgSpeedMph', () => {
  it('6.5 road miles at 25 mph is 0.26 hours', () => {
    // 5 × 1.3 = 6.5 miles; 6.5 / 25 = 0.26 h.
    expect(travelTime(0, 0, 3, 4, 1.3, 25)).toBeCloseTo(0.26, 12);
  });

  it('5 road miles at 5 mph is 1 hour', () => {
    expect(travelTime(0, 0, 3, 4, 1, 5)).toBeCloseTo(1, 12);
  });

  it('no distance means no travel time', () => {
    expect(travelTime(0, 0, 0, 0, 1.3, 25)).toBe(0);
  });
});

describe('fitOrder: fully fits iff clock + tIn + D + tBack ≤ limit; otherwise split if allowed', () => {
  // Limit 8 clock hours, travel in 0.5 h and back 0.5 h, rate 1 unless stated.

  it('a 6-hour job fits fully: 0 + 0.5 + 6 + 0.5 = 7 ≤ 8', () => {
    expect(fitOrder(0, 8, 0.5, 0.5, 6, 1, false)).toEqual({ kind: 'full', tIn: 0.5, tBack: 0.5, hours: 6 });
  });

  it('a job ending exactly at the limit still fits: 0 + 0.5 + 7 + 0.5 = 8 ≤ 8', () => {
    expect(fitOrder(0, 8, 0.5, 0.5, 7, 1, false)).toEqual({ kind: 'full', tIn: 0.5, tBack: 0.5, hours: 7 });
  });

  it('a non-splittable 7.5-hour job does not fit: 0 + 0.5 + 7.5 + 0.5 = 8.5 > 8', () => {
    expect(fitOrder(0, 8, 0.5, 0.5, 7.5, 1, false)).toEqual({ kind: 'none' });
  });

  it('a splittable 7.5-hour job is split: A = 8 − 0 − 0.5 − 0.5 = 7 hours of work today', () => {
    expect(fitOrder(0, 8, 0.5, 0.5, 7.5, 1, true)).toEqual({ kind: 'split', tIn: 0.5, tBack: 0.5, hours: 7 });
  });

  it('a split leaving less than the 0.5-hour minimum is refused: A = 8 − 6.6 − 1 = 0.4 < 0.5', () => {
    expect(fitOrder(6.6, 8, 0.5, 0.5, 3, 1, true)).toEqual({ kind: 'none' });
  });

  it('the rate sets the hours: 12 remaining labor at rate 2 is 6 clock hours, plus 1 of travel = 7 ≤ 8', () => {
    expect(fitOrder(0, 8, 0.5, 0.5, 12, 2, false)).toEqual({ kind: 'full', tIn: 0.5, tBack: 0.5, hours: 6 });
  });

  it('a crew with zero rate cannot work the order', () => {
    expect(fitOrder(0, 8, 0.5, 0.5, 1, 0, true)).toEqual({ kind: 'none' });
  });
});
