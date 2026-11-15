/**
 * Promise API over the optimization worker (src/services/simWorker.ts).
 * Each call gets its own worker, so `cancel` can simply terminate it.
 */
import type { IndustryDefinition } from '../business/types';
import type { OptimizationProgress, OptimizationRequest, OptimizationResult, OptimizerCatalog } from '../optimization';
import type { WorkerRequest, WorkerResponse } from './simWorker';

export interface OptimizationHandle {
  promise: Promise<OptimizationResult>;
  cancel: () => void;
}

function abortError(): Error {
  const e = new Error('Optimization cancelled');
  e.name = 'AbortError';
  return e;
}

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

export function runOptimization(
  request: OptimizationRequest,
  onProgress?: (p: OptimizationProgress) => void,
): OptimizationHandle {
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectFn: (e: Error) => void = () => {};

  const promise = new Promise<OptimizationResult>((resolve, reject) => {
    rejectFn = reject;
    const finish = () => {
      settled = true;
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (settled) return;
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.progress);
      } else if (msg.type === 'result') {
        finish();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        finish();
        const e = new Error(msg.message);
        e.name = msg.name;
        reject(e);
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      finish();
      reject(new Error(event.message || 'Optimization worker failed'));
    };
    worker.onmessageerror = () => {
      if (settled) return;
      finish();
      reject(new Error('Optimization worker sent a message that could not be read'));
    };
    // Throws DataCloneError synchronously if the request is not structured-cloneable
    // (e.g. an IndustryDefinition passed as the catalog): use catalogFromIndustry.
    try {
      worker.postMessage({ type: 'optimize', request } satisfies WorkerRequest);
    } catch (err) {
      finish();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectFn(abortError());
    },
  };
}
