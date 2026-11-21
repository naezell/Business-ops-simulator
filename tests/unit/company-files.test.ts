import { describe, expect, it } from 'vitest';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { createSampleCompany } from '../../src/business/landscaping/sampleCompany';
import { companyCsvTemplates, exportCompany, importCompany } from '../../src/services/company-files';
import { runSimulation } from '../../src/simulation';
import type { CompanyConfig } from '../../src/simulation';
import postOakFile from '../fixtures/post-oak-company.json';

function companyFile(company: object): string {
  return JSON.stringify({ version: 1, company });
}

const customersHeader = 'id,name,x,y,sizeFactor,recurringJobTypeId,phase';
const employeesHeader = 'id,name,hourlyWage,skill,productivity,crewId,tenureDays';

describe('company JSON', () => {
  it('imports a small landscaping company and runs it through the engine', () => {
    const result = importCompany(JSON.stringify(postOakFile));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    expect(result.company).toEqual(postOakFile.company);
    expect(result.assumedPaths).toEqual([]);
    expect(result.issues).toEqual([]);
    const simulation = runSimulation({
      id: 'post-oak',
      name: 'Post Oak Yard Care',
      company: result.company,
      horizonDays: 28,
      seed: 42,
      actions: [],
    });
    expect(simulation.days).toHaveLength(28);
    expect(simulation.totals.income.revenue).toBeGreaterThan(0);
    expect(Number.isFinite(simulation.totals.income.netProfit)).toBe(true);
  });

  it('rejects malformed JSON and unsupported file versions', () => {
    const malformed = importCompany('{"version": 1');
    const unsupported = importCompany(JSON.stringify({ ...postOakFile, version: 99 }));
    expect(malformed.ok).toBe(false);
    expect(malformed.issues.length).toBeGreaterThan(0);
    expect(unsupported.ok).toBe(false);
    expect(unsupported.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining('version'), severity: 'error' }),
    ]));
  });

  it('reports multiple malformed fields together', () => {
    const draft = {
      ...postOakFile.company,
      employees: [null],
      finance: { ...postOakFile.company.finance, startingCash: '17850' },
    };
    const result = importCompany(companyFile(draft));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/employees.*0/), severity: 'error' }),
      expect.objectContaining({ path: expect.stringContaining('finance.startingCash'), severity: 'error' }),
    ]));
  });

  it('reports an independent engine reference error alongside a malformed field', () => {
    const company = postOakFile.company;
    const result = importCompany(companyFile({
      ...company,
      finance: { ...company.finance, startingCash: '17850' },
      employees: [{ ...company.employees[0], crewId: 'unknown-crew' }, company.employees[1]],
    }));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'company.finance.startingCash', severity: 'error' }),
      expect.objectContaining({ path: 'company.employees[0].crewId', message: expect.stringContaining('unknown-crew'), severity: 'error' }),
    ]));
  });

  it('reports engine errors for invalid references and field ranges', () => {
    const company = postOakFile.company;
    const draft = {
      ...company,
      startMonth: 12,
      employees: [{ ...company.employees[0], crewId: 'unknown-crew' }, company.employees[1]],
      customers: [{ ...company.customers[0], recurringJobTypeId: 'bed-cleanup' }],
      vehicles: [{ ...company.vehicles[0], mpg: 0 }],
    };
    const result = importCompany(companyFile(draft));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'company.startMonth', severity: 'error' }),
      expect.objectContaining({ path: 'company.employees[0].crewId', message: expect.stringContaining('unknown-crew'), severity: 'error' }),
      expect.objectContaining({ path: 'company.customers[0].recurringJobTypeId', message: expect.stringContaining('recurring'), severity: 'error' }),
      expect.objectContaining({ path: 'company.vehicles[0].mpg', severity: 'error' }),
    ]));
  });

  it('reports engine warnings without treating an intentionally empty list as omitted', () => {
    const result = importCompany(companyFile({ ...postOakFile.company, customers: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.company.customers).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'company.customers', severity: 'warning' }),
    ]));
  });

  it('rejects a recurring interval and seasonality that produce non-finite daily accrual', () => {
    const company = postOakFile.company;
    const result = importCompany(companyFile({
      ...company,
      jobTypes: [{ ...company.jobTypes[0], intervalDays: Number.MIN_VALUE }, company.jobTypes[1]],
    }));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/jobTypes.*0.*(?:intervalDays|seasonality)/), severity: 'error' }),
    ]));
  });

  it('fills omitted operating assumptions while keeping supplied zero, false and null values', () => {
    const company = postOakFile.company;
    const result = importCompany(companyFile({
      ...company,
      policies: { acceptNewCustomers: false },
      costs: { overhead: [] },
      pricing: undefined,
      finance: { startingCash: 0 },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.company.finance.startingCash).toBe(0);
    expect(result.company.policies.acceptNewCustomers).toBe(false);
    expect(result.company.customers[3].recurringJobTypeId).toBeNull();
    expect(result.company.costs.overhead).toEqual([]);
    expect(result.company.pricing).toEqual({ globalMultiplier: 1, byJobType: {} });
    expect(result.assumedPaths).toEqual(expect.arrayContaining([
      'finance.minCashReserve',
      'policies.shiftHours',
      'pricing.globalMultiplier',
    ]));
    expect(result.assumedPaths).not.toContain('finance.startingCash');
    expect(result.assumedPaths).not.toContain('policies.acceptNewCustomers');
    expect(result.assumedPaths).not.toContain('costs.overhead');

    const exported = exportCompany(result.company, result.assumedPaths);
    expect(importCompany(exported)).toEqual(result);
  });

  it.each<[string, () => CompanyConfig]>([
    ['sample', createSampleCompany],
    ['digital twin', () => createDemoTwinScenario().company],
  ])('round-trips the full %s company', (_name, createCompany) => {
    const company = createCompany();
    const exported = exportCompany(company);
    expect(JSON.parse(exported)).toMatchObject({ version: 1, company });

    const result = importCompany(exported);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.company).toEqual(company);
    expect(result.assumedPaths).toEqual([]);
  });
});

describe('company CSV lists', () => {
  it('provides column headers matching both importable lists', () => {
    expect(companyCsvTemplates.customers.split(/\r?\n/, 1)[0]).toBe(customersHeader);
    expect(companyCsvTemplates.employees.split(/\r?\n/, 1)[0]).toBe(employeesHeader);
  });

  it('replaces JSON lists and handles quoted values, line endings and nullable fields', () => {
    const customers = [
      '\ufeff' + customersHeader,
      'garden-1,"Oak, ""East""",2.4,-1.1,,weekly-yard,',
      'garden-2,"North\nLot",0,-2,1.3,,0.4',
    ].join('\r\n');
    const employees = [
      employeesHeader,
      'north-lead,"Bailey, Lane",24.5,3,,north,365',
      'relief,Jordan Park,20,2,0.9,,80',
    ].join('\n');
    const result = importCompany(JSON.stringify(postOakFile), { customers, employees });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.company.customers).toEqual([
      { id: 'garden-1', name: 'Oak, "East"', x: 2.4, y: -1.1, sizeFactor: 1, recurringJobTypeId: 'weekly-yard', phase: 0 },
      { id: 'garden-2', name: 'North\nLot', x: 0, y: -2, sizeFactor: 1.3, recurringJobTypeId: null, phase: 0.4 },
    ]);
    expect(result.company.employees).toEqual([
      { id: 'north-lead', name: 'Bailey, Lane', hourlyWage: 24.5, skill: 3, productivity: 1, crewId: 'north', tenureDays: 365 },
      { id: 'relief', name: 'Jordan Park', hourlyWage: 20, skill: 2, productivity: 0.9, crewId: null, tenureDays: 80 },
    ]);
    expect(result.assumedPaths).toEqual(expect.arrayContaining([
      'customers.0.sizeFactor',
      'customers.0.phase',
      'employees.0.productivity',
    ]));
    expect(result.assumedPaths).not.toContain('employees.1.crewId');
  });

  it('reads CSV lists when the JSON file omits the corresponding arrays', () => {
    const json = companyFile({ ...postOakFile.company, customers: undefined });
    const customers = [customersHeader, 'garden,Garden,2,3,1,weekly-yard,0.9'].join('\n');
    const result = importCompany(json, { customers });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.company.customers).toEqual([
      { id: 'garden', name: 'Garden', x: 2, y: 3, sizeFactor: 1, recurringJobTypeId: 'weekly-yard', phase: 0.9 },
    ]);
    expect(result.company.employees).toEqual(postOakFile.company.employees);
  });

  it('reports engine errors in both CSV files with their physical rows and fields', () => {
    const customers = [
      customersHeader,
      'garden-1,"North\nLot",3,-2,1,weekly-yard,0.4',
      'garden-2,East Lot,4,2,1,unknown-plan,0.4',
    ].join('\n');
    const employees = [
      employeesHeader,
      'north-lead,Bailey Lane,-24,3,1,north,365',
    ].join('\n');
    const result = importCompany(JSON.stringify(postOakFile), { customers, employees });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/customers\.csv row 4.*recurringJobTypeId/), severity: 'error' }),
      expect.objectContaining({ path: expect.stringMatching(/employees\.csv row 2.*hourlyWage/), severity: 'error' }),
    ]));
  });

  it('reports a nonnumeric CSV cell with its row and field', () => {
    const employees = [employeesHeader, 'north-lead,Bailey Lane,invalid,3,1,north,365'].join('\n');
    const result = importCompany(JSON.stringify(postOakFile), { employees });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/employees\.csv row 2.*hourlyWage/), severity: 'error' }),
    ]));
  });

  it('rejects IDs reserved for decisions that target all services or employees', () => {
    const jobTypes = postOakFile.company.jobTypes.map((job) => ({ ...job, id: job.kind === 'one-off' ? 'all' : job.id }));
    const employees = [employeesHeader, 'all,Field worker,20,2,1,north,100'].join('\n');
    const result = importCompany(companyFile({ ...postOakFile.company, jobTypes }), { employees });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'company.jobTypes[1].id', severity: 'error', message: expect.stringContaining('all services') }),
      expect.objectContaining({ path: 'employees.csv row 2, id', severity: 'error', message: expect.stringContaining('all employees') }),
    ]));
  });

  it('locates a duplicate customer ID on the later CSV row', () => {
    const customers = [
      customersHeader,
      'garden,North Lot,1,2,1,weekly-yard,0.9',
      'garden,West Lot,-1,2,1,weekly-yard,0.9',
    ].join('\n');
    const result = importCompany(JSON.stringify(postOakFile), { customers });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/customers\.csv row 3.*id/i), severity: 'error' }),
    ]));
  });
});
