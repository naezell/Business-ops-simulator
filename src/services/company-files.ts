import { industries } from '@/business/registry';
import { validateScenario, type CompanyConfig, type ValidationIssue } from '@/simulation';
import { decodeCompany, importError, isRecord } from './company-file-schema';
import { readCompanyCsv, type CompanyCsvList } from './company-csv';

export { companyCsvTemplates } from './company-csv';
export const COMPANY_FILE_VERSION = 1;

export interface UserCompany {
  company: CompanyConfig;
  /** Dot paths relative to CompanyConfig, with numeric indexes for list entries. */
  assumedPaths: string[];
}

export type CompanyImportResult =
  | ({ ok: true; issues: ValidationIssue[] } & UserCompany)
  | { ok: false; issues: ValidationIssue[] };

function listIssues(company: CompanyConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [index, job] of company.jobTypes.entries()) {
    if (job.kind !== 'recurring' || !job.intervalDays || job.intervalDays <= 0) continue;
    for (const [month, multiplier] of job.seasonality.entries()) {
      if (multiplier / job.intervalDays > 100) {
        issues.push(importError(`company.jobTypes[${index}].seasonality[${month}]`, 'The seasonality and visit interval must schedule at most 100 visits per customer per day.'));
      }
    }
  }
  const vehicleIds = new Set(company.vehicles.map(({ id }) => id));
  for (const [index, item] of company.equipment.entries()) {
    if (vehicleIds.has(item.id)) issues.push(importError(`company.equipment[${index}].id`, 'Equipment and vehicles must use different IDs.'));
  }
  for (const [index, customer] of company.customers.entries()) {
    if (customer.phase >= 1) issues.push(importError(`company.customers[${index}].phase`, 'Use a visit phase in [0, 1).'));
  }
  for (const [index, vehicle] of company.vehicles.entries()) {
    if (!Number.isInteger(vehicle.seats)) issues.push(importError(`company.vehicles[${index}].seats`, 'Use a whole number of seats.'));
  }
  const crewVehicleIds = new Set<string>();
  for (const [index, { vehicleId }] of company.crews.entries()) {
    if (vehicleId === null) continue;
    if (crewVehicleIds.has(vehicleId)) issues.push(importError(`company.crews[${index}].vehicleId`, 'Assign a vehicle to only one crew.'));
    crewVehicleIds.add(vehicleId);
  }
  return issues;
}

function validateCompany(company: CompanyConfig): ValidationIssue[] {
  const issues = validateScenario({ id: 'company-import', name: company.name, company, actions: [], horizonDays: 1, seed: 0 });
  // The engine reports repeated IDs on the whole collection. Point to each duplicate entry.
  const duplicates = new Map<string, number>();
  return [...issues.map((issue) => {
    const id = issue.message.startsWith('duplicate id ') ? issue.message.slice('duplicate id '.length) : null;
    if (id === null) return issue;
    const key = issue.path.slice('company.'.length);
    const entries = key === 'costs.overhead' ? company.costs.overhead : company[key as keyof CompanyConfig];
    if (!Array.isArray(entries)) return issue;
    const duplicateKey = JSON.stringify([key, id]);
    const previous = duplicates.get(duplicateKey) ?? entries.findIndex((entity: { id: string }) => entity.id === id);
    const index = entries.findIndex((entity: { id: string }, index: number) => index > previous && entity.id === id);
    duplicates.set(duplicateKey, index);
    return index < 0 ? issue : { ...issue, path: `${issue.path}[${index}].id` };
  }), ...listIssues(company)];
}

/** Validates the transport envelope and engine model before a company can be used. */
function parseCompanyFile(input: unknown, csv: Partial<Record<CompanyCsvList, string>>): CompanyImportResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input) || input.version !== COMPANY_FILE_VERSION) {
    return { ok: false, issues: [importError('version', `Expected a company file with version ${COMPANY_FILE_VERSION}.`)] };
  }
  for (const key of Object.keys(input)) {
    if (!['version', 'company', 'assumedPaths'].includes(key)) issues.push(importError(key, 'Unknown field.'));
  }
  if (!isRecord(input.company)) return { ok: false, issues: [...issues, importError('company', 'Expected a company object.')] };
  const companyFields = { ...input.company };
  const industryId = companyFields.industryId;
  const industry = typeof industryId === 'string' && Object.hasOwn(industries, industryId) ? industries[industryId] : undefined;
  if (!industry) issues.push(importError('company.industryId', `Choose a supported industry: ${Object.keys(industries).join(', ')}.`));

  const sourceRows: Partial<Record<CompanyCsvList, number[]>> = {};
  for (const list of ['customers', 'employees'] as const) {
    const text = csv[list];
    if (text === undefined) continue;
    const { entries, sourceRows: rows } = readCompanyCsv(list, text, issues);
    companyFields[list] = entries;
    sourceRows[list] = rows;
  }
  const assumedPaths = new Set<string>();
  if (input.assumedPaths !== undefined) {
    if (!Array.isArray(input.assumedPaths)) issues.push(importError('assumedPaths', 'Expected a list of field paths.'));
    else for (const [index, path] of input.assumedPaths.entries()) {
      if (typeof path !== 'string') issues.push(importError(`assumedPaths[${index}]`, 'Expected a field path.'));
      else if (!Object.keys(sourceRows).some((list) => path.startsWith(list + '.'))) assumedPaths.add(path);
    }
  }
  const sample = (industry ?? Object.values(industries)[0]).createSampleCompany();
  const decoded = decodeCompany(companyFields, sample, assumedPaths, issues);
  const invalid = [...decoded.invalidShape];
  const validIssue = (issue: ValidationIssue) => !invalid.some((path) =>
    issue.path === path || issue.path.startsWith(path + '.') || issue.path.startsWith(path + '['));
  issues.push(...validateCompany(decoded.company).filter(validIssue));
  const locatedIssues = issues.map((issue) => {
    const match = /^company\.(customers|employees)\[(\d+)\](.*)$/.exec(issue.path);
    if (!match) return issue;
    const list = match[1] as CompanyCsvList;
    const row = sourceRows[list]?.[Number(match[2])];
    if (row === undefined) return issue;
    const field = match[3].replace(/^\./, '');
    return { ...issue, path: `${list}.csv row ${row}${field ? ', ' + field : ''}` };
  });
  if (locatedIssues.some((issue) => issue.severity === 'error')) return { ok: false, issues: locatedIssues };
  return { ok: true, company: decoded.company, assumedPaths: decoded.assumedPaths, issues: locatedIssues };
}

export function importCompany(json: string, csv: Partial<Record<CompanyCsvList, string>> = {}): CompanyImportResult {
  let input: unknown;
  try {
    input = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, issues: [importError('JSON', 'Invalid JSON. Check quotes, commas and brackets.')] };
  }
  return parseCompanyFile(input, csv);
}

/** Storage uses the same schema as the file format so invalid saved companies cannot enter the engine. */
export function restoreUserCompany(value: unknown): UserCompany | null {
  if (!isRecord(value) || !Array.isArray(value.assumedPaths) || Object.keys(value).some((key) => key !== 'company' && key !== 'assumedPaths')) return null;
  const result = parseCompanyFile({ ...value, version: COMPANY_FILE_VERSION }, {});
  return result.ok ? { company: result.company, assumedPaths: result.assumedPaths } : null;
}

export function exportCompany(company: CompanyConfig, assumedPaths: readonly string[] = []): string {
  return JSON.stringify({ version: COMPANY_FILE_VERSION, company, ...(assumedPaths.length ? { assumedPaths } : {}) }, null, 2) + '\n';
}
