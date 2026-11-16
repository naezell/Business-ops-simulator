import { describe, expect, it } from 'vitest';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import * as demoTwinModule from '../../src/business/landscaping/demoTwin';
import { landscapingParamMeta } from '../../src/business/landscaping/paramMeta';
import { createSampleCompany } from '../../src/business/landscaping/sampleCompany';

/** Resolves a dot path such as "workforce.marketWageBySkill.2" on a plain object (array indices work as keys). */
function valueAt(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node === null || node === undefined ? undefined : (node as Record<string, unknown>)[key]), root);
}

/** The ParamMeta unit union, written out by hand (simulation/types.ts ParamMeta.unit). */
const UNIT_UNION = [
  'usd',
  'usd/hour',
  'usd/month',
  'hours',
  'days',
  'miles',
  'mph',
  'fraction',
  'multiplier',
  'count',
  'elasticity',
  'usd/gallon',
];

/**
 * Every new numeric digital-twin parameter, written by hand from simulation/types.ts section 4
 * (WorkforceDynamics 10 numeric fields with marketWageBySkill expanded to skills 1..3,
 * CustomerDynamics 3, AssetAging 2, FinanceDynamics 1 of 2).
 *
 * finance.ownerDistributionCashAbove is deliberately NOT listed: "omit = never pays out", and the
 * twin-90 demo leaves it undefined. It has no demo value to range-check, so it has no ParamMeta yet.
 */
const TWIN_PARAM_PATHS = [
  'workforce.learningGain',
  'workforce.learningDays',
  'workforce.fatigueThresholdHours',
  'workforce.quitFatigueWeight',
  'workforce.absenceFatigueWeight',
  'workforce.productivityFatigueLoss',
  'workforce.wageQuitElasticity',
  'workforce.marketWageBySkill.1',
  'workforce.marketWageBySkill.2',
  'workforce.marketWageBySkill.3',
  'workforce.earlyTenureQuitBoost',
  'workforce.annualRaiseRate',
  'market.referralsPerCustomerYear',
  'market.marketSize',
  'market.newCustomerChurnBoost',
  'reliability.vehicle.maintenanceAgeFactorPerYear',
  'reliability.equipment.maintenanceAgeFactorPerYear',
  'finance.resaleShareOfBookValue',
];

const demo = createDemoTwinScenario().company;

describe('digital-twin ParamMeta coverage', () => {
  it('lists 18 unique paths, all of which have a ParamMeta entry keyed by their own path', () => {
    // Hand count: workforce 12 (7 scalars, 3 skill wages, tenure boost, raise), customer 3, asset 2, finance 1 = 18.
    expect(TWIN_PARAM_PATHS).toHaveLength(18);
    expect(new Set(TWIN_PARAM_PATHS).size).toBe(18);
    for (const path of TWIN_PARAM_PATHS) {
      expect(landscapingParamMeta[path], path).toBeDefined();
      expect(landscapingParamMeta[path].path, path).toBe(path);
    }
  });

  it('has a non-empty label and a description that calls the default an illustrative assumption', () => {
    for (const path of TWIN_PARAM_PATHS) {
      const meta = landscapingParamMeta[path];
      expect(meta.label.trim().length, `${path} label`).toBeGreaterThan(0);
      expect(meta.description, `${path} description`).toMatch(/illustrative assumption/i);
    }
  });

  it('never says "benchmark" or "industry average"', () => {
    const forbidden = /benchmark|industry average/i;
    for (const path of TWIN_PARAM_PATHS) {
      const meta = landscapingParamMeta[path];
      expect(forbidden.test(meta.label), `${path} label`).toBe(false);
      expect(forbidden.test(meta.description), `${path} description`).toBe(false);
    }
  });

  it('has min <= max, step > 0, a unit from the ParamMeta union, and industry-assumption provenance', () => {
    for (const path of TWIN_PARAM_PATHS) {
      const meta = landscapingParamMeta[path];
      expect(meta.min, `${path} min <= max`).toBeLessThanOrEqual(meta.max);
      expect(meta.step, `${path} step`).toBeGreaterThan(0);
      expect(UNIT_UNION, path).toContain(meta.unit);
      expect(meta.provenance, path).toBe('industry-assumption');
    }
  });

  it('has the demo company value inside [min, max] for every path', () => {
    for (const path of TWIN_PARAM_PATHS) {
      const meta = landscapingParamMeta[path];
      const value = valueAt(demo, path);
      expect(typeof value, path).toBe('number');
      expect(Number.isFinite(value as number), path).toBe(true);
      expect(value as number, path).toBeGreaterThanOrEqual(meta.min);
      expect(value as number, path).toBeLessThanOrEqual(meta.max);
    }
  });

  it('leaves the twin dynamics absent on the sample company (optional, off by default)', () => {
    const sample = createSampleCompany();
    for (const path of TWIN_PARAM_PATHS) {
      expect(valueAt(sample, path), path).toBeUndefined();
    }
  });

  it('does not list finance.ownerDistributionCashAbove (omit = never pays out, no demo value)', () => {
    expect(landscapingParamMeta['finance.ownerDistributionCashAbove']).toBeUndefined();
    expect(valueAt(demo, 'finance.ownerDistributionCashAbove')).toBeUndefined();
  });

  it('no longer exports the separate demoTwinParamMeta map', () => {
    expect('demoTwinParamMeta' in demoTwinModule).toBe(false);
  });
});
