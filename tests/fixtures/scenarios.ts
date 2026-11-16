/**
 * Shared scenario builders for tests (backlog H6).
 *
 * Every builder returns a fresh, valid Scenario with a 30-day horizon. Values are literals or simple
 * arithmetic on indices: no Math.random, no Date, no dates. These builders are independent of
 * tests/simulation/helpers.ts; they only use the public types from src/simulation.
 */
import type {
  AssetFinance,
  CompanyConfig,
  Crew,
  Customer,
  Employee,
  FinanceParams,
  JobTypeDef,
  MarketParams,
  OverheadItem,
  Policies,
  ReliabilityParams,
  Scenario,
  Vehicle,
  WeatherParams,
  WorkforceParams,
} from '../../src/simulation';

export const FIXTURE_HORIZON_DAYS = 30;

const twelve = (v: number): number[] => Array.from({ length: 12 }, () => v);

// ───────────── Component builders ─────────────

/** Weekly recurring mowing: 1 standard labor hour, $50 base price, no equipment requirement. */
export function mowJob(over: Partial<JobTypeDef> = {}): JobTypeDef {
  return {
    id: 'mow',
    name: 'Weekly mow',
    kind: 'recurring',
    standardLaborHours: 1,
    basePrice: 50,
    materialCost: 2,
    equipmentFuelGalPerHour: 0,
    requiredEquipmentTypes: [],
    minSkill: 1,
    minCrewSize: 1,
    weatherSensitive: false,
    splittable: false,
    seasonality: twelve(1),
    intervalDays: 7,
    lateAfterDays: 3,
    cancelAfterDays: 14,
    offered: true,
    ...over,
  };
}

export function person(id: string, crewId: string | null, over: Partial<Employee> = {}): Employee {
  return { id, name: `Worker ${id}`, hourlyWage: 20, skill: 2, productivity: 1, crewId, tenureDays: 365, ...over };
}

function ownedAsset(purchasePrice: number, usefulLifeYears: number, salvageValue: number): AssetFinance {
  return { purchasePrice, usefulLifeYears, salvageValue, ageYears: 1, financing: { kind: 'owned' } };
}

export function truck(id: string, seats: number): Vehicle {
  return { id, name: `Truck ${id}`, seats, mpg: 15, maintenanceCostPerMile: 0.12, asset: ownedAsset(30000, 7, 3000) };
}

export function crew(id: string, vehicleId: string | null): Crew {
  return { id, name: `Crew ${id}`, vehicleId };
}

/** `n` customers on the mow plan on a grid of `spacingMiles`, 10 columns wide, all east/north of the depot. */
export function gridCustomers(n: number, spacingMiles: number, plan: string | null = 'mow'): Customer[] {
  const columns = 10;
  return Array.from({ length: n }, (_, i) => ({
    id: `k${String(i + 1).padStart(3, '0')}`,
    name: `Customer ${i + 1}`,
    x: (i % columns) * spacingMiles,
    y: Math.floor(i / columns) * spacingMiles,
    sizeFactor: 1,
    recurringJobTypeId: plan,
    phase: (i % 7) / 7,
  }));
}

// ───────────── Parameter blocks (fresh objects each call) ─────────────

export function defaultMarket(): MarketParams {
  return {
    organicLeadsPerMonth: 4,
    marketingMonthlySpend: 300,
    marketingMaxLeadsPerMonth: 6,
    marketingSpendScale: 600,
    leadSeasonality: twelve(1),
    baseConversionRate: 0.3,
    acquisitionPriceElasticity: 1,
    baseMonthlyChurn: 0.02,
    retentionPriceElasticity: 1,
    priceIncreaseShockChurnPerPct: 0.003,
    serviceFailureChurnWeight: 0.5,
    serviceFailureHalfLifeDays: 30,
    newCustomer: { serviceRadiusMiles: 10, sizeFactorMin: 0.8, sizeFactorMax: 1.2, recurringJobTypeMix: { mow: 1 } },
  };
}

export function defaultWorkforce(): WorkforceParams {
  return {
    payrollBurdenRate: 0.1,
    overtimeMultiplier: 1.5,
    overtimeWeeklyThresholdHours: 40,
    absenceRate: 0.02,
    annualTurnoverRate: 0.1,
    timeToFillDays: 10,
    hiringCostPerHire: 500,
    rampDays: 0,
    rampStartProductivity: 1,
    crewSizeCoordinationLoss: 0.05,
    payPeriodDays: 14,
  };
}

export function defaultReliability(): ReliabilityParams {
  return {
    vehicle: { dailyProb: 0.002, ageFactorPerYear: 0.1, repairDaysMin: 1, repairDaysMax: 3, repairCostMin: 200, repairCostMax: 900 },
    equipment: { dailyProb: 0.003, ageFactorPerYear: 0.1, repairDaysMin: 1, repairDaysMax: 2, repairCostMin: 50, repairCostMax: 300 },
  };
}

export function defaultWeather(): WeatherParams {
  return { rainoutProbByMonth: twelve(0.05), partialProbByMonth: twelve(0.05), partialDayFraction: 0.5 };
}

export function defaultPolicies(): Policies {
  return {
    shiftHours: 8,
    workDaysPerWeek: 5,
    maxOvertimeHoursPerDay: 0,
    minPaidHoursPerShift: 0,
    rainoutPaidHours: 0,
    routing: 'fifo',
    autoBackfill: false,
    acceptNewCustomers: true,
  };
}

export function defaultFinance(over: Partial<FinanceParams> = {}): FinanceParams {
  return {
    startingCash: 20000,
    minCashReserve: 2000,
    lineOfCredit: { limit: 10000, annualRate: 0.1 },
    ar: { collectionDaysMean: 15, collectionDaysJitter: 0.2, badDebtRate: 0.01 },
    newLoan: { annualRate: 0.07, termMonths: 36, downPaymentFraction: 0.2 },
    ...over,
  };
}

/** A company with no crews, employees, equipment or customers, and the default parameter blocks. */
export function baseCompany(over: Partial<CompanyConfig> = {}): CompanyConfig {
  const overhead: OverheadItem[] = [];
  return {
    industryId: 'fixture',
    name: 'Fixture company',
    startMonth: 0,
    jobTypes: [mowJob()],
    employees: [],
    crews: [],
    vehicles: [],
    equipment: [],
    customers: [],
    pricing: { globalMultiplier: 1, byJobType: {} },
    policies: defaultPolicies(),
    market: defaultMarket(),
    workforce: defaultWorkforce(),
    reliability: defaultReliability(),
    weather: defaultWeather(),
    costs: { fuelPricePerGallon: 3.5, avgSpeedMph: 25, roadFactor: 1.3, stopOverheadHours: 0.1, overhead },
    finance: defaultFinance(),
    ...over,
  };
}

export function fixtureScenario(id: string, name: string, company: CompanyConfig, seed = 1): Scenario {
  return { id, name, company, actions: [], horizonDays: FIXTURE_HORIZON_DAYS, seed };
}

// ───────────── Named builders ─────────────

/** No crews, no employees, no customers, no job types. Valid (warnings only) and must simulate. */
export function emptyCompany(): Scenario {
  return fixtureScenario('empty', 'Empty company', baseCompany({ jobTypes: [] }));
}

/** One person, one truck, one crew, 10 mowing customers 0.5 miles apart. */
export function soloOperator(): Scenario {
  return fixtureScenario(
    'solo',
    'Solo operator',
    baseCompany({
      employees: [person('e1', 'c1')],
      crews: [crew('c1', 'v1')],
      vehicles: [truck('v1', 2)],
      customers: gridCustomers(10, 0.5),
    }),
  );
}

/**
 * One crew of two equal workers (rate 2 person-hours per clock hour, no coordination loss), one truck,
 * 80 weekly mowing customers on a 0.1-mile grid. Each 2-labor job takes about 1 clock hour, so one
 * 8-hour workday clears about 8 jobs against roughly 80 weekly visits: demand is about twice capacity.
 * Cash-rich: $500,000 starting cash and no line of credit needed.
 */
export function capacityBound(): Scenario {
  return fixtureScenario(
    'capacity-bound',
    'Capacity bound',
    baseCompany({
      jobTypes: [mowJob({ standardLaborHours: 2, basePrice: 60, materialCost: 0 })],
      employees: [person('e1', 'c1'), person('e2', 'c1')],
      crews: [crew('c1', 'v1')],
      vehicles: [truck('v1', 2)],
      customers: gridCustomers(80, 0.1),
      workforce: { ...defaultWorkforce(), crewSizeCoordinationLoss: 0 },
      finance: defaultFinance({ startingCash: 500000, lineOfCredit: { limit: 0, annualRate: 0 } }),
    }),
  );
}

/** Three crews of one worker each with a truck, and only 20 weekly customers: crews have spare time, demand limits the work. */
export function demandBound(): Scenario {
  return fixtureScenario(
    'demand-bound',
    'Demand bound',
    baseCompany({
      employees: [person('e1', 'c1'), person('e2', 'c2'), person('e3', 'c3')],
      crews: [crew('c1', 'v1'), crew('c2', 'v2'), crew('c3', 'v3')],
      vehicles: [truck('v1', 2), truck('v2', 2), truck('v3', 2)],
      customers: gridCustomers(20, 0.3),
    }),
  );
}

/** The solo operator with $500 starting cash, no line of credit, and $2,000 a month of yard rent. */
export function cashPoor(): Scenario {
  const solo = soloOperator();
  const company = solo.company;
  return fixtureScenario(
    'cash-poor',
    'Cash poor',
    {
      ...company,
      costs: {
        ...company.costs,
        overhead: [{ id: 'rent', name: 'Yard rent', monthlyAmount: 2000 }],
      },
      finance: defaultFinance({
        startingCash: 500,
        minCashReserve: 0,
        lineOfCredit: { limit: 0, annualRate: 0 },
      }),
    },
  );
}

/**
 * The solo operator's customers demand a mowing job that needs a 'mower' equipment type, and no
 * equipment item exists in the company, so no crew can ever perform it.
 */
export function missingEquipment(): Scenario {
  const solo = soloOperator();
  return fixtureScenario(
    'missing-equipment',
    'Missing equipment',
    {
      ...solo.company,
      jobTypes: [mowJob({ requiredEquipmentTypes: ['mower'] })],
      equipment: [],
    },
  );
}

/**
 * Returns a deep copy of `base` with every stochastic rate set to 0 (simulation-engine §3): absence,
 * turnover, breakdowns (and their age effect), weather, leads, conversion, churn (base, failure
 * weight and price shock), one-off arrival rates, collection jitter and bad debt. The input is not mutated.
 */
export function allRatesZero(base: Scenario): Scenario {
  const s = structuredClone(base);
  const c = s.company;
  c.workforce.absenceRate = 0;
  c.workforce.annualTurnoverRate = 0;
  c.reliability.vehicle.dailyProb = 0;
  c.reliability.vehicle.ageFactorPerYear = 0;
  c.reliability.equipment.dailyProb = 0;
  c.reliability.equipment.ageFactorPerYear = 0;
  c.weather.rainoutProbByMonth = twelve(0);
  c.weather.partialProbByMonth = twelve(0);
  c.market.organicLeadsPerMonth = 0;
  c.market.marketingMaxLeadsPerMonth = 0;
  c.market.baseConversionRate = 0;
  c.market.baseMonthlyChurn = 0;
  c.market.serviceFailureChurnWeight = 0;
  c.market.priceIncreaseShockChurnPerPct = 0;
  c.finance.ar.collectionDaysJitter = 0;
  c.finance.ar.badDebtRate = 0;
  c.jobTypes = c.jobTypes.map((j) => (j.kind === 'one-off' ? { ...j, annualRatePerCustomer: 0 } : j));
  return s;
}
