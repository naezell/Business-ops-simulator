/**
 * simulation-engine.md §5 — price index, leads, conversion, churn, one-off arrivals,
 * service-failure decay and price shocks. Expected values are hand-computed in comments.
 */
import { describe, expect, it } from 'vitest';
import {
  clamp,
  churnHazard,
  conversionProbability,
  dailyHazardFromMonthly,
  failureDecayFactor,
  leadRatePerDay,
  monthlyChurnRate,
  oneOffDailyProbability,
  oneOffPriceFactor,
  priceIndex,
  priceIndexFrom,
  priceMultiplier,
  priceShockProbability,
} from '../../src/simulation';
import type { JobTypeDef } from '../../src/simulation';

/** A job type with every required field set; only id, kind and offered matter to the price index. */
function jobType(id: string, kind: 'recurring' | 'one-off', offered = true): JobTypeDef {
  return {
    id,
    name: id,
    kind,
    standardLaborHours: 1,
    basePrice: 50,
    materialCost: 0,
    equipmentFuelGalPerHour: 0,
    requiredEquipmentTypes: [],
    minSkill: 1,
    minCrewSize: 1,
    weatherSensitive: false,
    splittable: false,
    seasonality: Array.from({ length: 12 }, () => 1),
    intervalDays: kind === 'recurring' ? 7 : undefined,
    annualRatePerCustomer: kind === 'one-off' ? 1 : undefined,
    lateAfterDays: 7,
    cancelAfterDays: 14,
    offered,
  };
}

describe('priceMultiplier = globalMultiplier × (byJobType[j] ?? 1)', () => {
  it('a per-type multiplier stacks on the global one', () => {
    // 1.05 × 0.95 = 0.9975.
    expect(priceMultiplier({ globalMultiplier: 1.05, byJobType: { maint: 0.95 } }, 'maint')).toBeCloseTo(0.9975, 10);
  });

  it('a type without its own multiplier uses the global one only', () => {
    // 1.05 × 1 = 1.05.
    expect(priceMultiplier({ globalMultiplier: 1.05, byJobType: { maint: 0.95 } }, 'mow')).toBeCloseTo(1.05, 10);
    // 0.9 × 1 = 0.9 with no per-type entries at all.
    expect(priceMultiplier({ globalMultiplier: 0.9, byJobType: {} }, 'x')).toBeCloseTo(0.9, 10);
  });
});

describe('priceIndexFrom: customer-weighted mean, plain mean when no weights, 1 when empty', () => {
  it('weights 2 and 1 on multipliers 1.0 and 1.2 give 3.2 / 3 = 1.0667', () => {
    // (2 × 1.0 + 1 × 1.2) / (2 + 1) = 3.2 / 3 ≈ 1.066667.
    expect(priceIndexFrom([{ multiplier: 1.0, weight: 2 }, { multiplier: 1.2, weight: 1 }])).toBeCloseTo(1.066667, 6);
  });

  it('with no customers on any plan it is the plain mean (1.0 + 1.2) / 2 = 1.1', () => {
    expect(priceIndexFrom([{ multiplier: 1.0, weight: 0 }, { multiplier: 1.2, weight: 0 }])).toBeCloseTo(1.1, 10);
  });

  it('with no offered job types it is 1', () => {
    expect(priceIndexFrom([])).toBe(1);
  });
});

describe('priceIndex: over offered recurring types, weighted by active customers per plan', () => {
  const types = [
    jobType('mow', 'recurring'),
    jobType('maint', 'recurring'),
    jobType('cleanup', 'one-off'), // one-off: excluded
    jobType('mulch', 'recurring', false), // not offered: excluded
  ];

  it('30 customers at 1.00 and 10 at 1.20 give (30 × 1 + 10 × 1.2) / 40 = 1.05', () => {
    // maint multiplier = 1 × 1.2; weights mow 30, maint 10; (30 + 12) / 40 = 1.05.
    expect(priceIndex(types, { globalMultiplier: 1, byJobType: { maint: 1.2 } }, { mow: 30, maint: 10 })).toBeCloseTo(1.05, 10);
  });

  it('with no customers yet it falls back to the plain mean of the two offered recurring types: 1.1', () => {
    expect(priceIndex(types, { globalMultiplier: 1, byJobType: { maint: 1.2 } }, {})).toBeCloseTo(1.1, 10);
  });

  it('with only one-off types offered the index is 1', () => {
    expect(priceIndex([jobType('cleanup', 'one-off')], { globalMultiplier: 1.3, byJobType: {} }, {})).toBe(1);
  });

  it('a global multiplier of 1.1 with one customer gives 1.1', () => {
    expect(priceIndex([jobType('mow', 'recurring')], { globalMultiplier: 1.1, byJobType: {} }, { mow: 1 })).toBeCloseTo(1.1, 10);
  });
});

describe('leadRatePerDay = (organic + max × (1 − e^(−spend/scale))) × seasonality / 30', () => {
  it('6 organic and 10 paid max, spend 800 at scale 1,000: (6 + 10 × 0.550671) / 30 = 0.383557', () => {
    // e^(−0.8) ≈ 0.449329; 1 − 0.449329 = 0.550671; 10 × 0.550671 = 5.50671; (6 + 5.50671) / 30 = 0.383557.
    expect(leadRatePerDay(6, 10, 800, 1000, 1)).toBeCloseTo(0.383557, 6);
  });

  it('with no marketing spend the rate is organic leads only: 6 / 30 = 0.2', () => {
    // marketing term = 10 × (1 − e^0) = 0.
    expect(leadRatePerDay(6, 10, 0, 1000, 1)).toBeCloseTo(0.2, 12);
  });

  it('spendScale 0 turns the marketing term off whatever the spend: 6 / 30 = 0.2', () => {
    expect(leadRatePerDay(6, 10, 5000, 0, 1)).toBeCloseTo(0.2, 12);
  });

  it('seasonality 1.5 scales the total: 6 × 1.5 / 30 = 0.3', () => {
    expect(leadRatePerDay(6, 10, 0, 1000, 1.5)).toBeCloseTo(0.3, 12);
  });
});

describe('conversionProbability = clamp(base × priceIndex^(−elasticity), 0, 1)', () => {
  it('at price index 1 the base rate applies: 0.35', () => {
    expect(conversionProbability(0.35, 1, 1.2)).toBeCloseTo(0.35, 12);
  });

  it('doubling the price index with elasticity 1 halves conversion: 0.35 / 2 = 0.175', () => {
    expect(conversionProbability(0.35, 2, 1)).toBeCloseTo(0.175, 12);
  });

  it('a 5% higher price with elasticity 1.2: 0.35 × 1.05^(−1.2) = 0.330096', () => {
    // ln 1.05 ≈ 0.048790; 1.05^(−1.2) = e^(−1.2 × 0.048790) = e^(−0.058548) ≈ 0.943133;
    // 0.35 × 0.943133 ≈ 0.330096.
    expect(conversionProbability(0.35, 1.05, 1.2)).toBeCloseTo(0.330096, 5);
  });

  it('a base rate above 1 is clamped to 1', () => {
    // 0.9 × 0.5^(−1) = 1.8 → 1.
    expect(conversionProbability(0.9, 0.5, 1)).toBe(1);
  });
});

describe('monthlyChurnRate = clamp(base × priceIndex^e × (1 + weight × failureScore), 0, 0.5)', () => {
  it('no failures and price index 1: the base rate 0.03', () => {
    expect(monthlyChurnRate(0.03, 1, 1.5, 0.8, 0)).toBeCloseTo(0.03, 12);
  });

  it('one unit of failure score with weight 0.8: 0.03 × 1.8 = 0.054', () => {
    expect(monthlyChurnRate(0.03, 1, 1.5, 0.8, 1)).toBeCloseTo(0.054, 12);
  });

  it('a large product is clamped to 0.5: 0.4 × (1 + 1 × 1) = 0.8 → 0.5', () => {
    expect(monthlyChurnRate(0.4, 1, 0, 1, 1)).toBe(0.5);
  });
});

describe('dailyHazardFromMonthly = 1 − (1 − c)^(1/30)', () => {
  it('a 10% monthly probability is a daily hazard of 0.0035059, and 30 days compound back to 10%', () => {
    // 0.9^(1/30) = e^(ln 0.9 / 30) = e^(−0.0035120) ≈ 0.9964941; h = 1 − 0.9964941 = 0.0035059.
    const h = dailyHazardFromMonthly(0.1);
    expect(h).toBeCloseTo(0.0035059, 7);
    // Surviving 30 days at hazard h leaves (1 − h)^30 = 0.9, i.e. a 10% monthly loss.
    expect(Math.pow(1 - h, 30)).toBeCloseTo(0.9, 9);
  });

  it('a 3% monthly probability is a daily hazard of 0.0010148', () => {
    expect(dailyHazardFromMonthly(0.03)).toBeCloseTo(0.00101479, 7);
  });

  it('zero monthly probability gives zero daily hazard', () => {
    expect(dailyHazardFromMonthly(0)).toBe(0);
  });
});

describe('churnHazard = dailyHazardFromMonthly(monthlyChurnRate(...))', () => {
  it('base 3% with no failures gives the daily hazard of 3%', () => {
    expect(churnHazard(0.03, 1, 1.5, 0.8, 0)).toBeCloseTo(0.00101479, 7);
  });

  it('a monthly rate clamped at 0.5 gives the daily hazard of 0.5, not of 0.8', () => {
    // clamp(0.8, 0, 0.5) = 0.5; h = 1 − 0.5^(1/30) = 1 − e^(−0.023105) ≈ 0.022840.
    // Without the clamp it would be 1 − 0.2^(1/30) ≈ 0.052233.
    expect(churnHazard(0.4, 1, 0, 1, 1)).toBeCloseTo(0.02284, 6);
  });
});

describe('failureDecayFactor = 0.5^(1/halfLife) per day', () => {
  it('after one half-life (30 days) the failure score has halved', () => {
    // f = 0.5^(1/30) ≈ 0.977160; f^30 = 0.5.
    expect(Math.pow(failureDecayFactor(30), 30)).toBeCloseTo(0.5, 12);
  });

  it('a one-day half-life decays by half each day', () => {
    expect(failureDecayFactor(1)).toBeCloseTo(0.5, 12);
  });

  it('a non-positive half-life means no memory (factor 0)', () => {
    expect(failureDecayFactor(0)).toBe(0);
    expect(failureDecayFactor(-3)).toBe(0);
  });
});

describe('priceShockProbability = min(0.9, perPct × 100 × δ) for δ > 0, else 0', () => {
  it('a 5% price rise with 0.4% churn per point gives 0.004 × 5 = 0.02', () => {
    // 100 × 0.05 = 5 percentage points; 0.004 × 5 = 0.02.
    expect(priceShockProbability(0.004, 0.05)).toBeCloseTo(0.02, 12);
  });

  it('a price cut (δ < 0) and no change (δ = 0) cause no shock', () => {
    expect(priceShockProbability(0.004, -0.05)).toBe(0);
    expect(priceShockProbability(0.004, 0)).toBe(0);
  });

  it('a very large rise is capped at 0.9: min(0.9, 0.5 × 10) = 0.9', () => {
    expect(priceShockProbability(0.5, 0.1)).toBe(0.9);
  });
});

describe('oneOffDailyProbability = annualRate × seasonality / 365', () => {
  it('1.5 jobs a year at seasonality 2 is 3 / 365 = 0.0082192 a day', () => {
    expect(oneOffDailyProbability(1.5, 2)).toBeCloseTo(3 / 365, 12);
  });

  it('zero seasonality means no one-off arrivals', () => {
    expect(oneOffDailyProbability(1.5, 0)).toBe(0);
  });

  it('0.15 a year at seasonality 1: 0.15 / 365 = 0.00041096', () => {
    expect(oneOffDailyProbability(0.15, 1)).toBeCloseTo(0.00041096, 8);
  });
});

describe('one-off price response (§5.2, ADR-008): × P^(−oneOffPriceElasticity)', () => {
  it('rate 0.6, seasonality 1.5, P = 1.2, elasticity 1.5: hand-computed', () => {
    // base = 0.6 × 1.5 / 365 = 0.9 / 365 = 0.0024657534246575
    // 1.2^1.5 = 1.2 × √1.2 = 1.2 × 1.0954451150103321 = 1.3145341380123985
    // factor = 1 / 1.3145341380123985 = 0.7607257743127307
    // p = 0.0024657534246575 × 0.7607257743127307 = 0.0018757621...
    const base = 0.9 / 365;
    const factor = 1 / (1.2 * Math.sqrt(1.2));
    expect(oneOffPriceFactor(1.2, 1.5)).toBeCloseTo(0.76072577431, 10);
    expect(oneOffDailyProbability(0.6, 1.5, 1.2, 1.5)).toBeCloseTo(base * factor, 14);
    expect(oneOffDailyProbability(0.6, 1.5, 1.2, 1.5)).toBeCloseTo(0.00187576, 8);
  });

  it('a price cut raises arrivals: P = 0.8, elasticity 2 ⇒ factor 1 / 0.64 = 1.5625', () => {
    expect(oneOffPriceFactor(0.8, 2)).toBeCloseTo(1.5625, 12);
    // 0.365 × 1 / 365 = 0.001; × 1.5625 = 0.0015625
    expect(oneOffDailyProbability(0.365, 1, 0.8, 2)).toBeCloseTo(0.0015625, 12);
  });

  it('missing or zero elasticity, or P = 1, leaves the probability exactly unchanged', () => {
    const base = oneOffDailyProbability(0.6, 1.5);
    expect(base).toBe((0.6 * 1.5) / 365);
    expect(oneOffDailyProbability(0.6, 1.5, 1.3)).toBe(base);
    expect(oneOffDailyProbability(0.6, 1.5, 1.3, 0)).toBe(base);
    expect(oneOffDailyProbability(0.6, 1.5, 1, 1.5)).toBe(base);
    expect(oneOffPriceFactor(1.3, undefined)).toBe(1);
  });

  it('P ≤ 0 means factor 1 (no response)', () => {
    expect(oneOffPriceFactor(0, 1.5)).toBe(1);
    expect(oneOffPriceFactor(-0.5, 1.5)).toBe(1);
  });
});

describe('clamp(x, lo, hi)', () => {
  it('returns the bound when x is outside the range and x when inside', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });
});
