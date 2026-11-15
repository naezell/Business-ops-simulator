/**
 * H12 part 2: hand-calculated unit tests for every export of src/simulation/dynamics.ts
 * (simulation-design §3–§5). Expected values are computed by hand in the comments or with an
 * independent formula written in the test. Nothing here calls the function under test to produce
 * an expectation. Exponentials appear only as Math.exp(…) written out from the spec.
 */
import { describe, expect, it } from 'vitest';
import {
  absenceProbability,
  agedMaintenanceRate,
  fatigueIndex,
  fatigueWindowDays,
  learningFactor,
  marketWage,
  newCustomerChurnFactor,
  productivityFatigueFactor,
  quitHazard,
  referralLeadRate,
  saturationFactor,
  serviceIndex,
  trailingWeeklyHours,
  workforceDynamicsOn,
} from '../../src/simulation/dynamics';
import type { WorkforceParams } from '../../src/simulation';

/** A complete WorkforceParams with every mechanism off; `over` switches mechanisms on. */
function wfParams(over: Partial<WorkforceParams> = {}): WorkforceParams {
  return {
    payrollBurdenRate: 0,
    overtimeMultiplier: 1.5,
    overtimeWeeklyThresholdHours: 40,
    absenceRate: 0,
    annualTurnoverRate: 0,
    timeToFillDays: 14,
    hiringCostPerHire: 0,
    rampDays: 0,
    rampStartProductivity: 1,
    crewSizeCoordinationLoss: 0,
    payPeriodDays: 14,
    ...over,
  };
}

describe('learningFactor (§3: learn = 1 + G (1 − e^(−τ/L)))', () => {
  it('is 1 when G is 0 or missing, whatever the tenure', () => {
    expect(learningFactor(100, 0, 120)).toBe(1);
    expect(learningFactor(100, undefined, 120)).toBe(1);
    expect(learningFactor(5000, undefined, undefined)).toBe(1);
  });

  it('is 1 when L ≤ 0 or missing (G = 0.15 is set but has no time scale)', () => {
    expect(learningFactor(100, 0.15, 0)).toBe(1);
    expect(learningFactor(100, 0.15, -5)).toBe(1);
    expect(learningFactor(100, 0.15, undefined)).toBe(1);
  });

  it('at τ = L: 1 + G (1 − e^−1) with G = 0.2, L = 120  ⇒ 1 + 0.2 × 0.6321205588 = 1.1264241117657115', () => {
    expect(learningFactor(120, 0.2, 120)).toBeCloseTo(1.1264241117657115, 12);
    expect(learningFactor(120, 0.2, 120)).toBeCloseTo(1 + 0.2 * (1 - Math.exp(-1)), 12);
  });

  it('at τ = 2L: 1 + 0.5 (1 − e^−2) with G = 0.5, L = 100, τ = 200 ⇒ 1.4323323583816937', () => {
    expect(learningFactor(200, 0.5, 100)).toBeCloseTo(1.4323323583816937, 12);
  });

  it('at τ = 0 the factor is exactly 1 (1 − e^0 = 0)', () => {
    expect(learningFactor(0, 0.15, 120)).toBe(1);
  });

  it('a negative tenure clamps to 0 and so gives exactly 1', () => {
    expect(learningFactor(-50, 0.15, 120)).toBe(1);
    expect(learningFactor(-1, 0.15, 120)).toBe(learningFactor(0, 0.15, 120));
  });

  it('approaches 1 + G for very long tenure: τ = 1000, G = 0.15, L = 120 ⇒ 1.15 − 0.15 e^(−8.33) = 1.15 − 0.0000360 ≈ 1.1499639', () => {
    expect(learningFactor(1000, 0.15, 120)).toBeCloseTo(1 + 0.15 * (1 - Math.exp(-1000 / 120)), 12);
    expect(learningFactor(1000, 0.15, 120)).toBeCloseTo(1.1499639446, 9);
  });
});

describe('trailingWeeklyHours (§3: h̄ = paid hours in last n days × 7 / n; 0 if n < 7)', () => {
  it('n < 7 gives 0, even with many hours logged (n = 6, 120 h ⇒ 0)', () => {
    expect(trailingWeeklyHours(120, 6)).toBe(0);
    expect(trailingWeeklyHours(120, 0)).toBe(0);
  });

  it('n = 7 with 35 h ⇒ 35 × 7 / 7 = 35', () => {
    expect(trailingWeeklyHours(35, 7)).toBe(35);
  });

  it('200 h over n = 28 days ⇒ 200 × 7 / 28 = 50', () => {
    expect(trailingWeeklyHours(200, 28)).toBe(50);
  });

  it('100 h over n = 14 days ⇒ 100 × 7 / 14 = 50', () => {
    expect(trailingWeeklyHours(100, 14)).toBe(50);
  });
});

describe('fatigueWindowDays (§3: n = min(28, day − max(hireDay, 0)))', () => {
  it('day 100, hired day 0 ⇒ min(28, 100) = 28', () => {
    expect(fatigueWindowDays(100, 0)).toBe(28);
  });

  it('day 20, hired day 0 ⇒ min(28, 20) = 20', () => {
    expect(fatigueWindowDays(20, 0)).toBe(20);
  });

  it('day 50, hired day 40 ⇒ min(28, 10) = 10', () => {
    expect(fatigueWindowDays(50, 40)).toBe(10);
  });

  it('a negative hire day counts as day 0: day 20, hire −3 ⇒ 20', () => {
    expect(fatigueWindowDays(20, -3)).toBe(20);
  });

  it('the day of hire itself gives 0: day 40, hire 40 ⇒ 0', () => {
    expect(fatigueWindowDays(40, 40)).toBe(0);
  });
});

describe('fatigueIndex (§3: max(0, (h̄ − θ) / 10); 0 if θ missing)', () => {
  it('θ missing ⇒ 0, even at 80 h', () => {
    expect(fatigueIndex(80, undefined)).toBe(0);
  });

  it('below threshold ⇒ 0: 40 vs 45 ⇒ max(0, −0.5) = 0', () => {
    expect(fatigueIndex(40, 45)).toBe(0);
  });

  it('exactly at threshold ⇒ 0: 45 vs 45', () => {
    expect(fatigueIndex(45, 45)).toBe(0);
  });

  it('50 vs 45 ⇒ (50 − 45) / 10 = 0.5', () => {
    expect(fatigueIndex(50, 45)).toBe(0.5);
  });

  it('60 vs 45 ⇒ (60 − 45) / 10 = 1.5', () => {
    expect(fatigueIndex(60, 45)).toBe(1.5);
  });
});

describe('productivityFatigueFactor (§3: max(0.7, 1 − κ_p × fatigue))', () => {
  it('loss missing ⇒ 1', () => {
    expect(productivityFatigueFactor(0.5, undefined)).toBe(1);
  });

  it('no fatigue ⇒ 1 whatever the loss (1 − 0.2 × 0 = 1)', () => {
    expect(productivityFatigueFactor(0, 0.2)).toBe(1);
  });

  it('fatigue 0.5, κ_p 0.2 ⇒ 1 − 0.1 = 0.9', () => {
    expect(productivityFatigueFactor(0.5, 0.2)).toBeCloseTo(0.9, 12);
  });

  it('fatigue 0.2, κ_p 1 ⇒ 0.8 (above the floor)', () => {
    expect(productivityFatigueFactor(0.2, 1)).toBeCloseTo(0.8, 12);
  });

  it('floor 0.7: fatigue 0.5, κ_p 1 ⇒ max(0.7, 0.5) = 0.7', () => {
    expect(productivityFatigueFactor(0.5, 1)).toBeCloseTo(0.7, 12);
  });

  it('floor 0.7: fatigue 0.5, κ_p 0.6 ⇒ max(0.7, 0.7) = 0.7 (on the boundary)', () => {
    expect(productivityFatigueFactor(0.5, 0.6)).toBeCloseTo(0.7, 12);
  });

  it('floor 0.7: fatigue 3, κ_p 1 ⇒ max(0.7, −2) = 0.7', () => {
    expect(productivityFatigueFactor(3, 1)).toBeCloseTo(0.7, 12);
  });
});

describe('marketWage (reference wage by rounded skill, clamped to the array)', () => {
  const wages = [18, 22, 26, 31];

  it('undefined or empty array ⇒ undefined', () => {
    expect(marketWage(undefined, 2)).toBeUndefined();
    expect(marketWage([], 2)).toBeUndefined();
  });

  it('exact integer skill indexes the array: skill 1 ⇒ 22, skill 3 ⇒ 31', () => {
    expect(marketWage(wages, 1)).toBe(22);
    expect(marketWage(wages, 3)).toBe(31);
  });

  it('rounds to nearest: 2.4 ⇒ 2 ⇒ 26; 1.49 ⇒ 1 ⇒ 22', () => {
    expect(marketWage(wages, 2.4)).toBe(26);
    expect(marketWage(wages, 1.49)).toBe(22);
  });

  it('halves round up (JavaScript Math.round): 1.5 ⇒ 2 ⇒ 26; 2.5 ⇒ 3 ⇒ 31', () => {
    expect(marketWage(wages, 1.5)).toBe(26);
    expect(marketWage(wages, 2.5)).toBe(31);
  });

  it('skill above the top clamps to the last entry: skill 9 ⇒ index 3 ⇒ 31', () => {
    expect(marketWage(wages, 9)).toBe(31);
  });

  it('skill below zero clamps to index 0: skill −0.7 ⇒ round(−0.7) = −1 ⇒ 0 ⇒ 18', () => {
    expect(marketWage(wages, -0.7)).toBe(18);
  });

  it('a single-entry array returns that entry for any skill: [20], skill 3 ⇒ 20', () => {
    expect(marketWage([20], 3)).toBe(20);
  });
});

describe('quitHazard (§3: h₀ (1 + κ_q fatigue) (wage/w*)^(−ε) (1 + b e^(−τ/180)) M, clamped to [0, 1])', () => {
  it('no mechanism on: the hazard is h₀ exactly', () => {
    // every factor is 1: fatigue 0, wage term 1 (ε missing), tenure term 1 (b missing), M = 1.
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 1000, undefined)).toBe(0.01);
  });

  it('fatigue alone: 0.01 × (1 + 2 × 0.5) = 0.02', () => {
    expect(quitHazard(0.01, 0.5, 2, 20, undefined, undefined, 1000, undefined)).toBeCloseTo(0.02, 15);
  });

  it('fatigue weight missing ⇒ fatigue has no effect: 0.01 with fatigue 0.5', () => {
    expect(quitHazard(0.01, 0.5, undefined, 20, undefined, undefined, 1000, undefined)).toBe(0.01);
  });

  it('wage alone: wage 24, w* 20, ε 2 ⇒ 0.01 × (1.2)^(−2) = 0.01 / 1.44 = 0.00694444…', () => {
    expect(quitHazard(0.01, 0, undefined, 24, 20, 2, 1000, undefined)).toBeCloseTo(0.01 / 1.44, 12);
  });

  it('negative ε reverses the wage effect: wage 15, w* 20, ε −1 ⇒ 0.01 × 0.75 = 0.0075', () => {
    expect(quitHazard(0.01, 0, undefined, 15, 20, -1, 1000, undefined)).toBeCloseTo(0.0075, 12);
  });

  it('wage term is 1 when ε = 0 (even with a wage gap): 0.01 with wage 24, w* 20', () => {
    expect(quitHazard(0.01, 0, undefined, 24, 20, 0, 1000, undefined)).toBe(0.01);
  });

  it('wage term is 1 when the reference wage is missing: 0.01 with ε = 2', () => {
    expect(quitHazard(0.01, 0, undefined, 24, undefined, 2, 1000, undefined)).toBe(0.01);
  });

  it('wage term is 1 when the reference wage is 0 (no positive reference): 0.01 with ε = 2', () => {
    expect(quitHazard(0.01, 0, undefined, 24, 0, 2, 1000, undefined)).toBe(0.01);
  });

  it('early-tenure boost at τ = 0: 0.01 × (1 + 3) = 0.04', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 0, 3)).toBeCloseTo(0.04, 15);
  });

  it('early-tenure boost at τ = 180: 0.01 × (1 + 3 e^−1) = 0.0210363832…', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 180, 3)).toBeCloseTo(0.01 * (1 + 3 * Math.exp(-1)), 12);
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 180, 3)).toBeCloseTo(0.0210363832351433, 12);
  });

  it('early-tenure boost at τ = 360: 0.01 × (1 + 3 e^−2) = 0.0140600584…', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 360, 3)).toBeCloseTo(0.01 * (1 + 3 * Math.exp(-2)), 12);
  });

  it('negative tenure clamps to 0 in the boost: τ = −100 gives the same as τ = 0', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, -100, 3)).toBeCloseTo(0.04, 15);
  });

  it('M multiplier scales the hazard: M = 1.5 ⇒ 0.01 × 1.5 = 0.015', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 1000, undefined, 1.5)).toBeCloseTo(0.015, 15);
  });

  it('M defaults to 1 when omitted (same as explicit 1)', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 1000, undefined)).toBe(
      quitHazard(0.01, 0, undefined, 20, undefined, undefined, 1000, undefined, 1),
    );
  });

  it('clamps at 1: h₀ 0.5, fatigue 1, κ_q 2 ⇒ 0.5 × 3 = 1.5 ⇒ 1', () => {
    expect(quitHazard(0.5, 1, 2, 20, undefined, undefined, 1000, undefined)).toBe(1);
  });

  it('clamps at 0 for a negative multiplier: M = −1 ⇒ −0.01 ⇒ 0', () => {
    expect(quitHazard(0.01, 0, undefined, 20, undefined, undefined, 1000, undefined, -1)).toBe(0);
  });

  it('all factors together: h₀ 0.004, fatigue 0.5, κ_q 1, wage 22 vs w* 20 with ε 1, τ 180 with b 1, M 1.2', () => {
    // 0.004 × (1 + 1 × 0.5) × (22/20)^(−1) × (1 + 1 × e^(−1)) × 1.2
    // = 0.004 × 1.5 × 0.9090909… × 1.3678794412 × 1.2 = 0.0089533927…
    const expected = 0.004 * 1.5 * (1 / 1.1) * (1 + Math.exp(-1)) * 1.2;
    expect(quitHazard(0.004, 0.5, 1, 22, 20, 1, 180, 1, 1.2)).toBeCloseTo(expected, 12);
    expect(quitHazard(0.004, 0.5, 1, 22, 20, 1, 180, 1, 1.2)).toBeCloseTo(0.0089533927, 9);
  });
});

describe('absenceProbability (§3: p₀ (1 + κ_a fatigue) M, clamped to [0, 1])', () => {
  it('no fatigue weight ⇒ p₀ unchanged', () => {
    expect(absenceProbability(0.04, 0.5, undefined)).toBe(0.04);
  });

  it('fatigue 0 ⇒ p₀ unchanged whatever κ_a', () => {
    expect(absenceProbability(0.04, 0, 2)).toBe(0.04);
  });

  it('fatigue 0.5, κ_a 2 ⇒ 0.04 × 2 = 0.08', () => {
    expect(absenceProbability(0.04, 0.5, 2)).toBeCloseTo(0.08, 15);
  });

  it('M = 1.5 with the same fatigue ⇒ 0.04 × 2 × 1.5 = 0.12', () => {
    expect(absenceProbability(0.04, 0.5, 2, 1.5)).toBeCloseTo(0.12, 15);
  });

  it('clamps at 1: p₀ 0.6, fatigue 1, κ_a 2 ⇒ 1.8 ⇒ 1', () => {
    expect(absenceProbability(0.6, 1, 2)).toBe(1);
  });

  it('clamps at 0 for a negative multiplier: M = −1 ⇒ 0', () => {
    expect(absenceProbability(0.04, 0, undefined, -1)).toBe(0);
  });
});

describe('workforceDynamicsOn (true only when a per-employee mechanism is configured)', () => {
  it('all mechanisms missing or zero ⇒ false', () => {
    expect(workforceDynamicsOn(wfParams())).toBe(false);
    expect(workforceDynamicsOn(wfParams({ learningGain: 0, wageQuitElasticity: 0, earlyTenureQuitBoost: 0 }))).toBe(false);
  });

  it('a fatigue threshold turns it on (θ = 45)', () => {
    expect(workforceDynamicsOn(wfParams({ fatigueThresholdHours: 45 }))).toBe(true);
  });

  it('learning gain turns it on (G = 0.1); a learning time scale alone does not', () => {
    expect(workforceDynamicsOn(wfParams({ learningGain: 0.1 }))).toBe(true);
    expect(workforceDynamicsOn(wfParams({ learningDays: 120 }))).toBe(false);
  });

  it('wage elasticity turns it on (ε = 1)', () => {
    expect(workforceDynamicsOn(wfParams({ wageQuitElasticity: 1 }))).toBe(true);
  });

  it('early-tenure boost turns it on (b = 2)', () => {
    expect(workforceDynamicsOn(wfParams({ earlyTenureQuitBoost: 2 }))).toBe(true);
  });

  it('fatigue weights and the productivity loss have no effect alone (θ is what enables fatigue) ⇒ false', () => {
    expect(workforceDynamicsOn(wfParams({ quitFatigueWeight: 2, absenceFatigueWeight: 1, productivityFatigueLoss: 0.2 }))).toBe(false);
  });

  it('annual raises are not a per-employee mechanism in this check ⇒ false', () => {
    expect(workforceDynamicsOn(wfParams({ annualRaiseRate: 0.03 }))).toBe(false);
  });
});

describe('serviceIndex (§4: S = 1 − min(1, mean failure score))', () => {
  it('no failures ⇒ 1', () => {
    expect(serviceIndex(0)).toBe(1);
  });

  it('mean failure 0.25 ⇒ 0.75', () => {
    expect(serviceIndex(0.25)).toBeCloseTo(0.75, 15);
  });

  it('mean failure 1 ⇒ 0', () => {
    expect(serviceIndex(1)).toBe(0);
  });

  it('mean failure 1.7 is clamped to 1 ⇒ S = 0', () => {
    expect(serviceIndex(1.7)).toBe(0);
  });

  it('a negative mean is clamped to 0 ⇒ S = 1', () => {
    expect(serviceIndex(-0.3)).toBe(1);
  });
});

describe('referralLeadRate (§4: referrals/customer-year × N × S / 365 × leadSeasonality)', () => {
  it('1.2 × 300 × 0.9 × 1.5 / 365 = 486 / 365 = 1.3315068493…', () => {
    expect(referralLeadRate(1.2, 300, 0.9, 1.5)).toBeCloseTo(486 / 365, 12);
    expect(referralLeadRate(1.2, 300, 0.9, 1.5)).toBeCloseTo(1.3315068493150684, 12);
  });

  it('2 × 100 × 1 × 1 / 365 = 200 / 365 = 0.5479452054…', () => {
    expect(referralLeadRate(2, 100, 1, 1)).toBeCloseTo(200 / 365, 12);
  });

  it('365 referrals per customer-year with one customer and full satisfaction ⇒ 1 lead per day', () => {
    expect(referralLeadRate(365, 1, 1, 1)).toBeCloseTo(1, 12);
  });

  it('zero when satisfaction is 0 (no referrals from unhappy customers)', () => {
    expect(referralLeadRate(1.2, 300, 0, 1.5)).toBe(0);
  });

  it('zero when there are no active customers or no referrals', () => {
    expect(referralLeadRate(1.2, 0, 0.9, 1.5)).toBe(0);
    expect(referralLeadRate(0, 300, 0.9, 1.5)).toBe(0);
  });

  it('zero in an off-season month (seasonality 0)', () => {
    expect(referralLeadRate(1.2, 300, 0.9, 0)).toBe(0);
  });
});

describe('saturationFactor (§4: max(0, 1 − N / marketSize); 1 if marketSize missing)', () => {
  it('marketSize missing ⇒ 1 whatever N', () => {
    expect(saturationFactor(500, undefined)).toBe(1);
  });

  it('25 of 100 ⇒ 1 − 0.25 = 0.75', () => {
    expect(saturationFactor(25, 100)).toBeCloseTo(0.75, 15);
  });

  it('no customers ⇒ 1', () => {
    expect(saturationFactor(0, 100)).toBe(1);
  });

  it('N = marketSize ⇒ 0', () => {
    expect(saturationFactor(100, 100)).toBe(0);
  });

  it('N > marketSize ⇒ max(0, −0.5) = 0', () => {
    expect(saturationFactor(150, 100)).toBe(0);
  });

  it('marketSize 0 ⇒ 0 (no addressable market)', () => {
    expect(saturationFactor(10, 0)).toBe(0);
    expect(saturationFactor(0, 0)).toBe(0);
  });

  it('a negative marketSize is treated like 0 ⇒ 0', () => {
    expect(saturationFactor(5, -10)).toBe(0);
  });
});

describe('newCustomerChurnFactor (§4: 1 + b e^(−τ_c/180); 1 if b missing or 0)', () => {
  it('boost missing ⇒ 1', () => {
    expect(newCustomerChurnFactor(10, undefined)).toBe(1);
  });

  it('boost 0 ⇒ 1', () => {
    expect(newCustomerChurnFactor(10, 0)).toBe(1);
  });

  it('τ = 0 (just acquired): 1 + 2 × 1 = 3', () => {
    expect(newCustomerChurnFactor(0, 2)).toBeCloseTo(3, 15);
  });

  it('τ = 180: 1 + 2 e^−1 = 1.7357588823428847', () => {
    expect(newCustomerChurnFactor(180, 2)).toBeCloseTo(1.7357588823428847, 12);
  });

  it('τ = 360: 1 + 2 e^−2 = 1.2706705664732254', () => {
    expect(newCustomerChurnFactor(360, 2)).toBeCloseTo(1.2706705664732254, 12);
  });

  it('negative tenure clamps to 0: τ = −10 gives the τ = 0 value 3', () => {
    expect(newCustomerChurnFactor(-10, 2)).toBeCloseTo(3, 15);
  });
});

describe('agedMaintenanceRate (§5: rate × (1 + factor × age); exactly rate when factor is 0 or missing)', () => {
  it('factor missing ⇒ the very same number (Object.is identity, not just close)', () => {
    expect(Object.is(agedMaintenanceRate(0.37, undefined, 5), 0.37)).toBe(true);
  });

  it('factor 0 ⇒ the very same number whatever the age', () => {
    expect(Object.is(agedMaintenanceRate(0.37, 0, 5), 0.37)).toBe(true);
    expect(Object.is(agedMaintenanceRate(0.37, 0, 0), 0.37)).toBe(true);
  });

  it('age 0 with a factor: 0.2 × (1 + 0.1 × 0) = 0.2', () => {
    expect(agedMaintenanceRate(0.2, 0.1, 0)).toBeCloseTo(0.2, 15);
  });

  it('factor 0.1, age 5 ⇒ 0.2 × (1 + 0.5) = 0.3', () => {
    expect(agedMaintenanceRate(0.2, 0.1, 5)).toBeCloseTo(0.3, 15);
  });

  it('factor 0.2, age 2 ⇒ 0.2 × 1.4 = 0.28', () => {
    expect(agedMaintenanceRate(0.2, 0.2, 2)).toBeCloseTo(0.28, 15);
  });
});
