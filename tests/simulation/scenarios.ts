/** Shared test scenarios built on helpers.ts. */
import type { PlannedAction, Scenario, VehicleSpec, EquipmentSpec } from '../../src/simulation';
import { customer, deterministicCompany, scenario, stochasticCompany, vehicle, equipment } from './helpers';

export function tinyDeterministic(): Scenario {
  return scenario(
    deterministicCompany({
      customers: [customer('a', 3, 4), customer('b', -6, 8, 'mow', { phase: 0.5 }), customer('c', 0, -5, 'mow', { sizeFactor: 2 })],
      costs: { fuelPricePerGallon: 3, avgSpeedMph: 30, roadFactor: 1.2, stopOverheadHours: 0.1, overhead: [{ id: 'o', name: 'o', monthlyAmount: 365 }] },
    }),
    { horizonDays: 45 },
  );
}

export function stochasticMid(seed: number): Scenario {
  return scenario(stochasticCompany(60, 2), { horizonDays: 240, seed });
}

export function financedAndLeased(): Scenario {
  const base = stochasticCompany(30, 1);
  return scenario(
    {
      ...base,
      vehicles: [
        vehicle('v1', {
          mpg: 15,
          asset: {
            purchasePrice: 42000,
            usefulLifeYears: 6,
            salvageValue: 6000,
            ageYears: 1.5,
            financing: { kind: 'loan', balance: 25000, annualRate: 0.075, monthsRemaining: 5 },
          },
        }),
        vehicle('v2', {
          mpg: 16,
          asset: { purchasePrice: 35000, usefulLifeYears: 6, salvageValue: 5000, ageYears: 0, financing: { kind: 'lease', monthlyPayment: 610 } },
        }),
      ],
      equipment: [
        equipment('m0', 'mower', 'c1', {
          asset: { purchasePrice: 8000, usefulLifeYears: 0.2, salvageValue: 1000, ageYears: 0.1, financing: { kind: 'owned' } },
        }),
        equipment('t0', 'trimmer', 'c1', {
          asset: { purchasePrice: 900, usefulLifeYears: 4, salvageValue: 0, ageYears: 0, financing: { kind: 'lease', monthlyPayment: 25 } },
        }),
      ],
    },
    { horizonDays: 200, seed: 11 },
  );
}

export const truckSpec: VehicleSpec = {
  name: 'Truck',
  seats: 3,
  mpg: 15,
  maintenanceCostPerMile: 0.1,
  purchasePrice: 40000,
  usefulLifeYears: 6,
  salvageValue: 8000,
  leaseMonthly: 700,
};

export const mowerSpec: EquipmentSpec = {
  name: 'Mower',
  equipmentTypeId: 'mower',
  maintenanceCostPerHour: 1.2,
  purchasePrice: 9000,
  usefulLifeYears: 5,
  salvageValue: 1500,
  leaseMonthly: 220,
};

/** Every action type (and some rejections) at mixed days. */
export function allActions(): Scenario {
  const actions: PlannedAction[] = [
    { day: 0, action: { type: 'set-marketing-spend', monthlySpend: 1500 } },
    { day: 3, action: { type: 'hire-employee', crewId: 'c1', hire: { hourlyWage: 19, skill: 1, productivity: 0.9 } } },
    { day: 3, action: { type: 'hire-employee', crewId: 'nope', hire: { hourlyWage: 19, skill: 1, productivity: 0.9 } } },
    { day: 10, action: { type: 'set-price', jobTypeId: 'mow', multiplier: 1.15 } },
    {
      day: 15,
      action: {
        type: 'add-crew',
        name: 'Crew 3',
        hires: [
          { hourlyWage: 24, skill: 3, productivity: 1 },
          { hourlyWage: 18, skill: 2, productivity: 1 },
          { hourlyWage: 18, skill: 1, productivity: 1 },
        ],
        vehicle: { spec: truckSpec, method: 'loan' },
        equipment: [
          { spec: mowerSpec, method: 'cash' },
          { spec: { ...mowerSpec, name: 'Trimmer', equipmentTypeId: 'trimmer', purchasePrice: 700, salvageValue: 0 }, method: 'lease' },
          { spec: { ...mowerSpec, name: 'Skid steer', equipmentTypeId: 'skid', purchasePrice: 30000, salvageValue: 6000 }, method: 'loan' },
        ],
      },
    },
    { day: 20, action: { type: 'set-policy', patch: { routing: 'zoned', shiftHours: 9 } } },
    { day: 25, action: { type: 'acquire-vehicle', spec: truckSpec, method: 'cash', crewId: null } },
    { day: 26, action: { type: 'acquire-equipment', spec: mowerSpec, method: 'lease', crewId: 'c2' } },
    { day: 27, action: { type: 'acquire-equipment', spec: mowerSpec, method: 'loan', crewId: null } },
    { day: 31, action: { type: 'remove-employee', employeeId: 'e0b' } },
    { day: 31, action: { type: 'remove-employee', employeeId: 'ghost' } },
    { day: 40, action: { type: 'set-job-type-offered', jobTypeId: 'maint', offered: false } },
    { day: 50, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.2 } },
    { day: 60, action: { type: 'remove-crew', crewId: 'c2' } },
    { day: 60, action: { type: 'remove-crew', crewId: 'c2' } },
    { day: 70, action: { type: 'set-job-type-offered', jobTypeId: 'maint', offered: true } },
    { day: 75, action: { type: 'set-policy', patch: { routing: 'fifo', maxOvertimeHoursPerDay: 0 } } },
    { day: 80, action: { type: 'set-price', jobTypeId: 'mow', multiplier: 0.9 } },
    { day: 90, action: { type: 'acquire-vehicle', spec: truckSpec, method: 'lease', crewId: 'crew-d15-4' } },
  ];
  return scenario(stochasticCompany(70, 2), { horizonDays: 150, seed: 5, actions });
}
