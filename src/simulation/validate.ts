/** Scenario validation (simulation-engine §11). */
import type { AssetFinance, CompanyConfig, Scenario, ValidateScenario, ValidationIssue } from './types';

/** Numeric leaves allowed to be negative (positions and elasticities). */
const NEGATIVE_OK = /(^|\.)(x|y)$|Elasticity$/;

function walkNumbers(obj: unknown, path: string, out: ValidationIssue[]): void {
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) out.push({ severity: 'error', path, message: 'must be a finite number' });
    else if (obj < 0 && !NEGATIVE_OK.test(path)) out.push({ severity: 'error', path, message: 'must not be negative' });
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkNumbers(v, `${path}[${i}]`, out));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) walkNumbers(v, path ? `${path}.${k}` : k, out);
  }
}

function dupes(ids: string[], path: string, out: ValidationIssue[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) out.push({ severity: 'error', path, message: `duplicate id ${id}` });
    seen.add(id);
  }
}

function monthly(arr: unknown, path: string, out: ValidationIssue[]): void {
  if (!Array.isArray(arr) || arr.length !== 12) out.push({ severity: 'error', path, message: 'must have 12 monthly values' });
}

function maxOne(x: number, path: string, out: ValidationIssue[]): void {
  if (x > 1) out.push({ severity: 'error', path, message: 'must be at most 1' });
}

function checkAsset(a: AssetFinance, path: string, out: ValidationIssue[]): void {
  if (a.financing.kind !== 'lease' && !(a.usefulLifeYears > 0))
    out.push({ severity: 'error', path: `${path}.usefulLifeYears`, message: 'must be > 0 for owned/financed assets' });
  if (a.financing.kind === 'loan' && !Number.isInteger(a.financing.monthsRemaining))
    out.push({ severity: 'error', path: `${path}.financing.monthsRemaining`, message: 'must be an integer' });
}

function companyIssues(c: CompanyConfig, out: ValidationIssue[]): void {
  walkNumbers(c, 'company', out);
  if (!Number.isInteger(c.startMonth) || c.startMonth < 0 || c.startMonth > 11)
    out.push({ severity: 'error', path: 'company.startMonth', message: 'must be an integer 0–11' });

  dupes(c.jobTypes.map((j) => j.id), 'company.jobTypes', out);
  dupes(c.employees.map((j) => j.id), 'company.employees', out);
  dupes(c.crews.map((j) => j.id), 'company.crews', out);
  dupes(c.vehicles.map((j) => j.id), 'company.vehicles', out);
  dupes(c.equipment.map((j) => j.id), 'company.equipment', out);
  dupes(c.customers.map((j) => j.id), 'company.customers', out);
  dupes(c.costs.overhead.map((j) => j.id), 'company.costs.overhead', out);

  const jt = new Map(c.jobTypes.map((j) => [j.id, j]));
  const crewIds = new Set(c.crews.map((x) => x.id));
  const vehicleIds = new Set(c.vehicles.map((x) => x.id));

  c.jobTypes.forEach((j, i) => {
    const p = `company.jobTypes[${i}]`;
    monthly(j.seasonality, `${p}.seasonality`, out);
    if (j.kind === 'recurring' && !((j.intervalDays ?? 0) > 0))
      out.push({ severity: 'error', path: `${p}.intervalDays`, message: 'recurring job type needs intervalDays > 0' });
  });
  monthly(c.market.leadSeasonality, 'company.market.leadSeasonality', out);
  monthly(c.weather.rainoutProbByMonth, 'company.weather.rainoutProbByMonth', out);
  monthly(c.weather.partialProbByMonth, 'company.weather.partialProbByMonth', out);

  c.crews.forEach((cr, i) => {
    if (cr.vehicleId !== null && !vehicleIds.has(cr.vehicleId))
      out.push({ severity: 'error', path: `company.crews[${i}].vehicleId`, message: `unknown vehicle ${cr.vehicleId}` });
  });
  c.employees.forEach((e, i) => {
    if (e.crewId !== null && !crewIds.has(e.crewId))
      out.push({ severity: 'error', path: `company.employees[${i}].crewId`, message: `unknown crew ${e.crewId}` });
  });
  c.equipment.forEach((e, i) => {
    if (e.crewId !== null && !crewIds.has(e.crewId))
      out.push({ severity: 'error', path: `company.equipment[${i}].crewId`, message: `unknown crew ${e.crewId}` });
    checkAsset(e.asset, `company.equipment[${i}].asset`, out);
  });
  c.vehicles.forEach((v, i) => {
    if (!(v.mpg > 0)) out.push({ severity: 'error', path: `company.vehicles[${i}].mpg`, message: 'must be > 0' });
    checkAsset(v.asset, `company.vehicles[${i}].asset`, out);
  });
  c.customers.forEach((cu, i) => {
    if (cu.recurringJobTypeId === null) return;
    const j = jt.get(cu.recurringJobTypeId);
    if (!j) out.push({ severity: 'error', path: `company.customers[${i}].recurringJobTypeId`, message: `unknown job type ${cu.recurringJobTypeId}` });
    else if (j.kind !== 'recurring')
      out.push({ severity: 'error', path: `company.customers[${i}].recurringJobTypeId`, message: `job type ${j.id} is not recurring` });
  });
  for (const k of Object.keys(c.market.newCustomer.recurringJobTypeMix)) {
    if (!jt.has(k)) out.push({ severity: 'warning', path: 'company.market.newCustomer.recurringJobTypeMix', message: `unknown job type ${k}` });
  }

  if (!(c.costs.avgSpeedMph > 0)) out.push({ severity: 'error', path: 'company.costs.avgSpeedMph', message: 'must be > 0' });
  if (!(c.workforce.payPeriodDays >= 1) || !Number.isInteger(c.workforce.payPeriodDays))
    out.push({ severity: 'error', path: 'company.workforce.payPeriodDays', message: 'must be an integer >= 1' });
  if (!Number.isInteger(c.policies.workDaysPerWeek) || c.policies.workDaysPerWeek > 7)
    out.push({ severity: 'error', path: 'company.policies.workDaysPerWeek', message: 'must be an integer 0–7' });
  if (!['fifo', 'nearest', 'zoned'].includes(c.policies.routing))
    out.push({ severity: 'error', path: 'company.policies.routing', message: 'unknown routing policy' });
  maxOne(c.workforce.absenceRate, 'company.workforce.absenceRate', out);
  maxOne(c.workforce.annualTurnoverRate, 'company.workforce.annualTurnoverRate', out);
  maxOne(c.finance.ar.badDebtRate, 'company.finance.ar.badDebtRate', out);
  maxOne(c.finance.ar.collectionDaysJitter, 'company.finance.ar.collectionDaysJitter', out);
  maxOne(c.finance.newLoan.downPaymentFraction, 'company.finance.newLoan.downPaymentFraction', out);
  for (const k of ['vehicle', 'equipment'] as const) {
    const b = c.reliability[k];
    if (b.repairDaysMax < b.repairDaysMin)
      out.push({ severity: 'error', path: `company.reliability.${k}.repairDaysMax`, message: 'must be >= repairDaysMin' });
    if (b.repairCostMax < b.repairCostMin)
      out.push({ severity: 'error', path: `company.reliability.${k}.repairCostMax`, message: 'must be >= repairCostMin' });
  }

  // Warnings.
  c.crews.forEach((cr, i) => {
    if (!c.employees.some((e) => e.crewId === cr.id))
      out.push({ severity: 'warning', path: `company.crews[${i}]`, message: `crew ${cr.id} has no members` });
    if (cr.vehicleId === null) out.push({ severity: 'warning', path: `company.crews[${i}].vehicleId`, message: `crew ${cr.id} has no vehicle` });
  });
  for (const j of c.jobTypes) {
    if (!j.offered) continue;
    const ok = c.crews.some((cr) => {
      const members = c.employees.filter((e) => e.crewId === cr.id);
      const types = new Set(c.equipment.filter((e) => e.crewId === cr.id).map((e) => e.equipmentTypeId));
      return (
        members.length >= j.minCrewSize &&
        members.some((e) => e.skill >= j.minSkill) &&
        j.requiredEquipmentTypes.every((t) => types.has(t))
      );
    });
    if (!ok) out.push({ severity: 'warning', path: `company.jobTypes`, message: `no crew can perform job type ${j.id}` });
  }
  if (c.customers.length === 0) out.push({ severity: 'warning', path: 'company.customers', message: 'company has no customers' });
  if (c.employees.length === 0) out.push({ severity: 'warning', path: 'company.employees', message: 'company has no employees' });
}

export const validateScenario: ValidateScenario = (scenario: Scenario) => {
  const out: ValidationIssue[] = [];
  if (!Number.isInteger(scenario.horizonDays) || scenario.horizonDays < 1)
    out.push({ severity: 'error', path: 'horizonDays', message: 'must be an integer >= 1' });
  if (!Number.isFinite(scenario.seed)) out.push({ severity: 'error', path: 'seed', message: 'must be finite' });
  scenario.actions.forEach((a, i) => {
    if (!Number.isInteger(a.day) || a.day < 0) out.push({ severity: 'error', path: `actions[${i}].day`, message: 'must be an integer >= 0' });
  });
  companyIssues(scenario.company, out);
  return out;
};
