import type {
  AssetFinance,
  Crew,
  Customer,
  Employee,
  EquipmentItem,
  Financing,
  Id,
  JobTypeDef,
  Vehicle,
} from '../../simulation/types';
import type { TwinScenario } from '../../simulation/types-twin';
import type { DemoScenarioDef } from '../types';
import { equipmentCatalog, vehicleCatalog } from './catalog';
import { landscapingJobTypes } from './jobTypes';

/*
 * Synthetic demonstration scenario "twin-90": a 90-day spring crunch starting in March.
 *
 * ALL VALUES IN THIS FILE ARE SYNTHETIC, ILLUSTRATIVE ASSUMPTIONS. They are fabricated to
 * exercise the digital-twin mechanisms. They are not calibrated to any real business, are not
 * verified calculations, and are not benchmarks or industry averages. Calibration will tune them.
 *
 * Deterministic: no randomness and no dates. Every call returns a fresh object that is deep-equal
 * to the previous one, so callers may mutate their copy without affecting later calls.
 */

// ───────────────────────── Scenario-level constants ─────────────────────────

const SCENARIO_ID = 'twin-90';
const SCENARIO_NAME = 'Spring crunch (90 days)';
const SCENARIO_DESCRIPTION =
  'Synthetic demonstration data: a fabricated 90-day spring scenario starting in March, with 20 employees, six crews and 100 customers. Illustrative assumptions only, not calibrated to a real business and not a benchmark or industry average.';
const START_MONTH_MARCH = 2;
const HORIZON_DAYS = 90;
const SEED = 1;
const COMPANY_NAME = 'GreenEdge Lawn & Landscape (demo)';

// ───────────────────────── Customer base ─────────────────────────

const CUSTOMER_COUNT = 100;
/** ceil(100 / 6): five full clusters of 17 and a final cluster of 15. */
const CUSTOMERS_PER_CLUSTER = 17;
/** Neighbourhood cluster centres in miles from the depot (same centres as the sample company). */
const CLUSTER_CENTRES: [number, number][] = [
  [2.0, 1.5],
  [-3.0, 2.5],
  [4.5, -2.0],
  [-1.5, -4.0],
  [-5.0, -1.0],
  [1.0, 5.5],
];
const GOLDEN_ANGLE_RADIANS = 2.399963;
/**
 * Segment and plan by slot. The index i uses slot = i % 10, so each block of ten customers holds
 * 6 residential (slots 0–5), 3 commercial (slots 6–8) and 1 large site (slot 9).
 * Plans by slot: residential weekly, weekly, weekly, biweekly, weekly, none;
 * commercial weekly, weekly, biweekly; large site weekly.
 */
const PLAN_BY_SLOT: (Id | null)[] = [
  'mow-weekly',
  'mow-weekly',
  'mow-weekly',
  'mow-biweekly',
  'mow-weekly',
  null,
  'mow-weekly',
  'mow-weekly',
  'mow-biweekly',
  'mow-weekly',
];
/** Size-factor range per segment: sizeFactor = min + span × fraction, fraction in [0, 1). */
const SIZE_FACTOR = {
  residential: { min: 0.8, span: 1.0 },
  commercial: { min: 3, span: 5 },
  largeSite: { min: 10, span: 8 },
} as const;

// ───────────────────────── Helpers ─────────────────────────

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Calibration (task C2): one-off demand of this demo company relative to the landscaping job-type
 * defaults (illustrative assumptions). A busier spring book than the sample company.
 */
const DEMO_ONE_OFF_RATE_FACTOR: Record<Id, number> = { cleanup: 2.2, mulch: 2.5, aeration: 2, pruning: 1.6, install: 1.3 };

function cloneJobType(jobType: JobTypeDef): JobTypeDef {
  const f = DEMO_ONE_OFF_RATE_FACTOR[jobType.id];
  return {
    ...jobType,
    requiredEquipmentTypes: [...jobType.requiredEquipmentTypes],
    seasonality: [...jobType.seasonality],
    ...(f !== undefined && jobType.annualRatePerCustomer !== undefined ? { annualRatePerCustomer: jobType.annualRatePerCustomer * f } : {}),
  };
}

function ownedAsset(purchasePrice: number, usefulLifeYears: number, salvageValue: number, ageYears: number): AssetFinance {
  return { purchasePrice, usefulLifeYears, salvageValue, ageYears, financing: { kind: 'owned' } };
}

function vehicleItem(id: Id, catalogId: Id, ageYears: number, financing: Financing): Vehicle {
  const spec = vehicleCatalog.find((item) => item.id === catalogId);
  if (!spec) throw new Error(`Unknown vehicle catalog id: ${catalogId}`);
  return {
    id,
    name: `${spec.name} (${id})`,
    seats: spec.seats,
    mpg: spec.mpg,
    maintenanceCostPerMile: spec.maintenanceCostPerMile,
    asset: {
      purchasePrice: spec.purchasePrice,
      usefulLifeYears: spec.usefulLifeYears,
      salvageValue: spec.salvageValue,
      ageYears,
      financing,
    },
  };
}

function equipmentItem(id: Id, catalogId: Id, crewId: Id, ageYears: number): EquipmentItem {
  const spec = equipmentCatalog.find((item) => item.id === catalogId);
  if (!spec) throw new Error(`Unknown equipment catalog id: ${catalogId}`);
  return {
    id,
    name: spec.name,
    equipmentTypeId: spec.equipmentTypeId,
    crewId,
    maintenanceCostPerHour: spec.maintenanceCostPerHour,
    asset: ownedAsset(spec.purchasePrice, spec.usefulLifeYears, spec.salvageValue, ageYears),
  };
}

// ───────────────────────── Fleet and people ─────────────────────────

/** Six crews, one vehicle each, no spare vehicle: four maintenance, one enhancement, one installation. */
function buildCrews(): Crew[] {
  return [
    { id: 'crew-m1', name: 'Maintenance 1', vehicleId: 'truck-m1' },
    { id: 'crew-m2', name: 'Maintenance 2', vehicleId: 'truck-m2' },
    { id: 'crew-m3', name: 'Maintenance 3', vehicleId: 'truck-m3' },
    { id: 'crew-m4', name: 'Maintenance 4', vehicleId: 'truck-m4' },
    { id: 'crew-e1', name: 'Enhancement', vehicleId: 'truck-e1' },
    { id: 'crew-i1', name: 'Installation', vehicleId: 'truck-i1' },
  ];
}

function buildVehicles(): Vehicle[] {
  return [
    vehicleItem('truck-m1', 'truck-new', 1, { kind: 'owned' }),
    vehicleItem('truck-m2', 'truck-used', 2, { kind: 'owned' }),
    vehicleItem('truck-m3', 'truck-used', 3, { kind: 'loan', balance: 11000, annualRate: 0.079, monthsRemaining: 24 }),
    vehicleItem('truck-m4', 'truck-new', 4, { kind: 'owned' }),
    vehicleItem('truck-e1', 'truck-crewcab', 2, { kind: 'lease', monthlyPayment: 890 }),
    vehicleItem('truck-i1', 'truck-new', 5, { kind: 'owned' }),
  ];
}

/**
 * 20 employees: 18 crew members (three per crew) and two unassigned floaters.
 * Wages: skill 1 $17–18, skill 2 $19–20, skill 3 $24–26 (illustrative). Tenure is in days at day 0.
 */
/** Calibration (C2): wages relative to the first-guess list below (illustrative 2026 pay levels). */
const DEMO_WAGE_FACTOR = 1.25;

function buildEmployees(): Employee[] {
  return baseEmployees().map((e) => ({ ...e, hourlyWage: roundTo(e.hourlyWage * DEMO_WAGE_FACTOR, 2) }));
}

function baseEmployees(): Employee[] {
  return [
    { id: 'e01', name: 'M1 lead', hourlyWage: 24, skill: 3, productivity: 1.1, crewId: 'crew-m1', tenureDays: 1400 },
    { id: 'e02', name: 'M1 member 2', hourlyWage: 20, skill: 2, productivity: 1.05, crewId: 'crew-m1', tenureDays: 600 },
    { id: 'e03', name: 'M1 member 3', hourlyWage: 17, skill: 1, productivity: 1.0, crewId: 'crew-m1', tenureDays: 120 },
    { id: 'e04', name: 'M2 lead', hourlyWage: 24, skill: 3, productivity: 1.1, crewId: 'crew-m2', tenureDays: 900 },
    { id: 'e05', name: 'M2 member 2', hourlyWage: 20, skill: 2, productivity: 1.05, crewId: 'crew-m2', tenureDays: 400 },
    { id: 'e06', name: 'M2 member 3', hourlyWage: 17, skill: 1, productivity: 0.9, crewId: 'crew-m2', tenureDays: 30 },
    { id: 'e07', name: 'M3 lead', hourlyWage: 26, skill: 3, productivity: 1.15, crewId: 'crew-m3', tenureDays: 1100 },
    { id: 'e08', name: 'M3 member 2', hourlyWage: 20, skill: 2, productivity: 1.05, crewId: 'crew-m3', tenureDays: 500 },
    { id: 'e09', name: 'M3 member 3', hourlyWage: 18, skill: 1, productivity: 1.0, crewId: 'crew-m3', tenureDays: 250 },
    { id: 'e10', name: 'M4 lead', hourlyWage: 25, skill: 3, productivity: 1.05, crewId: 'crew-m4', tenureDays: 700 },
    { id: 'e11', name: 'M4 member 2', hourlyWage: 20, skill: 2, productivity: 1.0, crewId: 'crew-m4', tenureDays: 450 },
    { id: 'e12', name: 'M4 member 3', hourlyWage: 17, skill: 1, productivity: 1.0, crewId: 'crew-m4', tenureDays: 90 },
    { id: 'e13', name: 'Enhancement lead', hourlyWage: 25, skill: 3, productivity: 1.1, crewId: 'crew-e1', tenureDays: 800 },
    { id: 'e14', name: 'Enhancement member 2', hourlyWage: 20, skill: 2, productivity: 1.0, crewId: 'crew-e1', tenureDays: 450 },
    { id: 'e15', name: 'Enhancement member 3', hourlyWage: 19, skill: 2, productivity: 1.05, crewId: 'crew-e1', tenureDays: 200 },
    { id: 'e16', name: 'Install lead', hourlyWage: 25, skill: 3, productivity: 1.1, crewId: 'crew-i1', tenureDays: 1000 },
    { id: 'e17', name: 'Install member 2', hourlyWage: 18, skill: 1, productivity: 1.0, crewId: 'crew-i1', tenureDays: 180 },
    { id: 'e18', name: 'Install member 3', hourlyWage: 20, skill: 2, productivity: 1.0, crewId: 'crew-i1', tenureDays: 300 },
    { id: 'e19', name: 'Floater 1', hourlyWage: 17, skill: 1, productivity: 1.0, crewId: null, tenureDays: 60 },
    { id: 'e20', name: 'Floater 2', hourlyWage: 20, skill: 2, productivity: 1.0, crewId: null, tenureDays: 15 },
  ];
}

/**
 * Equipment kits. Each job type has at least one crew that meets its equipment, skill and crew-size
 * requirements (checked in tests/unit/demo-twin-data.test.ts).
 */
function buildEquipment(): EquipmentItem[] {
  return [
    equipmentItem('eq-m1-mower', 'mower-zt', 'crew-m1', 2),
    equipmentItem('eq-m1-trimmer', 'trimmer-pro', 'crew-m1', 1),
    equipmentItem('eq-m1-blower', 'blower-pro', 'crew-m1', 1),
    equipmentItem('eq-m1-hedge', 'hedge-pro', 'crew-m1', 1),
    equipmentItem('eq-m2-mower', 'mower-zt', 'crew-m2', 4),
    equipmentItem('eq-m2-trimmer', 'trimmer-pro', 'crew-m2', 2),
    equipmentItem('eq-m2-blower', 'blower-pro', 'crew-m2', 2),
    equipmentItem('eq-m2-hedge', 'hedge-pro', 'crew-m2', 2),
    equipmentItem('eq-m3-mower', 'mower-zt', 'crew-m3', 1),
    equipmentItem('eq-m3-trimmer', 'trimmer-pro', 'crew-m3', 1),
    equipmentItem('eq-m3-blower', 'blower-pro', 'crew-m3', 1),
    equipmentItem('eq-m3-hedge', 'hedge-pro', 'crew-m3', 1),
    equipmentItem('eq-m4-mower', 'mower-zt', 'crew-m4', 3),
    equipmentItem('eq-m4-trimmer', 'trimmer-pro', 'crew-m4', 2),
    equipmentItem('eq-m4-blower', 'blower-pro', 'crew-m4', 2),
    equipmentItem('eq-m4-hedge', 'hedge-pro', 'crew-m4', 3),
    equipmentItem('eq-e1-trimmer', 'trimmer-pro', 'crew-e1', 1),
    equipmentItem('eq-e1-blower', 'blower-pro', 'crew-e1', 1),
    equipmentItem('eq-e1-hedge', 'hedge-pro', 'crew-e1', 1),
    equipmentItem('eq-e1-aerator', 'aerator-walk', 'crew-e1', 3),
    equipmentItem('eq-e1-trailer', 'trailer-dump', 'crew-e1', 4),
    equipmentItem('eq-i1-trailer', 'trailer-dump', 'crew-i1', 2),
    equipmentItem('eq-i1-blower', 'blower-pro', 'crew-i1', 1),
    equipmentItem('eq-i1-trimmer', 'trimmer-pro', 'crew-i1', 1),
  ];
}

// ───────────────────────── Customers ─────────────────────────

type Segment = 'residential' | 'commercial' | 'largeSite';

function segmentOfSlot(slot: number): Segment {
  if (slot < 6) return 'residential';
  if (slot < 9) return 'commercial';
  return 'largeSite';
}

/** Positions use the sample company's cluster formula; size and phase use the same fractional pattern. */
function buildCustomers(count: number): Customer[] {
  const customers: Customer[] = [];
  const segmentCounters: Record<Segment, number> = { residential: 0, commercial: 0, largeSite: 0 };
  const segmentLabels: Record<Segment, string> = { residential: 'Residential', commercial: 'Commercial', largeSite: 'Large site' };
  for (let i = 0; i < count; i++) {
    const cluster = Math.min(CLUSTER_CENTRES.length - 1, Math.floor(i / CUSTOMERS_PER_CLUSTER));
    const k = i - cluster * CUSTOMERS_PER_CLUSTER;
    const [cx, cy] = CLUSTER_CENTRES[cluster];
    const r = 0.12 * Math.sqrt(k + 1);
    const theta = k * GOLDEN_ANGLE_RADIANS;

    const slot = i % 10;
    const segment = segmentOfSlot(slot);
    segmentCounters[segment] += 1;
    const range = SIZE_FACTOR[segment];
    const fraction = (i * 0.754877) % 1;

    customers.push({
      id: `c${String(i + 1).padStart(3, '0')}`,
      name: `${segmentLabels[segment]} ${String(segmentCounters[segment]).padStart(3, '0')}`,
      x: roundTo(cx + r * Math.cos(theta), 3),
      y: roundTo(cy + r * Math.sin(theta), 3),
      sizeFactor: roundTo(range.min + range.span * fraction, 2),
      recurringJobTypeId: PLAN_BY_SLOT[slot],
      phase: roundTo((i * 0.618034) % 1, 4),
    });
  }
  return customers;
}

// ───────────────────────── Scenario ─────────────────────────

/** Builds the synthetic `twin-90` demonstration scenario. Deterministic; every call returns fresh objects. */
export function createDemoTwinScenario(): TwinScenario {
  return {
    id: SCENARIO_ID,
    name: SCENARIO_NAME,
    horizonDays: HORIZON_DAYS,
    seed: SEED,
    actions: [],
    company: {
      industryId: 'landscaping',
      name: COMPANY_NAME,
      startMonth: START_MONTH_MARCH,
      jobTypes: landscapingJobTypes.map(cloneJobType),
      employees: buildEmployees(),
      crews: buildCrews(),
      vehicles: buildVehicles(),
      equipment: buildEquipment(),
      customers: buildCustomers(CUSTOMER_COUNT),
      pricing: { globalMultiplier: 1, byJobType: {} },
      // minPaidHoursPerShift 6 = 0.75 × shiftHours 8.
      policies: {
        shiftHours: 8,
        workDaysPerWeek: 5,
        maxOvertimeHoursPerDay: 0.5,
        minPaidHoursPerShift: 6,
        rainoutPaidHours: 2,
        routing: 'nearest',
        autoBackfill: true,
        acceptNewCustomers: true,
        // Illustrative: idle members of crews that cannot deploy may float onto deployed crews.
        floatIdleWorkers: true,
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
        oneOffPriceElasticity: 1.5,
        priceIncreaseShockChurnPerPct: 0.006,
        serviceFailureChurnWeight: 0.6,
        serviceFailureHalfLifeDays: 30,
        newCustomer: {
          serviceRadiusMiles: 7,
          sizeFactorMin: 0.7,
          sizeFactorMax: 1.6,
          recurringJobTypeMix: { 'mow-weekly': 0.8, 'mow-biweekly': 0.2 },
        },
        // Illustrative twin dynamics. Referral and market-size values are assumptions, not market data.
        referralsPerCustomerYear: 0.1,
        marketSize: 400,
        newCustomerChurnBoost: 1.0,
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
        // Illustrative twin dynamics. marketWageBySkill index = skill; index 0 is unused and mirrors skill 1.
        learningGain: 0.15,
        learningDays: 120,
        fatigueThresholdHours: 45,
        quitFatigueWeight: 1.5,
        absenceFatigueWeight: 1.0,
        productivityFatigueLoss: 0.5,
        wageQuitElasticity: 1.5,
        marketWageBySkill: [17.5, 17.5, 20, 24].map((w) => roundTo(w * DEMO_WAGE_FACTOR, 2)),
        earlyTenureQuitBoost: 1.0,
        annualRaiseRate: 0.03,
      },
      reliability: {
        vehicle: {
          dailyProb: 0.004,
          ageFactorPerYear: 0.25,
          repairDaysMin: 1,
          repairDaysMax: 4,
          repairCostMin: 300,
          repairCostMax: 1800,
          // Illustrative: routine maintenance cost grows 10% per year of age.
          maintenanceAgeFactorPerYear: 0.1,
        },
        equipment: {
          dailyProb: 0.006,
          ageFactorPerYear: 0.3,
          repairDaysMin: 1,
          repairDaysMax: 3,
          repairCostMin: 80,
          repairCostMax: 600,
          // Illustrative: routine maintenance cost grows 10% per year of age.
          maintenanceAgeFactorPerYear: 0.1,
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
          // Calibrated (C2) for a 20-person company: illustrative, not quotes.
          { id: 'owner-salary', name: 'Owner salary', monthlyAmount: 7000 },
          { id: 'ops-manager', name: 'Operations manager', monthlyAmount: 5500 },
          { id: 'office-admin', name: 'Office admin', monthlyAmount: 3600 },
          { id: 'insurance', name: 'Insurance', monthlyAmount: 2800 },
          { id: 'shop-rent', name: 'Shop & yard rent', monthlyAmount: 2600 },
          { id: 'software', name: 'Software & phones', monthlyAmount: 700 },
          { id: 'misc', name: 'Miscellaneous', monthlyAmount: 1000 },
        ],
      },
      finance: {
        startingCash: 110000,
        minCashReserve: 30000,
        lineOfCredit: { limit: 40000, annualRate: 0.11 },
        ar: {
          collectionDaysMean: 21,
          collectionDaysJitter: 0.5,
          badDebtRate: 0.01,
        },
        newLoan: { annualRate: 0.085, termMonths: 60, downPaymentFraction: 0.15 },
        // Illustrative resale assumption for disposed assets. ownerDistributionCashAbove is omitted (never pays out).
        resaleShareOfBookValue: 0.8,
      },
    },
  };
}

export const demoTwinScenarios: DemoScenarioDef[] = [
  {
    id: SCENARIO_ID,
    name: SCENARIO_NAME,
    description: SCENARIO_DESCRIPTION,
    create: createDemoTwinScenario,
  },
];
