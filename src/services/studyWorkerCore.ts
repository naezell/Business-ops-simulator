/**
 * Message handling of the study worker, kept free of the Worker global so it can be tested in Node
 * (implementation-contracts §5). The base scenario is sent once ('init'); jobs carry key, variant, seed.
 */
import { createDrawCache, type DrawCache, type Scenario } from '../simulation';
import { runJob, type EvalJob, type RunDigest } from '../optimization';

export type StudyWorkerIn = { type: 'init'; base: Scenario } | { type: 'jobs'; batchId: number; jobs: EvalJob[] };
export type StudyWorkerOut =
  | { type: 'digests'; batchId: number; digests: RunDigest[] }
  | { type: 'error'; batchId: number; message: string };

export interface StudyWorkerState {
  base: Scenario | null;
  draws: DrawCache;
  cache: Map<string, RunDigest>;
}

export function createWorkerState(): StudyWorkerState {
  return { base: null, draws: createDrawCache(), cache: new Map() };
}

/** Handles one message; returns the reply (null for 'init'). */
export function handleStudyMessage(state: StudyWorkerState, msg: StudyWorkerIn): StudyWorkerOut | null {
  if (msg.type === 'init') {
    state.base = msg.base;
    state.draws = createDrawCache();
    state.cache.clear();
    return null;
  }
  try {
    if (!state.base) throw new Error('study worker not initialised');
    const digests = msg.jobs.map((j) => {
      const k = `${j.key}|${j.seed}`;
      let d = state.cache.get(k);
      if (!d) {
        d = runJob(state.base as Scenario, j, state.draws);
        state.cache.set(k, d);
      }
      return d;
    });
    return { type: 'digests', batchId: msg.batchId, digests };
  } catch (err) {
    return { type: 'error', batchId: msg.batchId, message: err instanceof Error ? err.message : String(err) };
  }
}
