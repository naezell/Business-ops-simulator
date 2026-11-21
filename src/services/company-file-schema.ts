import type { CompanyConfig, ValidationIssue } from '@/simulation';

type Fields = Record<string, Field>;
type Field =
  | { kind: 'number' | 'string' | 'id' | 'nullableId' | 'boolean' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'object'; fields: Fields }
  | { kind: 'array' | 'record'; entry: Field }
  | { kind: 'financing' }
  | { kind: 'optional'; entry: Field }
  | { kind: 'default'; entry: Field };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const n: Field = { kind: 'number' };
const str: Field = { kind: 'string' };
const id: Field = { kind: 'id' };
const nullableId: Field = { kind: 'nullableId' };
const bool: Field = { kind: 'boolean' };
const object = (fields: Fields): Field => ({ kind: 'object', fields });
const array = (entry: Field): Field => ({ kind: 'array', entry });
const optional = (entry: Field): Field => ({ kind: 'optional', entry });
const fallback = (entry: Field): Field => ({ kind: 'default', entry });
const choices = (...values: string[]): Field => ({ kind: 'enum', values });
const series = array(n);
const numericRecord: Field = { kind: 'record', entry: n };

/** Fields backed by this industry's illustrative parameter defaults. */
const assumedNumbers = (...keys: string[]): Fields => Object.fromEntries(keys.map((key) => [key, fallback(n)]));
const optionalNumbers = (...keys: string[]): Fields => Object.fromEntries(keys.map((key) => [key, optional(n)]));

const named = { id, name: str };
const asset = object({
  purchasePrice: n, usefulLifeYears: n, salvageValue: n, ageYears: n, financing: { kind: 'financing' },
});
const breakdown = fallback(object({
  ...assumedNumbers('dailyProb', 'ageFactorPerYear', 'repairDaysMin', 'repairDaysMax', 'repairCostMin', 'repairCostMax'),
  maintenanceAgeFactorPerYear: optional(n),
}));

const schema = object({
  industryId: id, name: str, startMonth: n,
  jobTypes: array(object({
    ...named, kind: choices('recurring', 'one-off'), standardLaborHours: n, basePrice: n, materialCost: n,
    equipmentFuelGalPerHour: n, requiredEquipmentTypes: array(id), minSkill: n, minCrewSize: n,
    weatherSensitive: bool, splittable: bool, seasonality: series, intervalDays: optional(n),
    annualRatePerCustomer: optional(n), lateAfterDays: n, cancelAfterDays: n, offered: bool,
  })),
  employees: array(object({
    ...named, hourlyWage: n, skill: n, productivity: fallback(n), crewId: nullableId, tenureDays: n,
  })),
  customers: array(object({
    ...named, x: n, y: n, sizeFactor: fallback(n), recurringJobTypeId: nullableId, phase: fallback(n),
  })),
  crews: array(object({ ...named, vehicleId: nullableId })),
  vehicles: array(object({ ...named, seats: n, mpg: n, maintenanceCostPerMile: n, asset })),
  equipment: array(object({ ...named, equipmentTypeId: id, crewId: nullableId, maintenanceCostPerHour: n, asset })),
  pricing: fallback(object({ globalMultiplier: fallback(n), byJobType: fallback(numericRecord) })),
  policies: fallback(object({
    ...assumedNumbers('shiftHours', 'workDaysPerWeek', 'maxOvertimeHoursPerDay', 'minPaidHoursPerShift', 'rainoutPaidHours'),
    routing: fallback(choices('fifo', 'nearest', 'zoned')),
    autoBackfill: fallback(bool), acceptNewCustomers: fallback(bool), floatIdleWorkers: optional(bool),
  })),
  market: fallback(object({
    ...assumedNumbers('organicLeadsPerMonth', 'marketingMonthlySpend', 'marketingMaxLeadsPerMonth', 'marketingSpendScale',
      'baseConversionRate', 'acquisitionPriceElasticity', 'baseMonthlyChurn', 'retentionPriceElasticity',
      'priceIncreaseShockChurnPerPct', 'serviceFailureChurnWeight', 'serviceFailureHalfLifeDays'),
    ...optionalNumbers('oneOffPriceElasticity', 'referralsPerCustomerYear', 'marketSize', 'newCustomerChurnBoost'),
    leadSeasonality: fallback(series),
    newCustomer: fallback(object({
      ...assumedNumbers('serviceRadiusMiles', 'sizeFactorMin', 'sizeFactorMax'),
      recurringJobTypeMix: fallback(numericRecord),
    })),
  })),
  workforce: fallback(object({
    ...assumedNumbers('payrollBurdenRate', 'overtimeMultiplier', 'overtimeWeeklyThresholdHours', 'absenceRate',
      'annualTurnoverRate', 'timeToFillDays', 'hiringCostPerHire', 'rampDays', 'rampStartProductivity',
      'crewSizeCoordinationLoss', 'payPeriodDays'),
    ...optionalNumbers('learningGain', 'learningDays', 'fatigueThresholdHours', 'quitFatigueWeight',
      'absenceFatigueWeight', 'productivityFatigueLoss', 'wageQuitElasticity', 'earlyTenureQuitBoost', 'annualRaiseRate'),
    marketWageBySkill: optional(series),
  })),
  reliability: fallback(object({ vehicle: breakdown, equipment: breakdown })),
  weather: fallback(object({
    rainoutProbByMonth: fallback(series), partialProbByMonth: fallback(series), partialDayFraction: fallback(n),
  })),
  costs: fallback(object({
    ...assumedNumbers('fuelPricePerGallon', 'avgSpeedMph', 'roadFactor', 'stopOverheadHours'),
    overhead: fallback(array(object({ ...named, monthlyAmount: n }))),
  })),
  finance: object({
    startingCash: n,
    minCashReserve: fallback(n),
    lineOfCredit: fallback(object(assumedNumbers('limit', 'annualRate'))),
    ar: fallback(object(assumedNumbers('collectionDaysMean', 'collectionDaysJitter', 'badDebtRate'))),
    newLoan: fallback(object(assumedNumbers('annualRate', 'termMonths', 'downPaymentFraction'))),
    ...optionalNumbers('resaleShareOfBookValue', 'ownerDistributionCashAbove'),
  }),
});

export function importError(path: string, message: string): ValidationIssue {
  return { severity: 'error', path, message };
}

function safeId(value: unknown): value is string {
  // Engine projections use ordinary objects keyed by ids.
  return typeof value === 'string' && value.trim() !== '' && value === value.trim() && !(value in Object.prototype);
}

interface DecodeContext {
  issues: ValidationIssue[];
  assumedPaths: Set<string>;
  declaredAssumptions: Set<string>;
  /** Fields allowed to retain assumption provenance from an earlier export. */
  eligibleAssumptions: Set<string>;
  invalidShape: Set<string>;
}

/** Safe values let the engine validate independent fields even when some shapes are invalid. */
function placeholder(field: Field, path: string): unknown {
  switch (field.kind) {
    case 'optional': return undefined;
    case 'default': return placeholder(field.entry, path);
    case 'object': return Object.fromEntries(Object.entries(field.fields).map(([key, child]) => [key, placeholder(child, `${path}.${key}`)]));
    case 'array': return [];
    case 'record': return {};
    case 'number': return 0;
    case 'string': return '';
    case 'boolean': return false;
    case 'id': return `invalid:${path}`;
    case 'nullableId': return null;
    case 'enum': return field.values[0];
    case 'financing': return { kind: 'owned' };
  }
}

function decode(field: Field, value: unknown, defaultValue: unknown, path: string, context: DecodeContext): unknown {
  const { issues, assumedPaths, declaredAssumptions, eligibleAssumptions, invalidShape } = context;
  function invalid(message: string): unknown {
    issues.push(importError(path, message));
    invalidShape.add(path);
    return placeholder(field, path);
  }
  switch (field.kind) {
    case 'optional':
      return value === undefined ? undefined : decode(field.entry, value, undefined, path, context);
    case 'default': {
      if (field.entry.kind === 'object') {
        return decode(field.entry, value === undefined ? {} : value, defaultValue, path, context);
      }
      const relative = path.slice('company.'.length).replace(/\[(\d+)\]/g, '.$1');
      eligibleAssumptions.add(relative);
      if (value === undefined || declaredAssumptions.has(relative)) assumedPaths.add(relative);
      return decode(field.entry, value === undefined ? defaultValue : value, undefined, path, context);
    }
    case 'object': {
      if (!isRecord(value)) break;
      const result = Object.fromEntries(Object.entries(field.fields).flatMap(([key, child]) => {
        const childValue = decode(child, Object.hasOwn(value, key) ? value[key] : undefined,
          isRecord(defaultValue) ? defaultValue[key] : undefined, `${path}.${key}`, context);
        return childValue === undefined ? [] : [[key, childValue]];
      }));
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(field.fields, key)) issues.push(importError(`${path}.${key}`, 'Unknown field.'));
      }
      return result;
    }
    case 'array':
      if (Array.isArray(value)) return value.map((item, index) => decode(field.entry, item, Array.isArray(defaultValue) ? defaultValue[index] : field.entry.kind === 'object' ? defaultValue : undefined, `${path}[${index}]`, context));
      break;
    case 'record':
      if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        const entryPath = `${path}.${key}`;
        if (!safeId(key)) issues.push(importError(entryPath, 'Use a non-empty, non-reserved ID with no surrounding spaces.'));
        return [key, decode(field.entry, item, undefined, entryPath, context)];
      }));
      break;
    case 'financing': {
      if (!isRecord(value)) break;
      const kind = choices('owned', 'lease', 'loan');
      let terms: Fields = {};
      if (value.kind === 'lease') terms = { monthlyPayment: n };
      if (value.kind === 'loan') terms = { balance: n, annualRate: n, monthsRemaining: n };
      return decode(object({ kind, ...terms }), value, undefined, path, context);
    }
    case 'enum':
      if (typeof value === 'string' && field.values.includes(value)) return value;
      return invalid(`Choose ${field.values.join(', ')}.`);
    case 'string':
      if (typeof value === 'string' && value.trim() !== '') return value;
      break;
    case 'id':
    case 'nullableId':
      if (safeId(value) || (field.kind === 'nullableId' && value === null)) return value;
      return invalid(`Use a non-empty, non-reserved ID with no surrounding spaces${field.kind === 'nullableId' ? ', or null' : ''}.`);
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      break;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      break;
  }
  const expected = { string: 'non-empty text', number: 'a finite number', boolean: 'true or false',
    object: 'an object', array: 'a list', record: 'an object keyed by ID', financing: 'a financing object' }[field.kind];
  return invalid(`Expected ${expected}.`);
}

export function decodeCompany(value: unknown, sample: CompanyConfig, declaredAssumptions: Set<string>, issues: ValidationIssue[]) {
  const assumedPaths = new Set<string>();
  const eligibleAssumptions = new Set<string>();
  const invalidShape = new Set<string>();
  const defaults = {
    policies: sample.policies, pricing: sample.pricing, workforce: sample.workforce,
    reliability: sample.reliability, weather: sample.weather,
    employees: { productivity: 1 },
    customers: { sizeFactor: 1, phase: 0 },
    market: { ...sample.market, marketingMonthlySpend: 0, newCustomer: { ...sample.market.newCustomer, recurringJobTypeMix: {} } },
    costs: { ...sample.costs, overhead: [] },
    finance: { ar: sample.finance.ar, newLoan: sample.finance.newLoan, minCashReserve: 0, lineOfCredit: { ...sample.finance.lineOfCredit, limit: 0 } },
  };
  const data = decode(schema, value, defaults, 'company', { issues, assumedPaths, declaredAssumptions, eligibleAssumptions, invalidShape });
  if (invalidShape.size === 0) {
    for (const path of declaredAssumptions) {
      if (!eligibleAssumptions.has(path)) issues.push(importError('assumedPaths', `Unknown or ineligible assumption field: ${path}.`));
    }
  }
  // The candidate is structurally typed even when placeholder values were needed.
  // The caller must reject all candidates that produced any errors.
  return { company: data as CompanyConfig, assumedPaths: [...assumedPaths], invalidShape };
}
