import { describe, expect, it } from 'vitest';
import { landscaping, landscapingJobTypes, landscapingParamMeta } from '../../src/business/landscaping';
import { createSampleCompany } from '../../src/business/landscaping/sampleCompany';
import { defaultIndustryId, getIndustry, industries } from '../../src/business/registry';

/** Resolves a dot path such as "workforce.absenceRate" on a plain object. */
function valueAt(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node === null || node === undefined ? undefined : (node as Record<string, unknown>)[key]), root);
}

describe('sample company determinism and isolation', () => {
  it('two calls return deep-equal companies', () => {
    expect(createSampleCompany()).toEqual(createSampleCompany());
  });

  it('two calls return objects with distinct identity, including nested arrays and job types', () => {
    const a = createSampleCompany();
    const b = createSampleCompany();
    expect(a).not.toBe(b);
    expect(a.jobTypes).not.toBe(b.jobTypes);
    expect(a.jobTypes[0]).not.toBe(b.jobTypes[0]);
    expect(a.jobTypes[0].seasonality).not.toBe(b.jobTypes[0].seasonality);
    expect(a.jobTypes[0].requiredEquipmentTypes).not.toBe(b.jobTypes[0].requiredEquipmentTypes);
    expect(a.customers[0]).not.toBe(b.customers[0]);
    expect(a.finance).not.toBe(b.finance);
  });

  it('mutating one company does not change another company or the module job types', () => {
    const a = createSampleCompany();
    const b = createSampleCompany();
    a.jobTypes[0].seasonality[0] = 99;
    a.jobTypes[0].requiredEquipmentTypes.push('x');
    a.jobTypes[0].name = 'changed';
    a.customers[0].name = 'changed';
    a.employees[0].hourlyWage = 1;
    a.finance.startingCash = 1;

    // Expected values from the task table: mow-weekly seasonality Jan = 0.5, requires mower/trimmer/blower.
    expect(b.jobTypes[0].seasonality[0]).toBe(0.5);
    expect(b.jobTypes[0].requiredEquipmentTypes).toEqual(['mower', 'trimmer', 'blower']);
    expect(b.jobTypes[0].name).toBe('Weekly lawn maintenance');
    expect(b.customers[0].name).toBe('Customer 001');
    expect(b.employees[0].hourlyWage).toBe(24);
    expect(b.finance.startingCash).toBe(45000);
    expect(landscapingJobTypes[0].seasonality[0]).toBe(0.5);
    expect(landscapingJobTypes[0].name).toBe('Weekly lawn maintenance');
  });
});

describe('job type table', () => {
  it('matches the specified economics for every job type', () => {
    // [id, kind, standardLaborHours, basePrice, materialCost, minSkill, minCrewSize, lateAfterDays, cancelAfterDays]
    const expected: [string, string, number, number, number, number, number, number, number][] = [
      ['mow-weekly', 'recurring', 0.75, 55, 0, 1, 1, 2, 5],
      ['mow-biweekly', 'recurring', 0.9, 65, 0, 1, 1, 3, 8],
      ['cleanup', 'one-off', 6, 420, 25, 1, 2, 10, 21],
      ['mulch', 'one-off', 8, 780, 260, 2, 2, 10, 21],
      ['aeration', 'one-off', 2.5, 260, 45, 2, 1, 10, 21],
      ['pruning', 'one-off', 4, 340, 10, 2, 1, 10, 21],
      ['install', 'one-off', 24, 3200, 1250, 3, 2, 21, 45],
    ];
    const byId = new Map(landscapingJobTypes.map((j) => [j.id, j]));
    expect(byId.size).toBe(expected.length);
    for (const [id, kind, labor, price, material, skill, crew, late, cancel] of expected) {
      const jt = byId.get(id);
      expect(jt, id).toBeDefined();
      expect(jt!.kind, id).toBe(kind);
      expect(jt!.standardLaborHours, id).toBe(labor);
      expect(jt!.basePrice, id).toBe(price);
      expect(jt!.materialCost, id).toBe(material);
      expect(jt!.minSkill, id).toBe(skill);
      expect(jt!.minCrewSize, id).toBe(crew);
      expect(jt!.lateAfterDays, id).toBe(late);
      expect(jt!.cancelAfterDays, id).toBe(cancel);
      expect(jt!.offered, id).toBe(true);
    }
  });

  it('recurring types have intervalDays > 0; one-off types have annualRatePerCustomer >= 0', () => {
    for (const jt of landscapingJobTypes) {
      if (jt.kind === 'recurring') {
        expect(jt.intervalDays, jt.id).toBeGreaterThan(0);
      } else {
        expect(jt.annualRatePerCustomer, jt.id).toBeGreaterThanOrEqual(0);
      }
    }
    expect(landscapingJobTypes.find((j) => j.id === 'mow-weekly')?.intervalDays).toBe(7);
    expect(landscapingJobTypes.find((j) => j.id === 'mow-biweekly')?.intervalDays).toBe(14);
  });
});

describe('sample company customers', () => {
  const company = createSampleCompany();

  it('has exactly 190 customers with unique ids', () => {
    expect(company.customers).toHaveLength(190);
    expect(new Set(company.customers.map((c) => c.id)).size).toBe(190);
    expect(company.customers[0].id).toBe('c001');
    expect(company.customers[189].id).toBe('c190');
  });

  it('places hand-checked customers by the cluster formula', () => {
    // c001 (i=0): cluster 0 centre (2.0, 1.5), k=0, r=0.12*sqrt(1)=0.12, theta=0
    //   -> x = 2.0 + 0.12 = 2.12, y = 1.5 + 0 = 1.5. sizeFactor = 0.7 + 0.9*0 = 0.7. phase = 0.
    const c001 = company.customers[0];
    expect(c001).toMatchObject({ x: 2.12, y: 1.5, sizeFactor: 0.7, phase: 0, recurringJobTypeId: 'mow-weekly' });

    // c033 (i=32): cluster 1 centre (-3.0, 2.5), k=0 -> x = -3.0 + 0.12 = -2.88, y = 2.5.
    //   sizeFactor: 32*0.754877 = 24.156064, fraction 0.156064, 0.7 + 0.9*0.156064 = 0.8404576 -> 0.84.
    //   phase: 32*0.618034 = 19.777088, fraction 0.777088 -> 0.7771.
    const c033 = company.customers[32];
    expect(c033).toMatchObject({ x: -2.88, y: 2.5, sizeFactor: 0.84, phase: 0.7771 });

    // c161 (i=160): cluster 5 centre (1.0, 5.5), k=0 -> x = 1.12, y = 5.5.
    const c161 = company.customers[160];
    expect(c161).toMatchObject({ x: 1.12, y: 5.5 });
  });

  it('assigns recurring plans with the hand-counted split', () => {
    // i % 19 === 18 -> no plan: i = 18, 37, 56, 75, 94, 113, 132, 151, 170, 189 -> 10 customers.
    // Otherwise i % 6 === 5 -> biweekly: i = 5, 11, ..., 185 is 31 values; i = 113 is already
    //   excluded (113 % 19 === 18), so 30 customers.
    // Remaining 190 - 10 - 30 = 150 are weekly.
    const plans = company.customers.map((c) => c.recurringJobTypeId);
    expect(plans.filter((p) => p === null)).toHaveLength(10);
    expect(plans.filter((p) => p === 'mow-biweekly')).toHaveLength(30);
    expect(plans.filter((p) => p === 'mow-weekly')).toHaveLength(150);
    expect(company.customers[18].recurringJobTypeId).toBeNull();
    expect(company.customers[5].recurringJobTypeId).toBe('mow-biweekly');
  });

  it('keeps phases in [0, 1) and size factors in [0.7, 1.6]', () => {
    for (const c of company.customers) {
      expect(c.phase).toBeGreaterThanOrEqual(0);
      expect(c.phase).toBeLessThan(1);
      expect(c.sizeFactor).toBeGreaterThanOrEqual(0.7);
      expect(c.sizeFactor).toBeLessThanOrEqual(1.6);
    }
  });
});

describe('referential integrity', () => {
  const company = createSampleCompany();
  const jobTypeIds = new Set(company.jobTypes.map((j) => j.id));
  const recurringIds = new Set(company.jobTypes.filter((j) => j.kind === 'recurring').map((j) => j.id));
  const equipmentTypeIds = new Set(landscaping.equipmentTypes.map((t) => t.id));
  const crewIds = new Set(company.crews.map((c) => c.id));
  const vehicleIds = new Set(company.vehicles.map((v) => v.id));
  const hireTemplateIds = new Set(landscaping.hireTemplates.map((t) => t.id));
  const vehicleCatalogIds = new Set(landscaping.vehicleCatalog.map((v) => v.id));
  const equipmentCatalogIds = new Set(landscaping.equipmentCatalog.map((e) => e.id));

  it('employees and equipment point at existing crews (or null)', () => {
    for (const e of company.employees) {
      expect(e.crewId === null || crewIds.has(e.crewId), e.id).toBe(true);
    }
    for (const eq of company.equipment) {
      expect(eq.crewId === null || crewIds.has(eq.crewId), eq.id).toBe(true);
      expect(equipmentTypeIds.has(eq.equipmentTypeId), eq.id).toBe(true);
    }
  });

  it('crews point at existing vehicles', () => {
    for (const crew of company.crews) {
      expect(crew.vehicleId === null || vehicleIds.has(crew.vehicleId), crew.id).toBe(true);
    }
  });

  it('customers point at recurring job types (or null)', () => {
    for (const c of company.customers) {
      expect(c.recurringJobTypeId === null || recurringIds.has(c.recurringJobTypeId), c.id).toBe(true);
    }
    for (const id of Object.keys(company.market.newCustomer.recurringJobTypeMix)) {
      expect(recurringIds.has(id), id).toBe(true);
    }
  });

  it('job types require only known equipment types', () => {
    for (const jt of company.jobTypes) {
      for (const t of jt.requiredEquipmentTypes) {
        expect(equipmentTypeIds.has(t), `${jt.id} -> ${t}`).toBe(true);
      }
    }
  });

  it('catalog entries reference known equipment types', () => {
    for (const spec of landscaping.equipmentCatalog) {
      expect(equipmentTypeIds.has(spec.equipmentTypeId), spec.id).toBe(true);
    }
  });

  it('standard crew references resolve in the catalogs', () => {
    const std = landscaping.standardCrew;
    for (const id of std.hireTemplateIds) expect(hireTemplateIds.has(id), id).toBe(true);
    expect(vehicleCatalogIds.has(std.vehicleCatalogId), std.vehicleCatalogId).toBe(true);
    for (const id of std.equipmentCatalogIds) expect(equipmentCatalogIds.has(id), id).toBe(true);
  });

  it('sample company job types are the industry job types, copied', () => {
    expect(company.jobTypes.map((j) => j.id)).toEqual(landscapingJobTypes.map((j) => j.id));
    expect(jobTypeIds.size).toBe(7);
    expect(company.industryId).toBe('landscaping');
  });
});

describe('monthly arrays', () => {
  const company = createSampleCompany();

  it('every monthly array has 12 finite, non-negative entries', () => {
    const arrays: [string, number[]][] = [
      ...company.jobTypes.map((j) => [`jobTypes.${j.id}.seasonality`, j.seasonality] as [string, number[]]),
      ['market.leadSeasonality', company.market.leadSeasonality],
      ['weather.rainoutProbByMonth', company.weather.rainoutProbByMonth],
      ['weather.partialProbByMonth', company.weather.partialProbByMonth],
    ];
    expect(arrays.length).toBe(7 + 3);
    for (const [label, values] of arrays) {
      expect(values, label).toHaveLength(12);
      for (const v of values) {
        expect(Number.isFinite(v), label).toBe(true);
        expect(v, label).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('parameter metadata', () => {
  const company = createSampleCompany();

  it('every paramMeta path resolves to a finite number inside [min, max]', () => {
    const entries = Object.entries(landscapingParamMeta);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, meta] of entries) {
      expect(meta.path, key).toBe(key);
      const value = valueAt(company, meta.path);
      expect(typeof value, meta.path).toBe('number');
      expect(Number.isFinite(value as number), meta.path).toBe(true);
      expect(value as number, meta.path).toBeGreaterThanOrEqual(meta.min);
      expect(value as number, meta.path).toBeLessThanOrEqual(meta.max);
    }
  });

  it('has the expected provenance for the synthetic-demo parameters', () => {
    expect(landscapingParamMeta['finance.startingCash'].provenance).toBe('synthetic-demo');
    expect(landscapingParamMeta['finance.lineOfCredit.limit'].provenance).toBe('synthetic-demo');
    expect(landscapingParamMeta['policies.shiftHours'].provenance).toBe('synthetic-demo');
    expect(landscapingParamMeta['pricing.globalMultiplier'].provenance).toBe('synthetic-demo');
    expect(landscapingParamMeta['workforce.absenceRate'].provenance).toBe('industry-assumption');
    expect(landscapingParamMeta['market.acquisitionPriceElasticity'].provenance).toBe('industry-assumption');
  });

  it('no label or description says "benchmark" or "industry average"', () => {
    const forbidden = /benchmark|industry average/i;
    for (const meta of Object.values(landscapingParamMeta)) {
      expect(forbidden.test(meta.label), `${meta.path} label`).toBe(false);
      expect(forbidden.test(meta.description), `${meta.path} description`).toBe(false);
    }
  });
});

describe('reliability parameter metadata', () => {
  const company = createSampleCompany();
  const groups = ['vehicle', 'equipment'] as const;

  it('has exactly one entry for every field under reliability.vehicle and reliability.equipment', () => {
    // 6 numeric fields per group: dailyProb, ageFactorPerYear, repairDaysMin, repairDaysMax, repairCostMin, repairCostMax.
    const reliabilityPaths = Object.keys(landscapingParamMeta).filter((k) => k.startsWith('reliability.'));
    expect(reliabilityPaths).toHaveLength(12);
    for (const group of groups) {
      const fields = Object.keys(company.reliability[group]);
      expect(fields, group).toHaveLength(6);
      for (const field of fields) {
        const path = `reliability.${group}.${field}`;
        expect(landscapingParamMeta[path], path).toBeDefined();
        expect(landscapingParamMeta[path].path, path).toBe(path);
        expect(typeof valueAt(company, path), path).toBe('number');
      }
    }
  });

  it('every reliability entry is an industry assumption worded as an illustrative assumption', () => {
    for (const [path, meta] of Object.entries(landscapingParamMeta)) {
      if (!path.startsWith('reliability.')) continue;
      expect(meta.provenance, path).toBe('industry-assumption');
      expect(meta.description.toLowerCase(), path).toContain('illustrative assumption');
      expect(meta.min, path).toBeLessThanOrEqual(meta.max);
      expect(meta.step, path).toBeGreaterThan(0);
    }
  });
});

describe('registry', () => {
  it('resolves the default industry and rejects unknown ids', () => {
    expect(defaultIndustryId).toBe('landscaping');
    expect(industries[defaultIndustryId]).toBe(landscaping);
    expect(getIndustry('landscaping')).toBe(landscaping);
    expect(() => getIndustry('hvac')).toThrow();
  });
});
