import type { EquipmentSpec, Id, VehicleSpec } from '../../simulation/types';
import type { EquipmentTypeDef, HireTemplate, IndustryDefinition } from '../types';

/** Equipment type ids referenced by job types and by equipment items. */
export const equipmentTypes: EquipmentTypeDef[] = [
  { id: 'mower', name: 'Mower' },
  { id: 'trimmer', name: 'Trimmer' },
  { id: 'blower', name: 'Blower' },
  { id: 'hedge-trimmer', name: 'Hedge trimmer' },
  { id: 'aerator', name: 'Aerator' },
  { id: 'dump-trailer', name: 'Dump trailer' },
];

/** Illustrative purchase/lease options. Synthetic values, not quotes. */
export const vehicleCatalog: (VehicleSpec & { id: Id })[] = [
  {
    id: 'truck-new',
    name: 'New crew truck',
    seats: 3,
    mpg: 14,
    maintenanceCostPerMile: 0.14,
    purchasePrice: 48000,
    usefulLifeYears: 8,
    salvageValue: 9000,
    leaseMonthly: 780,
  },
  {
    id: 'truck-used',
    name: 'Used crew truck',
    seats: 3,
    mpg: 13,
    maintenanceCostPerMile: 0.22,
    purchasePrice: 24000,
    usefulLifeYears: 5,
    salvageValue: 5000,
    leaseMonthly: 520,
  },
  {
    id: 'truck-crewcab',
    name: 'Crew-cab truck',
    seats: 5,
    mpg: 12,
    maintenanceCostPerMile: 0.16,
    purchasePrice: 56000,
    usefulLifeYears: 8,
    salvageValue: 10000,
    leaseMonthly: 890,
  },
];

export const equipmentCatalog: (EquipmentSpec & { id: Id })[] = [
  {
    id: 'mower-zt',
    name: 'Zero-turn mower',
    equipmentTypeId: 'mower',
    maintenanceCostPerHour: 2.2,
    purchasePrice: 11500,
    usefulLifeYears: 5,
    salvageValue: 1500,
    leaseMonthly: 260,
  },
  {
    id: 'trimmer-pro',
    name: 'String trimmer',
    equipmentTypeId: 'trimmer',
    maintenanceCostPerHour: 0.4,
    purchasePrice: 380,
    usefulLifeYears: 3,
    salvageValue: 0,
    leaseMonthly: 15,
  },
  {
    id: 'blower-pro',
    name: 'Backpack blower',
    equipmentTypeId: 'blower',
    maintenanceCostPerHour: 0.4,
    purchasePrice: 520,
    usefulLifeYears: 3,
    salvageValue: 0,
    leaseMonthly: 20,
  },
  {
    id: 'hedge-pro',
    name: 'Hedge trimmer',
    equipmentTypeId: 'hedge-trimmer',
    maintenanceCostPerHour: 0.4,
    purchasePrice: 450,
    usefulLifeYears: 3,
    salvageValue: 0,
    leaseMonthly: 18,
  },
  {
    id: 'aerator-walk',
    name: 'Walk-behind aerator',
    equipmentTypeId: 'aerator',
    maintenanceCostPerHour: 1.8,
    purchasePrice: 4200,
    usefulLifeYears: 6,
    salvageValue: 400,
    leaseMonthly: 110,
  },
  {
    id: 'trailer-dump',
    name: 'Dump trailer',
    equipmentTypeId: 'dump-trailer',
    maintenanceCostPerHour: 0.6,
    purchasePrice: 9800,
    usefulLifeYears: 10,
    salvageValue: 2000,
    leaseMonthly: 190,
  },
];

/** Illustrative hourly wage and productivity assumptions for new hires. */
export const hireTemplates: HireTemplate[] = [
  { id: 'laborer', title: 'Crew member', hourlyWage: 17, skill: 1, productivity: 1.0 },
  { id: 'experienced', title: 'Experienced technician', hourlyWage: 20, skill: 2, productivity: 1.05 },
  { id: 'lead', title: 'Crew lead', hourlyWage: 25, skill: 3, productivity: 1.1 },
];

export const standardCrew: IndustryDefinition['standardCrew'] = {
  hireTemplateIds: ['lead', 'laborer', 'laborer'],
  vehicleCatalogId: 'truck-new',
  equipmentCatalogIds: ['mower-zt', 'trimmer-pro', 'blower-pro'],
};
