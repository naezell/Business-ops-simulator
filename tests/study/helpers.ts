/** Shared builders for the study tests. */
import type { OptimizerCatalog } from '../../src/optimization';
import type { CompanyConfig, Scenario } from '../../src/simulation';
import { customer, deterministicCompany, months, scenario } from '../simulation/helpers';

export const catalog: OptimizerCatalog = {
  vehicleCatalog: [{ id: 'truck', name: 'Truck', seats: 3, mpg: 20, maintenanceCostPerMile: 0, purchasePrice: 30000, usefulLifeYears: 5, salvageValue: 5000, leaseMonthly: 600 }],
  equipmentCatalog: [],
  hireTemplates: [{ id: 'hand', title: 'Crew member', hourlyWage: 20, skill: 2, productivity: 1 }],
  standardCrew: { hireTemplateIds: ['hand', 'hand'], vehicleCatalogId: 'truck', equipmentCatalogIds: [] },
};

/** One crew of two on a 3-seat truck; `n` weekly customers in a tight cluster (no travel to speak of). */
export function oneCrew(n: number, over: Partial<CompanyConfig> = {}): CompanyConfig {
  const base = deterministicCompany({
    customers: Array.from({ length: n }, (_, i) => customer(`k${i}`, 0.3 + (i % 10) * 0.01, Math.floor(i / 10) * 0.01, 'mow', { phase: (i % 7) / 7 })),
  });
  return { ...base, policies: { ...base.policies, minPaidHoursPerShift: 8 }, finance: { ...base.finance, startingCash: 100000 }, ...over };
}

export function sc(company: CompanyConfig, horizonDays = 56, seed = 1): Scenario {
  return scenario(company, { horizonDays, seed });
}

export { months };
