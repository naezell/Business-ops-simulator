import type {
  AssetFinance,
  CompanyConfig,
  Crew,
  Customer,
  Employee,
  EquipmentItem,
  JobTypeDef,
  Vehicle,
} from '../../simulation/types';
import { equipmentCatalog } from './catalog';
import { landscapingJobTypes } from './jobTypes';

/*
 * Synthetic demonstration company: "GreenEdge Lawn & Landscape".
 * Every value is fabricated for demonstration. Deterministic: no randomness and
 * no dates, so repeated calls return equal objects.
 */

const CUSTOMER_COUNT = 190;
const CUSTOMERS_PER_CLUSTER = 32;
/** Neighbourhood cluster centres in miles from the depot. */
const CLUSTER_CENTRES: [number, number][] = [
  [2.0, 1.5],
  [-3.0, 2.5],
  [4.5, -2.0],
  [-1.5, -4.0],
  [-5.0, -1.0],
  [1.0, 5.5],
];
const GOLDEN_ANGLE_RADIANS = 2.399963;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function cloneJobType(jobType: JobTypeDef): JobTypeDef {
  return {
    ...jobType,
    requiredEquipmentTypes: [...jobType.requiredEquipmentTypes],
    seasonality: [...jobType.seasonality],
  };
}

function buildCustomers(count: number): Customer[] {
  const customers: Customer[] = [];
  for (let i = 0; i < count; i++) {
    const cluster = Math.min(CLUSTER_CENTRES.length - 1, Math.floor(i / CUSTOMERS_PER_CLUSTER));
    const k = i - cluster * CUSTOMERS_PER_CLUSTER;
    const [cx, cy] = CLUSTER_CENTRES[cluster];
    const r = 0.12 * Math.sqrt(k + 1);
    const theta = k * GOLDEN_ANGLE_RADIANS;
    let recurringJobTypeId: string | null;
    if (i % 19 === 18) recurringJobTypeId = null;
    else if (i % 6 === 5) recurringJobTypeId = 'mow-biweekly';
    else recurringJobTypeId = 'mow-weekly';
    customers.push({
      id: `c${String(i + 1).padStart(3, '0')}`,
      name: `Customer ${String(i + 1).padStart(3, '0')}`,
      x: roundTo(cx + r * Math.cos(theta), 3),
      y: roundTo(cy + r * Math.sin(theta), 3),
      sizeFactor: roundTo(0.7 + 0.9 * ((i * 0.754877) % 1), 2),
      recurringJobTypeId,
      phase: roundTo((i * 0.618034) % 1, 4),
    });
  }
  return customers;
}

function catalogEquipment(catalogId: string) {
  const spec = equipmentCatalog.find((item) => item.id === catalogId);
  if (!spec) throw new Error(`Unknown equipment catalog id: ${catalogId}`);
  return spec;
}

function ownedAsset(
  spec: { purchasePrice: number; usefulLifeYears: number; salvageValue: number },
  ageYears: number,
): AssetFinance {
  return {
    purchasePrice: spec.purchasePrice,
    usefulLifeYears: spec.usefulLifeYears,
    salvageValue: spec.salvageValue,
    ageYears,
    financing: { kind: 'owned' },
  };
}

function equipmentItem(
  id: string,
  catalogId: string,
  crewId: string | null,
  ageYears: number,
  name?: string,
): EquipmentItem {
  const spec = catalogEquipment(catalogId);
  return {
    id,
    name: name ?? spec.name,
    equipmentTypeId: spec.equipmentTypeId,
    crewId,
    maintenanceCostPerHour: spec.maintenanceCostPerHour,
    asset: ownedAsset(spec, ageYears),
  };
}

export function createSampleCompany(): CompanyConfig {
  const employees: Employee[] = [
    { id: 'e1', name: 'Marcus (lead)', hourlyWage: 24, skill: 3, productivity: 1.1, crewId: 'crew-a', tenureDays: 1400 },
    { id: 'e2', name: 'Diego', hourlyWage: 18, skill: 1, productivity: 1.05, crewId: 'crew-a', tenureDays: 600 },
    { id: 'e3', name: 'Tyler', hourlyWage: 17, skill: 1, productivity: 1.0, crewId: 'crew-a', tenureDays: 120 },
    { id: 'e4', name: 'Renee (lead)', hourlyWage: 24, skill: 3, productivity: 1.1, crewId: 'crew-b', tenureDays: 900 },
    { id: 'e5', name: 'Sam', hourlyWage: 18, skill: 1, productivity: 1.05, crewId: 'crew-b', tenureDays: 400 },
    { id: 'e6', name: 'Jordan', hourlyWage: 17, skill: 1, productivity: 0.9, crewId: 'crew-b', tenureDays: 30 },
    { id: 'e7', name: 'Alicia (lead)', hourlyWage: 26, skill: 3, productivity: 1.15, crewId: 'crew-c', tenureDays: 1100 },
    { id: 'e8', name: 'Ben', hourlyWage: 20, skill: 2, productivity: 1.05, crewId: 'crew-c', tenureDays: 500 },
  ];

  const crews: Crew[] = [
    { id: 'crew-a', name: 'Maintenance A', vehicleId: 'truck-1' },
    { id: 'crew-b', name: 'Maintenance B', vehicleId: 'truck-2' },
    { id: 'crew-c', name: 'Enhancement', vehicleId: 'truck-3' },
  ];

  const vehicles: Vehicle[] = [
    {
      id: 'truck-1',
      name: 'Truck 1 (2023)',
      seats: 3,
      mpg: 14,
      maintenanceCostPerMile: 0.14,
      asset: {
        purchasePrice: 46000,
        usefulLifeYears: 8,
        salvageValue: 9000,
        ageYears: 2,
        financing: { kind: 'loan', balance: 27000, annualRate: 0.079, monthsRemaining: 40 },
      },
    },
    {
      id: 'truck-2',
      name: 'Truck 2 (2020)',
      seats: 3,
      mpg: 13,
      maintenanceCostPerMile: 0.18,
      asset: ownedAsset({ purchasePrice: 42000, usefulLifeYears: 8, salvageValue: 8000 }, 5),
    },
    {
      id: 'truck-3',
      name: 'Truck 3 (2017)',
      seats: 3,
      mpg: 12,
      maintenanceCostPerMile: 0.24,
      asset: ownedAsset({ purchasePrice: 38000, usefulLifeYears: 8, salvageValue: 7000 }, 8),
    },
  ];

  const equipment: EquipmentItem[] = [
    equipmentItem('eq-a-mower', 'mower-zt', 'crew-a', 2),
    equipmentItem('eq-a-trimmer', 'trimmer-pro', 'crew-a', 1),
    equipmentItem('eq-a-blower', 'blower-pro', 'crew-a', 1),
    equipmentItem('eq-b-mower', 'mower-zt', 'crew-b', 4),
    equipmentItem('eq-b-trimmer', 'trimmer-pro', 'crew-b', 2),
    equipmentItem('eq-b-blower', 'blower-pro', 'crew-b', 2),
    equipmentItem('eq-c-trimmer', 'trimmer-pro', 'crew-c', 1),
    equipmentItem('eq-c-blower', 'blower-pro', 'crew-c', 1),
    equipmentItem('eq-c-hedge', 'hedge-pro', 'crew-c', 1),
    equipmentItem('eq-c-aerator', 'aerator-walk', 'crew-c', 3),
    equipmentItem('eq-c-trailer', 'trailer-dump', 'crew-c', 4),
    equipmentItem('eq-spare-mower', 'mower-zt', null, 6, 'Spare mower (old)'),
  ];

  return {
    industryId: 'landscaping',
    name: 'GreenEdge Lawn & Landscape',
    startMonth: 0,
    jobTypes: landscapingJobTypes.map(cloneJobType),
    employees,
    crews,
    vehicles,
    equipment,
    customers: buildCustomers(CUSTOMER_COUNT),
    pricing: {
      globalMultiplier: 1,
      byJobType: {},
    },
    policies: {
      shiftHours: 8,
      workDaysPerWeek: 5,
      maxOvertimeHoursPerDay: 1.5,
      minPaidHoursPerShift: 4,
      rainoutPaidHours: 2,
      routing: 'nearest',
      autoBackfill: true,
      acceptNewCustomers: true,
    },
    market: {
      organicLeadsPerMonth: 6,
      marketingMonthlySpend: 600,
      marketingMaxLeadsPerMonth: 14,
      marketingSpendScale: 1500,
      leadSeasonality: [0.6, 0.8, 1.5, 1.6, 1.3, 1, 0.8, 0.7, 0.9, 1, 0.9, 0.9],
      baseConversionRate: 0.35,
      acquisitionPriceElasticity: 2.5,
      baseMonthlyChurn: 0.015,
      retentionPriceElasticity: 2.5,
      priceIncreaseShockChurnPerPct: 0.006,
      serviceFailureChurnWeight: 0.6,
      serviceFailureHalfLifeDays: 30,
      newCustomer: {
        serviceRadiusMiles: 7,
        sizeFactorMin: 0.7,
        sizeFactorMax: 1.6,
        recurringJobTypeMix: { 'mow-weekly': 0.8, 'mow-biweekly': 0.2 },
      },
    },
    workforce: {
      payrollBurdenRate: 0.22,
      overtimeMultiplier: 1.5,
      overtimeWeeklyThresholdHours: 40,
      absenceRate: 0.03,
      annualTurnoverRate: 0.35,
      timeToFillDays: 14,
      hiringCostPerHire: 1200,
      rampDays: 45,
      rampStartProductivity: 0.6,
      crewSizeCoordinationLoss: 0.05,
      payPeriodDays: 14,
    },
    reliability: {
      vehicle: {
        dailyProb: 0.004,
        ageFactorPerYear: 0.25,
        repairDaysMin: 1,
        repairDaysMax: 4,
        repairCostMin: 300,
        repairCostMax: 1800,
      },
      equipment: {
        dailyProb: 0.006,
        ageFactorPerYear: 0.3,
        repairDaysMin: 1,
        repairDaysMax: 3,
        repairCostMin: 80,
        repairCostMax: 600,
      },
    },
    weather: {
      rainoutProbByMonth: [0.07, 0.08, 0.11, 0.12, 0.11, 0.09, 0.07, 0.07, 0.07, 0.07, 0.07, 0.08],
      partialProbByMonth: [0.1, 0.1, 0.13, 0.14, 0.13, 0.11, 0.1, 0.1, 0.1, 0.09, 0.09, 0.1],
      partialDayFraction: 0.5,
    },
    costs: {
      fuelPricePerGallon: 3.6,
      avgSpeedMph: 25,
      roadFactor: 1.3,
      stopOverheadHours: 0.05,
      overhead: [
        { id: 'owner-salary', name: 'Owner salary', monthlyAmount: 5000 },
        { id: 'office-admin', name: 'Office admin (part-time)', monthlyAmount: 2200 },
        { id: 'insurance', name: 'Insurance', monthlyAmount: 1200 },
        { id: 'shop-rent', name: 'Shop & yard rent', monthlyAmount: 1500 },
        { id: 'software', name: 'Software & phones', monthlyAmount: 400 },
        { id: 'misc', name: 'Miscellaneous', monthlyAmount: 400 },
      ],
    },
    finance: {
      startingCash: 45000,
      minCashReserve: 15000,
      lineOfCredit: { limit: 40000, annualRate: 0.11 },
      ar: {
        collectionDaysMean: 21,
        collectionDaysJitter: 0.5,
        badDebtRate: 0.01,
      },
      newLoan: { annualRate: 0.085, termMonths: 60, downPaymentFraction: 0.15 },
    },
  };
}
