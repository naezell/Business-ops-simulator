/** simClient: the catalog posted to study workers is structured-cloneable. */
import { describe, expect, it } from 'vitest';
import { landscaping } from '../../src/business/landscaping';
import { catalogFromIndustry } from '../../src/services/simClient';

describe('catalogFromIndustry', () => {
  it('keeps only structured-cloneable catalog data', () => {
    expect(() => structuredClone(landscaping)).toThrow();
    const cat = catalogFromIndustry(landscaping);
    expect(structuredClone(cat)).toEqual({
      vehicleCatalog: landscaping.vehicleCatalog,
      equipmentCatalog: landscaping.equipmentCatalog,
      hireTemplates: landscaping.hireTemplates,
      standardCrew: landscaping.standardCrew,
    });
    expect(cat.vehicleCatalog[0]).not.toBe(landscaping.vehicleCatalog[0]);
  });
});
