/**
 * Purpose-built optimizer scenarios (optimization-engine §8). Each one has a
 * correct answer that is known from its construction. Built on the engine test
 * helpers; independent of src/business.
 */
import type { Customer, PlannedAction, Scenario } from '../../src/simulation';
import type { OptimizationRequest, OptimizerCatalog } from '../../src/optimization';
import { customer, deterministicCompany, employee, equipment, jobType, scenario, stochasticCompany, vehicle } from '../simulation/helpers';

export const truck = {
  id: 'truck',
  name: 'Truck',
  seats: 3,
  mpg: 15,
  maintenanceCostPerMile: 0.1,
  purchasePrice: 40000,
  usefulLifeYears: 6,
  salvageValue: 8000,
  leaseMonthly: 700,
};

/** One truck, one hire template, a two-person standard crew; no equipment unless added. */
export function testCatalog(over: Partial<OptimizerCatalog> = {}): OptimizerCatalog {
  return {
    vehicleCatalog: [truck],
    equipmentCatalog: [],
    hireTemplates: [{ id: 'hand', title: 'Crew member', hourlyWage: 18, skill: 2, productivity: 1 }],
    standardCrew: { hireTemplateIds: ['hand', 'hand'], vehicleCatalogId: 'truck', equipmentCatalogIds: [] },
    ...over,
  };
}

export function request(sc: Scenario, catalog: OptimizerCatalog, over: Partial<OptimizationRequest> = {}): OptimizationRequest {
  return { scenario: sc, catalog, objective: 'net-profit', ...over };
}

/** n customers at one point (so every routing policy produces the same routes), phases staggered over a week. */
function clusteredCustomers(n: number, plan: string, x = 3, y = 4): Customer[] {
  return Array.from({ length: n }, (_, i) => customer(`k${i}`, x, y, plan, { phase: (i % 7) / 7 }));
}

/**
 * §8.1 Capacity-bound, cash-rich. One two-person crew (rate 2 std h per clock hour) on
 * 1-hour jobs 5 miles out: about 15 jobs per day, 75 per week, against 240 weekly visits.
 * Jobs cancel after 7 days, so most demand is lost for lack of crew time. All
 * elasticities are 0 and cash is ample: doubling capacity (a second crew) adds about
 * 75 × $60 a week of revenue for ~$290 a week of wages, far more than any price change.
 */
export function capacityBound(): Scenario {
  return scenario(
    deterministicCompany({
      jobTypes: [jobType({ id: 'mow', basePrice: 60, cancelAfterDays: 7 })],
      customers: clusteredCustomers(240, 'mow'),
      finance: {
        ...deterministicCompany().finance,
        startingCash: 1_000_000,
      },
    }),
    { horizonDays: 84 },
  );
}

/**
 * §8.2 Demand-bound. Two two-person crews paid a full 8 h shift but only 20 one-hour
 * weekly visits: crews are idle most of the day, so another crew only adds wages.
 */
export function demandBound(): Scenario {
  return scenario(
    deterministicCompany({
      jobTypes: [jobType({ id: 'mow', basePrice: 60 })],
      crews: [
        { id: 'c1', name: 'Crew 1', vehicleId: 'v1' },
        { id: 'c2', name: 'Crew 2', vehicleId: 'v2' },
      ],
      employees: [employee('e1', 'c1'), employee('e2', 'c1'), employee('e3', 'c2'), employee('e4', 'c2')],
      vehicles: [vehicle('v1'), vehicle('v2')],
      customers: clusteredCustomers(20, 'mow'),
      policies: { ...deterministicCompany().policies, minPaidHoursPerShift: 8 },
      finance: { ...deterministicCompany().finance, startingCash: 1_000_000 },
    }),
    { horizonDays: 84 },
  );
}

export const expensiveTruck = { ...truck, id: 'big-truck', name: 'Big truck', purchasePrice: 80000, leaseMonthly: 1200 };

/**
 * §8.3 Cash-poor. $10,000 cash, no line of credit, loans need 20% down: an $80,000
 * truck on a loan needs $16,000 on day 0 and is infeasible before simulating.
 */
export function cashPoor(): Scenario {
  return scenario(
    deterministicCompany({
      jobTypes: [jobType({ id: 'mow', basePrice: 60 })],
      customers: clusteredCustomers(30, 'mow'),
    }),
    { horizonDays: 56 },
  );
}

export const aeratorSpec = {
  id: 'aerator-1',
  name: 'Aerator',
  equipmentTypeId: 'aerator',
  maintenanceCostPerHour: 0.5,
  purchasePrice: 1500,
  usefulLifeYears: 5,
  salvageValue: 0,
  leaseMonthly: 40,
};

/**
 * §8.4 Missing equipment. Half the customers buy weekly aeration at $150 that
 * requires an aerator nobody owns; the crew has spare time. A $1,500 aerator for
 * the crew turns ~10 lost jobs a week into revenue; a spare (unassigned) aerator
 * cannot be borrowed because the crew does not own that type, so it only costs money.
 */
export function missingEquipment(): Scenario {
  const customers = [
    ...clusteredCustomers(10, 'mow'),
    ...Array.from({ length: 10 }, (_, i) => customer(`a${i}`, 3, 4, 'aerate', { phase: (i % 7) / 7 })),
  ];
  return scenario(
    deterministicCompany({
      jobTypes: [
        jobType({ id: 'mow', basePrice: 60 }),
        jobType({ id: 'aerate', name: 'Aeration', basePrice: 150, requiredEquipmentTypes: ['aerator'], cancelAfterDays: 7 }),
      ],
      customers,
      equipment: [equipment('mower-1', 'mower', 'c1')],
    }),
    { horizonDays: 84 },
  );
}

/**
 * §8.5 Zero elasticity. 10 weekly customers (phase 0, size 1, $50) and a crew that
 * works every day with ample time. Accrual reaches 1 on days 6, 13, 20, 27, and each
 * order is completed the day it is created, so the 28-day revenue is 10 × 4 × $50 =
 * $2,000, and a +10% price set on day 0 (before any order exists) adds exactly $200.
 */
export const ZERO_ELASTICITY = { customers: 10, visits: 4, price: 50 };

export function zeroElasticity(): Scenario {
  const det = deterministicCompany();
  return scenario(
    deterministicCompany({
      customers: Array.from({ length: ZERO_ELASTICITY.customers }, (_, i) => customer(`z${i}`, 1 + i * 0.3, 2, 'mow')),
      policies: { ...det.policies, workDaysPerWeek: 7 },
    }),
    { horizonDays: 28 },
  );
}

/** §8.6–8.9 A small stochastic company (every rate non-zero) with a tiny catalog. */
export function smallStochastic(): Scenario {
  const company = stochasticCompany(30, 1);
  // Enough cash that the baseline never runs short, so feasibility is mostly about service levels.
  company.finance = { ...company.finance, startingCash: 80000, lineOfCredit: { limit: 20000, annualRate: 0.1 } };
  return scenario(company, { horizonDays: 150, seed: 5 });
}

export function smallCatalog(): OptimizerCatalog {
  return testCatalog({ hireTemplates: [], vehicleCatalog: [] });
}

/** Re-simulation helper: the candidate scenario of §2. */
export function withActions(sc: Scenario, seed: number, actions: PlannedAction[]): Scenario {
  return { ...sc, seed, actions: [...sc.actions, ...actions] };
}
