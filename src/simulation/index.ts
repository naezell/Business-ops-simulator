/** Public API of the simulation engine. */
export type * from './types';

export { runSimulation, weatherFromDraw, summarize } from './engine';
export { validateScenario } from './validate';
export { applyActionsAtDayZero } from './project';
export { createDrawCache } from './schedule';
export type { ProjectedCompany, RejectedProjectionAction } from './project';

export { rand01, hashString, poissonInverse, uniformInt, uniformRange, STREAM } from './rng';
export type { StreamId } from './rng';
export { MONTH_LENGTHS, buildCalendar, dayInfo, dayOfWeek, isWorkday } from './calendar';
export type { DayInfo } from './calendar';

export * from './finance';

export {
  priceMultiplier,
  priceIndex,
  priceIndexFrom,
  leadRatePerDay,
  conversionProbability,
  monthlyChurnRate,
  dailyHazardFromMonthly,
  churnHazard,
  failureDecayFactor,
  priceShockProbability,
  oneOffDailyProbability,
  oneOffPriceFactor,
  clamp,
  ACCRUAL_EPS,
} from './demand';
export { rampFactor, coordinationFactor, crewRate, dailyHazardFromAnnual } from './workforce';
export { breakdownProbability } from './assets';
export { roadMiles, travelTime, fitOrder, CLOCK_EPS, MIN_SPLIT_HOURS } from './dispatch';
export type { FitResult } from './dispatch';

// Digital twin (simulation-design §2–§9).
export { scaleCustomerBase, theoreticalWeeklyCapacity, hashRank } from './scale';
export { SHOCK_TARGETS, shockMultiplier, scaleProbability, shockedCollectionDelay } from './conditions';
export { OBSERVABLES, SCOPED_OBSERVABLES } from './rules';
export {
  learningFactor,
  trailingWeeklyHours,
  fatigueIndex,
  productivityFatigueFactor,
  quitHazard,
  absenceProbability,
  serviceIndex,
  referralLeadRate,
  saturationFactor,
  newCustomerChurnFactor,
  agedMaintenanceRate,
} from './dynamics';
