/**
 * Client API for the study (optimizer v2): a worker pool simulates, the study orchestrates on the
 * main thread. The single-worker `optimize()` path was retired in O9 (`optimize()` itself remains
 * a library function).
 */
import type { IndustryDefinition } from '../business/types';
import type { OptimizerCatalog } from '../optimization';
import { runStudy } from '../optimization';
import type { StudyProgress, StudyRequest, StudyResult } from '../optimization';
import { createStudyPool } from './studyPool';

/**
 * The structured-cloneable part of an industry that the optimizer needs.
 * (IndustryDefinition carries a factory function, which cannot be posted to a worker.)
 */
export function catalogFromIndustry(industry: IndustryDefinition): OptimizerCatalog {
  return {
    vehicleCatalog: industry.vehicleCatalog.map((v) => ({ ...v })),
    equipmentCatalog: industry.equipmentCatalog.map((e) => ({ ...e })),
    hireTemplates: industry.hireTemplates.map((h) => ({ ...h })),
    standardCrew: {
      hireTemplateIds: [...industry.standardCrew.hireTemplateIds],
      vehicleCatalogId: industry.standardCrew.vehicleCatalogId,
      equipmentCatalogIds: [...industry.standardCrew.equipmentCatalogIds],
    },
  };
}

// ───────────── Study (optimizer v2) ─────────────

export interface StudyHandle {
  promise: Promise<StudyResult>;
  /** Stops the study: workers are terminated and the promise rejects with AbortError. */
  cancel: () => void;
}

/**
 * Runs a study with a worker pool: the study orchestrates on the main thread (it only awaits
 * batches), the workers simulate. Partial results arrive through `onProgress` after each phase.
 */
export function runStudyInPool(request: StudyRequest, onProgress?: (p: StudyProgress) => void, poolSize?: number): StudyHandle {
  const pool = createStudyPool(request.scenario, poolSize);
  let stopped = false;
  const promise = runStudy(request, pool.evaluate, {
    shouldStop: () => stopped,
    clock: () => performance.now(),
    onProgress,
  }).finally(() => pool.terminate());
  return {
    promise,
    cancel: () => {
      stopped = true;
      pool.terminate();
    },
  };
}
