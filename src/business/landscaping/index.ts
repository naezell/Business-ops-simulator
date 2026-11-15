import type { IndustryDefinition } from '../types';
import {
  equipmentCatalog,
  equipmentTypes,
  hireTemplates,
  standardCrew,
  vehicleCatalog,
} from './catalog';
import { landscapingJobTypes } from './jobTypes';
import { landscapingParamMeta } from './paramMeta';
import { createSampleCompany } from './sampleCompany';

export const landscaping: IndustryDefinition = {
  id: 'landscaping',
  name: 'Landscaping',
  terminology: {
    crew: ['crew', 'crews'],
    job: ['job', 'jobs'],
    customer: ['customer', 'customers'],
  },
  jobTypes: landscapingJobTypes,
  equipmentTypes,
  vehicleCatalog,
  equipmentCatalog,
  hireTemplates,
  standardCrew,
  paramMeta: landscapingParamMeta,
  createSampleCompany,
};

export { createSampleCompany, landscapingJobTypes, landscapingParamMeta };
