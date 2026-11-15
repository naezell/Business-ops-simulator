/**
 * INDUSTRY CONTRACT — owned by the architect. See docs/architecture.md §Industries.
 *
 * An industry is pure data + one factory. The shared engine never imports a
 * specific industry; everything industry-specific reaches it through
 * CompanyConfig (which the factory builds) and through Actions built from the
 * catalog below.
 */
import type {
  CompanyConfig,
  EquipmentSpec,
  Id,
  JobTypeDef,
  NewHireSpec,
  ParamMeta,
  VehicleSpec,
} from '../simulation/types';

export interface EquipmentTypeDef {
  id: Id;
  name: string;
}

export interface HireTemplate extends NewHireSpec {
  id: Id;
  title: string;
}

export interface IndustryDefinition {
  id: Id;
  name: string;
  /** UI wording, singular/plural. */
  terminology: {
    crew: [string, string];
    job: [string, string];
    customer: [string, string];
  };
  jobTypes: JobTypeDef[];
  equipmentTypes: EquipmentTypeDef[];
  /** What can be bought/leased. Used by the UI and by the optimizer's candidate generator. */
  vehicleCatalog: (VehicleSpec & { id: Id })[];
  equipmentCatalog: (EquipmentSpec & { id: Id })[];
  hireTemplates: HireTemplate[];
  /** A standard new crew for this industry (used by the 'add-crew' candidate). */
  standardCrew: {
    hireTemplateIds: Id[];
    vehicleCatalogId: Id;
    equipmentCatalogIds: Id[];
  };
  /** Editable parameters with labels, bounds and provenance. Keyed by ParamMeta.path. */
  paramMeta: Record<string, ParamMeta>;
  /** Builds the synthetic demonstration company. Must be deterministic. */
  createSampleCompany: () => CompanyConfig;
}
