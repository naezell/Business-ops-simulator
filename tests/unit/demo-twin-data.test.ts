import { describe, expect, it } from 'vitest';
import { landscaping } from '../../src/business/landscaping';
import {
  createDemoTwinScenario,
  demoTwinParamMeta,
  demoTwinScenarios,
} from '../../src/business/landscaping/demoTwin';
import { runSimulation, validateScenario } from '../../src/simulation';
import type { Scenario } from '../../src/simulation/types';

/** Resolves a dot path such as "workforce.absenceRate" on a plain object. */
function valueAt(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node === null || node === undefined ? undefined : (node as Record<string, unknown>)[key]), root);
}

const scenario = createDemoTwinScenario();
const company = scenario.company;

/** Segment by sizeFactor range: residential 0.8–1.8, commercial 3–8, large site 10–18. */
const segmentOf = (sizeFactor: number): 'residential' | 'commercial' | 'largeSite' | 'none' => {
  if (sizeFactor >= 0.8 && sizeFactor <= 1.8) return 'residential';
  if (sizeFactor >= 3 && sizeFactor <= 8) return 'commercial';
  if (sizeFactor >= 10 && sizeFactor <= 18) return 'largeSite';
  return 'none';
};

describe('demo scenario header', () => {
  it('has id twin-90, 90 days, March start and a fixed seed', () => {
    expect(scenario.id).toBe('twin-90');
    expect(scenario.horizonDays).toBe(90);
    expect(company.startMonth).toBe(2);
    expect(scenario.seed).toBe(1);
    expect(scenario.actions).toEqual([]);
  });

  it('is exposed through the landscaping definition with id twin-90 and synthetic wording', () => {
    const defs = landscaping.demoScenarios ?? [];
    expect(defs.map((d) => d.id)).toEqual(['twin-90']);
    expect(demoTwinScenarios[0].name).toBe('Spring crunch (90 days)');
    expect(demoTwinScenarios[0].description).toMatch(/synthetic/i);
    expect(demoTwinScenarios[0].create()).toEqual(createDemoTwinScenario());
  });
});

describe('counts', () => {
  it('has 20 employees: 18 crew members and 2 unassigned floaters', () => {
    expect(company.employees).toHaveLength(20);
    expect(company.employees.filter((e) => e.crewId === null)).toHaveLength(2);
    expect(company.employees.filter((e) => e.crewId !== null)).toHaveLength(18);
  });

  it('has 6 crews (4 maintenance, 1 enhancement, 1 installation) with 3 members each', () => {
    expect(company.crews).toHaveLength(6);
    const counts = new Map(company.crews.map((c) => [c.id, company.employees.filter((e) => e.crewId === c.id).length]));
    expect(counts).toEqual(
      new Map([
        ['crew-m1', 3],
        ['crew-m2', 3],
        ['crew-m3', 3],
        ['crew-m4', 3],
        ['crew-e1', 3],
        ['crew-i1', 3],
      ]),
    );
  });

  it('has 6 vehicles, exactly one per crew, no spare', () => {
    expect(company.vehicles).toHaveLength(6);
    expect(company.crews.map((c) => c.vehicleId)).toEqual([
      'truck-m1',
      'truck-m2',
      'truck-m3',
      'truck-m4',
      'truck-e1',
      'truck-i1',
    ]);
    const vehicleIds = company.vehicles.map((v) => v.id).sort();
    expect(vehicleIds).toEqual(['truck-e1', 'truck-i1', 'truck-m1', 'truck-m2', 'truck-m3', 'truck-m4']);
  });

  it('has 100 customers: 60 residential, 30 commercial, 10 large sites', () => {
    expect(company.customers).toHaveLength(100);
    const bySegment = { residential: 0, commercial: 0, largeSite: 0, none: 0 };
    for (const c of company.customers) bySegment[segmentOf(c.sizeFactor)] += 1;
    expect(bySegment).toEqual({ residential: 60, commercial: 30, largeSite: 10, none: 0 });
  });

  it('has 24 equipment items, every one assigned to a crew', () => {
    expect(company.equipment).toHaveLength(24);
    expect(company.equipment.every((e) => e.crewId !== null)).toBe(true);
  });
});

describe('size factors, plans and phases', () => {
  it('keeps sizeFactor inside the spec range for each segment', () => {
    for (const c of company.customers) {
      const seg = segmentOf(c.sizeFactor);
      expect(seg, c.id).not.toBe('none');
    }
    const residential = company.customers.filter((c) => segmentOf(c.sizeFactor) === 'residential');
    expect(Math.min(...residential.map((c) => c.sizeFactor))).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...residential.map((c) => c.sizeFactor))).toBeLessThanOrEqual(1.8);
  });

  it('assigns plans: 60 weekly, 30 biweekly, 10 with no plan', () => {
    // Per block of 10: slots 0,1,2,6,7,9 weekly (6); slots 3,4,8 biweekly (3); slot 5 none (1).
    // 10 blocks: weekly 60, biweekly 30, none 10.
    const plans = company.customers.map((c) => c.recurringJobTypeId);
    expect(plans.filter((p) => p === 'mow-weekly')).toHaveLength(60);
    expect(plans.filter((p) => p === 'mow-biweekly')).toHaveLength(30);
    expect(plans.filter((p) => p === null)).toHaveLength(10);
  });

  it('phases are in [0, 1) with at most four decimals', () => {
    for (const c of company.customers) {
      expect(c.phase).toBeGreaterThanOrEqual(0);
      expect(c.phase).toBeLessThan(1);
      expect(Number((c.phase * 10000).toFixed(6)) % 1).toBe(0);
    }
  });

  it('matches hand-computed customers (cluster position, size factor, phase, plan)', () => {
    // c001 (i=0): slot 0 residential, cluster 0 centre (2.0, 1.5), k=0, r=0.12·√1, θ=0
    //   x = 2.0 + 0.12 = 2.12, y = 1.5. fraction 0·0.754877 = 0 -> sizeFactor 0.8 + 1.0·0 = 0.8.
    //   phase 0. plan slot 0 -> mow-weekly.
    const c001 = company.customers[0];
    expect(c001).toMatchObject({ id: 'c001', sizeFactor: 0.8, phase: 0, recurringJobTypeId: 'mow-weekly' });
    expect(c001.x).toBeCloseTo(2.12, 3);
    expect(c001.y).toBeCloseTo(1.5, 3);

    // c018 (i=17): slot 7 commercial, cluster 1 centre (-3.0, 2.5), k=0 -> x = -3.0 + 0.12 = -2.88, y = 2.5.
    //   17·0.754877 = 12.832909, fraction 0.832909 -> sizeFactor 3 + 5·0.832909 = 7.164545 -> 7.16.
    //   17·0.618034 = 10.506578, fraction 0.506578 -> phase 0.5066. slot 7 -> mow-weekly.
    const c018 = company.customers[17];
    expect(c018.id).toBe('c018');
    expect(c018.x).toBeCloseTo(-2.88, 3);
    expect(c018.y).toBeCloseTo(2.5, 3);
    expect(c018.sizeFactor).toBeCloseTo(7.16, 2);
    expect(c018.phase).toBeCloseTo(0.5066, 4);
    expect(c018.recurringJobTypeId).toBe('mow-weekly');

    // c035 (i=34): slot 4 residential, cluster 2 centre (4.5, -2.0), k=0 -> x = 4.62, y = -2.0.
    //   34·0.754877 = 25.665818, fraction 0.665818 -> sizeFactor 0.8 + 0.665818 = 1.465818 -> 1.47.
    //   34·0.618034 = 21.013156 -> phase 0.0132. slot 4 -> mow-biweekly.
    const c035 = company.customers[34];
    expect(c035.id).toBe('c035');
    expect(c035.x).toBeCloseTo(4.62, 3);
    expect(c035.y).toBeCloseTo(-2.0, 3);
    expect(c035.sizeFactor).toBeCloseTo(1.47, 2);
    expect(c035.phase).toBeCloseTo(0.0132, 4);
    expect(c035.recurringJobTypeId).toBe('mow-biweekly');

    // c086 (i=85): slot 5 residential, cluster 5 centre (1.0, 5.5), k=85-85=0 -> x = 1.12, y = 5.5.
    //   85·0.754877 = 64.164545, fraction 0.164545 -> sizeFactor 0.8 + 0.164545 = 0.964545 -> 0.96.
    //   85·0.618034 = 52.53289 -> phase 0.5329. slot 5 -> no plan.
    const c086 = company.customers[85];
    expect(c086.id).toBe('c086');
    expect(c086.x).toBeCloseTo(1.12, 3);
    expect(c086.y).toBeCloseTo(5.5, 3);
    expect(c086.sizeFactor).toBeCloseTo(0.96, 2);
    expect(c086.phase).toBeCloseTo(0.5329, 4);
    expect(c086.recurringJobTypeId).toBeNull();
  });
});

describe('minimum paid hours and policies', () => {
  it('minPaidHoursPerShift is at least 0.75 times shiftHours (8 × 0.75 = 6)', () => {
    expect(company.policies.shiftHours).toBe(8);
    expect(company.policies.minPaidHoursPerShift).toBe(6);
    expect(company.policies.minPaidHoursPerShift).toBeGreaterThanOrEqual(0.75 * company.policies.shiftHours);
  });

  it('turns on floating for idle workers', () => {
    expect((company.policies as unknown as Record<string, unknown>).floatIdleWorkers).toBe(true);
  });
});

describe('unique ids and references', () => {
  it('all id lists are unique', () => {
    const lists = [
      company.jobTypes.map((j) => j.id),
      company.employees.map((e) => e.id),
      company.crews.map((c) => c.id),
      company.vehicles.map((v) => v.id),
      company.equipment.map((e) => e.id),
      company.customers.map((c) => c.id),
    ];
    for (const ids of lists) expect(new Set(ids).size).toBe(ids.length);
  });

  it('every reference resolves', () => {
    const crewIds = new Set(company.crews.map((c) => c.id));
    const vehicleIds = new Set(company.vehicles.map((v) => v.id));
    const jobIds = new Set(company.jobTypes.map((j) => j.id));
    const equipmentTypeIds = new Set(landscaping.equipmentTypes.map((t) => t.id));
    for (const crew of company.crews) expect(vehicleIds.has(crew.vehicleId ?? ''), crew.id).toBe(true);
    for (const e of company.employees) expect(e.crewId === null || crewIds.has(e.crewId), e.id).toBe(true);
    for (const eq of company.equipment) {
      expect(crewIds.has(eq.crewId ?? ''), eq.id).toBe(true);
      expect(equipmentTypeIds.has(eq.equipmentTypeId), eq.id).toBe(true);
    }
    for (const c of company.customers) {
      expect(c.recurringJobTypeId === null || jobIds.has(c.recurringJobTypeId), c.id).toBe(true);
    }
  });
});

describe('crew kits can perform every job type', () => {
  // Hand-written requirements from the job type table: [id, minCrewSize, minSkill, required equipment types].
  const requirements: [string, number, number, string[]][] = [
    ['mow-weekly', 1, 1, ['mower', 'trimmer', 'blower']],
    ['mow-biweekly', 1, 1, ['mower', 'trimmer', 'blower']],
    ['cleanup', 2, 1, ['blower', 'trimmer']],
    ['mulch', 2, 2, ['dump-trailer']],
    ['aeration', 1, 2, ['aerator']],
    ['pruning', 1, 2, ['hedge-trimmer']],
    ['install', 2, 3, ['dump-trailer']],
  ];

  it('every job type has at least one qualifying crew', () => {
    for (const [jobId, minSize, minSkill, types] of requirements) {
      const qualifies = company.crews.some((crew) => {
        const members = company.employees.filter((e) => e.crewId === crew.id);
        const kit = new Set(company.equipment.filter((e) => e.crewId === crew.id).map((e) => e.equipmentTypeId));
        return members.length >= minSize && members.some((e) => e.skill >= minSkill) && types.every((t) => kit.has(t));
      });
      expect(qualifies, jobId).toBe(true);
    }
  });

  it('maintenance crews have mower, trimmer, blower and hedge trimmer; installation crew has a skill-3 lead and a trailer', () => {
    for (const id of ['crew-m1', 'crew-m2', 'crew-m3', 'crew-m4']) {
      const kit = company.equipment.filter((e) => e.crewId === id).map((e) => e.equipmentTypeId).sort();
      expect(kit).toEqual(['blower', 'hedge-trimmer', 'mower', 'trimmer']);
    }
    const installMembers = company.employees.filter((e) => e.crewId === 'crew-i1');
    expect(installMembers.some((e) => e.skill === 3)).toBe(true);
    expect(company.equipment.some((e) => e.crewId === 'crew-i1' && e.equipmentTypeId === 'dump-trailer')).toBe(true);
  });
});

describe('validation and simulation smoke test', () => {
  it('validateScenario reports no errors and no warnings', () => {
    const issues = validateScenario(scenario as unknown as Scenario);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.filter((i) => i.severity === 'warning')).toEqual([]);
  });

  it('runs 90 days with positive revenue and no warnings', () => {
    const result = runSimulation(scenario as unknown as Scenario, { detail: 'summary' });
    expect(result.days).toHaveLength(90);
    expect(result.totals.income.revenue).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });
});

describe('determinism', () => {
  it('two calls return deep-equal scenarios with distinct identity', () => {
    const a = createDemoTwinScenario();
    const b = createDemoTwinScenario();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.company.customers[0]).not.toBe(b.company.customers[0]);
  });
});

describe('dynamics metadata', () => {
  it('every demo ParamMeta path resolves to a finite number inside [min, max] on the demo company', () => {
    const entries = Object.entries(demoTwinParamMeta);
    // 12 workforce (7 scalars + 3 market wages + tenure boost + raise), 3 market, 2 vehicle/equipment aging, 1 finance = 18.
    expect(entries.length).toBe(18);
    for (const [key, meta] of entries) {
      expect(meta.path, key).toBe(key);
      expect(meta.provenance, key).toBe('industry-assumption');
      const value = valueAt(company, meta.path);
      expect(typeof value, meta.path).toBe('number');
      expect(value as number, meta.path).toBeGreaterThanOrEqual(meta.min);
      expect(value as number, meta.path).toBeLessThanOrEqual(meta.max);
    }
  });

  it('spreads the dynamics values with the spec numbers', () => {
    expect(valueAt(company, 'workforce.learningGain')).toBe(0.15);
    expect(valueAt(company, 'workforce.learningDays')).toBe(120);
    expect(valueAt(company, 'workforce.fatigueThresholdHours')).toBe(45);
    expect(valueAt(company, 'workforce.annualRaiseRate')).toBe(0.03);
    expect(valueAt(company, 'market.marketSize')).toBe(400);
    expect(valueAt(company, 'reliability.vehicle.maintenanceAgeFactorPerYear')).toBe(0.1);
    expect(valueAt(company, 'reliability.equipment.maintenanceAgeFactorPerYear')).toBe(0.1);
    expect(valueAt(company, 'finance.resaleShareOfBookValue')).toBe(0.8);
    expect(valueAt(company, 'finance.ownerDistributionCashAbove')).toBeUndefined();
  });
});
