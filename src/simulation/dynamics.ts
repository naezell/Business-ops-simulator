/**
 * Workforce, customer and asset dynamics (digital-twin simulation-design §3–§5).
 * Pure formulas only; the engine calls them when the corresponding optional parameters are set.
 * Every mechanism is off when its parameters are missing or 0.
 */
import type { WorkforceParams } from './types';

// ───────────── Workforce (§3) ─────────────

/** learn = 1 + G (1 − e^(−τ/L)); 1 when G is 0/missing or L ≤ 0. */
export function learningFactor(tenureDays: number, gain: number | undefined, learningDays: number | undefined): number {
  const G = gain ?? 0;
  const L = learningDays ?? 0;
  if (G === 0 || !(L > 0)) return 1;
  return 1 + G * (1 - Math.exp(-Math.max(0, tenureDays) / L));
}

/**
 * Trailing average weekly paid hours h̄ = paidHoursLastN × 7 / n with n = min(28, daysEmployedInRun);
 * 0 when n < 7.
 */
export function trailingWeeklyHours(paidHoursLastN: number, n: number): number {
  return n < 7 ? 0 : (paidHoursLastN * 7) / n;
}

/** Days in the fatigue window: n = min(28, day − max(hireDay, 0)). */
export function fatigueWindowDays(day: number, hireDay: number): number {
  return Math.min(28, day - Math.max(hireDay, 0));
}

/** fatigue = max(0, (h̄ − θ) / 10); 0 when θ is missing. */
export function fatigueIndex(weeklyHours: number, thresholdHours: number | undefined): number {
  if (thresholdHours === undefined) return 0;
  return Math.max(0, (weeklyHours - thresholdHours) / 10);
}

/** max(0.7, 1 − κ_p × fatigue). */
export function productivityFatigueFactor(fatigue: number, loss: number | undefined): number {
  return Math.max(0.7, 1 - (loss ?? 0) * fatigue);
}

/** Reference wage for a skill level (index = round(skill), clamped to the array). */
export function marketWage(marketWageBySkill: number[] | undefined, skill: number): number | undefined {
  if (!marketWageBySkill || marketWageBySkill.length === 0) return undefined;
  const i = Math.min(marketWageBySkill.length - 1, Math.max(0, Math.round(skill)));
  return marketWageBySkill[i];
}

/**
 * Daily quit hazard (§3):
 * h₀ (1 + κ_q fatigue) (wage / w*)^(−ε) (1 + b e^(−τ/180)) M, clamped to [0, 1].
 * The wage term is 1 when ε is 0 or no positive reference wage exists.
 */
export function quitHazard(
  h0: number,
  fatigue: number,
  quitFatigueWeight: number | undefined,
  wage: number,
  referenceWage: number | undefined,
  wageQuitElasticity: number | undefined,
  tenureDays: number,
  earlyTenureQuitBoost: number | undefined,
  m = 1,
): number {
  const eps = wageQuitElasticity ?? 0;
  const wageTerm = eps !== 0 && referenceWage !== undefined && referenceWage > 0 && wage > 0 ? Math.pow(wage / referenceWage, -eps) : 1;
  const b = earlyTenureQuitBoost ?? 0;
  const tenureTerm = b !== 0 ? 1 + b * Math.exp(-Math.max(0, tenureDays) / 180) : 1;
  const h = h0 * (1 + (quitFatigueWeight ?? 0) * fatigue) * wageTerm * tenureTerm * m;
  return h > 1 ? 1 : h < 0 ? 0 : h;
}

/** Absence probability p₀ (1 + κ_a fatigue) M, clamped to [0, 1]. */
export function absenceProbability(p0: number, fatigue: number, absenceFatigueWeight: number | undefined, m = 1): number {
  const p = p0 * (1 + (absenceFatigueWeight ?? 0) * fatigue) * m;
  return p > 1 ? 1 : p < 0 ? 0 : p;
}

/** True if any per-employee workforce mechanism is configured (fatigue, learning, pay, tenure). */
export function workforceDynamicsOn(wf: WorkforceParams): boolean {
  return (
    wf.fatigueThresholdHours !== undefined ||
    (wf.learningGain ?? 0) !== 0 ||
    (wf.wageQuitElasticity ?? 0) !== 0 ||
    (wf.earlyTenureQuitBoost ?? 0) !== 0
  );
}

// ───────────── Customers (§4) ─────────────

/** Service-satisfaction index S = 1 − min(1, mean failure score). */
export function serviceIndex(meanFailureScore: number): number {
  return 1 - Math.min(1, Math.max(0, meanFailureScore));
}

/** Referral leads per day: referralsPerCustomerYear × N_active × S / 365 × leadSeasonality. */
export function referralLeadRate(referralsPerCustomerYear: number, activeCustomers: number, satisfaction: number, seasonality: number): number {
  return (referralsPerCustomerYear * activeCustomers * satisfaction * seasonality) / 365;
}

/** Saturation max(0, 1 − N_active / marketSize); 1 when marketSize is missing. */
export function saturationFactor(activeCustomers: number, marketSize: number | undefined): number {
  if (marketSize === undefined) return 1;
  if (!(marketSize > 0)) return 0;
  return Math.max(0, 1 - activeCustomers / marketSize);
}

/** New-customer churn term 1 + b e^(−τ_c / 180). */
export function newCustomerChurnFactor(daysSinceAcquisition: number, boost: number | undefined): number {
  const b = boost ?? 0;
  return b === 0 ? 1 : 1 + b * Math.exp(-Math.max(0, daysSinceAcquisition) / 180);
}

// ───────────── Assets (§5) ─────────────

/** Routine maintenance rate × (1 + factor × current age in years). Exactly `rate` when the factor is 0/missing. */
export function agedMaintenanceRate(rate: number, factorPerYear: number | undefined, ageYears: number): number {
  const f = factorPerYear ?? 0;
  return f === 0 ? rate : rate * (1 + f * ageYears);
}
