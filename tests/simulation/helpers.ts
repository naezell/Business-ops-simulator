/**
 * Small scenario builders for engine tests. Independent of src/business and tests/fixtures.
 * `deterministicCompany()` has every stochastic rate at 0 so runs are hand-computable.
 */
import type {
  CompanyConfig,
  Customer,
  Employee,
  EquipmentItem,
  JobTypeDef,
  PlannedAction,
  Scenario,
  Vehicle,
} from '../../src/simulation';

export const months = (v: number): number[] => Array.from({ length: 12 }, () => v);

export function jobType(over: Partial<JobTypeDef> = {}): JobTypeDef {
  return {
    id: 'mow',
    name: 'Mowing',
    kind: 'recurring',
    standardLaborHours: 1,
    basePrice: 50,
    materialCost: 0,
    equipmentFuelGalPerHour: 0,
    requiredEquipmentTypes: [],
    minSkill: 1,
    minCrewSize: 1,
    weatherSensitive: false,
    splittable: false,
    seasonality: months(1),
    intervalDays: 7,
    lateAfterDays: 7,
    cancelAfterDays: 30,
    offered: true,
    ...over,
  };
}

export function employee(id: string, crewId: string | null, over: Partial<Employee> = {}): Employee {
  return { id, name: id, hourlyWage: 20, skill: 2, productivity: 1, crewId, tenureDays: 1000, ...over };
}

export function vehicle(id: string, over: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    name: id,
    seats: 3,
    mpg: 20,
    maintenanceCostPerMile: 0,
    asset: { purchasePrice: 0, usefulLifeYears: 5, salvageValue: 0, ageYears: 0, financing: { kind: 'owned' } },
    ...over,
  };
}

export function equipment(id: string, typeId: string, crewId: string | null, over: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    id,
    name: id,
    equipmentTypeId: typeId,
    crewId,
    maintenanceCostPerHour: 0,
    asset: { purchasePrice: 0, usefulLifeYears: 5, salvageValue: 0, ageYears: 0, financing: { kind: 'owned' } },
    ...over,
  };
}

export function customer(id: string, x: number, y: number, plan: string | null = 'mow', over: Partial<Customer> = {}): Customer {
  return { id, name: id, x, y, sizeFactor: 1, recurringJobTypeId: plan, phase: 0, ...over };
}

/** One crew (c1, vehicle v1, employees e1/e2), no customers, all stochastic rates 0. */
export function deterministicCompany(over: Partial<CompanyConfig> = {}): CompanyConfig {
  const base: CompanyConfig = {
    industryId: 'test',
    name: 'Test Co',
    startMonth: 0,
    jobTypes: [jobType()],
    employees: [employee('e1', 'c1'), employee('e2', 'c1')],
    crews: [{ id: 'c1', name: 'Crew 1', vehicleId: 'v1' }],
    vehicles: [vehicle('v1')],
    equipment: [],
    customers: [],
    pricing: { globalMultiplier: 1, byJobType: {} },
    policies: {
      shiftHours: 8,
      workDaysPerWeek: 5,
      maxOvertimeHoursPerDay: 0,
      minPaidHoursPerShift: 0,
      rainoutPaidHours: 0,
      routing: 'fifo',
      autoBackfill: false,
      acceptNewCustomers: true,
    },
    market: {
      organicLeadsPerMonth: 0,
      marketingMonthlySpend: 0,
      marketingMaxLeadsPerMonth: 0,
      marketingSpendScale: 0,
      leadSeasonality: months(1),
      baseConversionRate: 0,
      acquisitionPriceElasticity: 0,
      baseMonthlyChurn: 0,
      retentionPriceElasticity: 0,
      priceIncreaseShockChurnPerPct: 0,
      serviceFailureChurnWeight: 0,
      serviceFailureHalfLifeDays: 30,
      newCustomer: { serviceRadiusMiles: 10, sizeFactorMin: 1, sizeFactorMax: 1, recurringJobTypeMix: { mow: 1 } },
    },
    workforce: {
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
    },
    reliability: {
      vehicle: { dailyProb: 0, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 1, repairCostMin: 0, repairCostMax: 0 },
      equipment: { dailyProb: 0, ageFactorPerYear: 0, repairDaysMin: 1, repairDaysMax: 1, repairCostMin: 0, repairCostMax: 0 },
    },
    weather: { rainoutProbByMonth: months(0), partialProbByMonth: months(0), partialDayFraction: 0.5 },
    costs: { fuelPricePerGallon: 0, avgSpeedMph: 30, roadFactor: 1, stopOverheadHours: 0, overhead: [] },
    finance: {
      startingCash: 10000,
      minCashReserve: 0,
      lineOfCredit: { limit: 0, annualRate: 0 },
      ar: { collectionDaysMean: 0, collectionDaysJitter: 0, badDebtRate: 0 },
      newLoan: { annualRate: 0.06, termMonths: 36, downPaymentFraction: 0.2 },
    },
  };
  return { ...base, ...over };
}

export function scenario(company: CompanyConfig, over: Partial<Scenario> = {}): Scenario {
  return { id: 'sc', name: 'test', company, actions: [] as PlannedAction[], horizonDays: 28, seed: 1, ...over };
}

/** Deterministic pseudo-layout (no Math.random): golden-angle spiral. */
export function spiralCustomers(n: number, plans: (i: number) => string | null, radius = 12): Customer[] {
  const out: Customer[] = [];
  for (let i = 0; i < n; i++) {
    const ang = i * 2.399963229728653;
    const r = radius * Math.sqrt((i + 0.5) / n);
    out.push(
      customer(`k${i}`, r * Math.cos(ang), r * Math.sin(ang), plans(i), {
        sizeFactor: 0.7 + ((i * 37) % 11) / 10,
        phase: ((i * 13) % 7) / 7,
      }),
    );
  }
  return out;
}

/** Mid-size stochastic company: every rate non-zero, two crews, ≈ nCustomers customers. */
export function stochasticCompany(nCustomers = 60, nCrews = 2): CompanyConfig {
  const det = deterministicCompany();
  const crews = Array.from({ length: nCrews }, (_, i) => ({ id: `c${i + 1}`, name: `Crew ${i + 1}`, vehicleId: `v${i + 1}` }));
  const employees: Employee[] = [];
  crews.forEach((c, i) => {
    employees.push(employee(`e${i}a`, c.id, { skill: 3, hourlyWage: 26, tenureDays: 900 }));
    employees.push(employee(`e${i}b`, c.id, { skill: 1, hourlyWage: 18, productivity: 0.9, tenureDays: 20 }));
    employees.push(employee(`e${i}c`, c.id, { skill: 2, hourlyWage: 21, productivity: 1.05, tenureDays: 200 }));
  });
  employees.push(employee('floater', null, { hourlyWage: 17 }));
  const finance = (price: number, kind: 'owned' | 'loan' | 'lease') =>
    kind === 'owned'
      ? { purchasePrice: price, usefulLifeYears: 7, salvageValue: price * 0.15, ageYears: 2.5, financing: { kind: 'owned' as const } }
      : kind === 'loan'
        ? {
            purchasePrice: price,
            usefulLifeYears: 7,
            salvageValue: price * 0.15,
            ageYears: 1,
            financing: { kind: 'loan' as const, balance: price * 0.6, annualRate: 0.07, monthsRemaining: 30 },
          }
        : { purchasePrice: price, usefulLifeYears: 7, salvageValue: 0, ageYears: 0, financing: { kind: 'lease' as const, monthlyPayment: 450 } };
  const vehicles: Vehicle[] = crews.map((_, i) =>
    vehicle(`v${i + 1}`, { mpg: 14, maintenanceCostPerMile: 0.12, asset: finance(38000, i % 2 === 0 ? 'owned' : 'loan') }),
  );
  vehicles.push(vehicle('vspare', { mpg: 18, maintenanceCostPerMile: 0.1, asset: finance(30000, 'lease') }));
  const equipmentItems: EquipmentItem[] = [];
  crews.forEach((c, i) => {
    equipmentItems.push(equipment(`m${i}`, 'mower', c.id, { maintenanceCostPerHour: 1.5, asset: finance(9000, 'owned') }));
    equipmentItems.push(equipment(`t${i}`, 'trimmer', c.id, { maintenanceCostPerHour: 0.4, asset: finance(600, 'owned') }));
  });
  equipmentItems.push(equipment('mspare', 'mower', null, { maintenanceCostPerHour: 1.5, asset: finance(9000, 'owned') }));
  const jobTypes: JobTypeDef[] = [
    jobType({
      id: 'mow',
      standardLaborHours: 1.6,
      basePrice: 65,
      materialCost: 2,
      equipmentFuelGalPerHour: 0.6,
      requiredEquipmentTypes: ['mower', 'trimmer'],
      weatherSensitive: true,
      seasonality: [0, 0, 0.5, 1, 1.2, 1.2, 1.1, 1, 1, 0.8, 0.4, 0],
      intervalDays: 7,
      lateAfterDays: 3,
      cancelAfterDays: 10,
    }),
    jobType({
      id: 'maint',
      standardLaborHours: 3,
      basePrice: 160,
      materialCost: 15,
      equipmentFuelGalPerHour: 0.3,
      requiredEquipmentTypes: ['trimmer'],
      minSkill: 2,
      seasonality: months(1),
      intervalDays: 30,
      lateAfterDays: 7,
      cancelAfterDays: 21,
    }),
    jobType({
      id: 'cleanup',
      kind: 'one-off',
      intervalDays: undefined,
      annualRatePerCustomer: 1.5,
      standardLaborHours: 6,
      basePrice: 420,
      materialCost: 40,
      minCrewSize: 2,
      minSkill: 2,
      splittable: true,
      weatherSensitive: true,
      seasonality: [0.2, 0.2, 1.5, 2, 1, 0.6, 0.5, 0.5, 0.7, 1.6, 1.8, 0.4],
      lateAfterDays: 7,
      cancelAfterDays: 20,
    }),
    jobType({
      id: 'install',
      kind: 'one-off',
      intervalDays: undefined,
      annualRatePerCustomer: 0.15,
      standardLaborHours: 14,
      basePrice: 2200,
      materialCost: 700,
      minCrewSize: 3,
      minSkill: 3,
      splittable: true,
      requiredEquipmentTypes: ['skid'],
      seasonality: months(1),
      lateAfterDays: 14,
      cancelAfterDays: 40,
    }),
  ];
  return deterministicCompany({
    startMonth: 3,
    jobTypes,
    crews,
    employees,
    vehicles,
    equipment: equipmentItems,
    customers: spiralCustomers(nCustomers, (i) => (i % 5 === 4 ? 'maint' : i % 7 === 6 ? null : 'mow')),
    pricing: { globalMultiplier: 1.05, byJobType: { maint: 0.95 } },
    policies: { ...det.policies, maxOvertimeHoursPerDay: 2, minPaidHoursPerShift: 4, rainoutPaidHours: 2, routing: 'nearest', autoBackfill: true },
    market: {
      ...det.market,
      organicLeadsPerMonth: 6,
      marketingMonthlySpend: 800,
      marketingMaxLeadsPerMonth: 10,
      marketingSpendScale: 1000,
      leadSeasonality: [0.5, 0.6, 1.2, 1.5, 1.3, 1, 0.9, 0.8, 0.9, 0.8, 0.6, 0.5],
      baseConversionRate: 0.35,
      acquisitionPriceElasticity: 1.2,
      baseMonthlyChurn: 0.03,
      retentionPriceElasticity: 1.5,
      priceIncreaseShockChurnPerPct: 0.004,
      serviceFailureChurnWeight: 0.8,
      serviceFailureHalfLifeDays: 30,
      newCustomer: { serviceRadiusMiles: 14, sizeFactorMin: 0.6, sizeFactorMax: 1.8, recurringJobTypeMix: { mow: 4, maint: 1 } },
    },
    workforce: {
      payrollBurdenRate: 0.18,
      overtimeMultiplier: 1.5,
      overtimeWeeklyThresholdHours: 40,
      absenceRate: 0.04,
      annualTurnoverRate: 0.6,
      timeToFillDays: 10,
      hiringCostPerHire: 900,
      rampDays: 30,
      rampStartProductivity: 0.6,
      crewSizeCoordinationLoss: 0.05,
      payPeriodDays: 14,
    },
    reliability: {
      vehicle: { dailyProb: 0.004, ageFactorPerYear: 0.2, repairDaysMin: 1, repairDaysMax: 4, repairCostMin: 200, repairCostMax: 1800 },
      equipment: { dailyProb: 0.008, ageFactorPerYear: 0.25, repairDaysMin: 1, repairDaysMax: 3, repairCostMin: 80, repairCostMax: 700 },
    },
    weather: {
      rainoutProbByMonth: [0.1, 0.1, 0.12, 0.12, 0.1, 0.08, 0.06, 0.06, 0.08, 0.1, 0.1, 0.1],
      partialProbByMonth: months(0.12),
      partialDayFraction: 0.5,
    },
    costs: {
      fuelPricePerGallon: 3.6,
      avgSpeedMph: 25,
      roadFactor: 1.3,
      stopOverheadHours: 0.15,
      overhead: [
        { id: 'rent', name: 'Yard rent', monthlyAmount: 1500 },
        { id: 'ins', name: 'Insurance', monthlyAmount: 700 },
      ],
    },
    finance: {
      startingCash: 15000,
      minCashReserve: 5000,
      lineOfCredit: { limit: 20000, annualRate: 0.11 },
      ar: { collectionDaysMean: 20, collectionDaysJitter: 0.5, badDebtRate: 0.02 },
      newLoan: { annualRate: 0.08, termMonths: 48, downPaymentFraction: 0.15 },
    },
  });
}
