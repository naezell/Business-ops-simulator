/**
 * Pool of study workers implementing EvaluateBatch (implementation-contracts §5). runStudy runs on
 * the main thread as an async orchestrator; only this file touches `Worker`.
 *
 * - The base scenario is sent to each worker once; jobs carry only key, variant and seed.
 * - Jobs are distributed round-robin by index; results come back in job order.
 * - A key|seed → digest cache in the pool means identical jobs are never sent twice.
 * - terminate() kills the workers; pending batches reject with AbortError.
 */
import type { Scenario } from '../simulation';
import type { EvalJob, EvaluateBatch, RunDigest } from '../optimization';
import type { StudyWorkerIn, StudyWorkerOut } from './studyWorkerCore';

export interface WorkerLike {
  postMessage(msg: StudyWorkerIn): void;
  onmessage: ((e: MessageEvent<StudyWorkerOut>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface StudyPool {
  evaluate: EvaluateBatch;
  terminate: () => void;
  size: number;
}

export function defaultPoolSize(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.min(4, Math.max(1, hc - 1));
}

function abortError(): Error {
  const e = new Error('Study cancelled');
  e.name = 'AbortError';
  return e;
}

export function createStudyPool(base: Scenario, size = defaultPoolSize(), makeWorker?: () => WorkerLike): StudyPool {
  const factory = makeWorker ?? (() => new Worker(new URL('./studyWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  const workers = Array.from({ length: Math.max(1, size) }, factory);
  const pending = new Map<number, { resolve: (d: RunDigest[]) => void; reject: (e: Error) => void }>();
  const cache = new Map<string, RunDigest>();
  let nextBatch = 0;
  let dead = false;
  for (const w of workers) {
    w.onmessage = (e) => {
      const msg = e.data;
      const p = pending.get(msg.batchId);
      if (!p) return;
      pending.delete(msg.batchId);
      if (msg.type === 'digests') p.resolve(msg.digests);
      else p.reject(new Error(msg.message));
    };
    w.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Study worker failed'));
      pending.clear();
    };
    w.postMessage({ type: 'init', base });
  }
  const send = (w: WorkerLike, jobs: EvalJob[]) =>
    new Promise<RunDigest[]>((resolve, reject) => {
      if (dead) return reject(abortError());
      const batchId = nextBatch++;
      pending.set(batchId, { resolve, reject });
      w.postMessage({ type: 'jobs', batchId, jobs });
    });
  const evaluate: EvaluateBatch = async (jobs) => {
    if (dead) throw abortError();
    const out: (RunDigest | undefined)[] = jobs.map((j) => cache.get(`${j.key}|${j.seed}`));
    const todo: number[] = [];
    const seen = new Map<string, number>();
    jobs.forEach((j, i) => {
      if (out[i]) return;
      const k = `${j.key}|${j.seed}`;
      if (seen.has(k)) return;
      seen.set(k, i);
      todo.push(i);
    });
    const perWorker: number[][] = workers.map(() => []);
    todo.forEach((i, n) => perWorker[n % workers.length].push(i));
    const results = await Promise.all(perWorker.map((idx, w) => (idx.length > 0 ? send(workers[w], idx.map((i) => jobs[i])) : Promise.resolve([]))));
    perWorker.forEach((idx, w) => idx.forEach((i, n) => cache.set(`${jobs[i].key}|${jobs[i].seed}`, results[w][n])));
    return jobs.map((j) => cache.get(`${j.key}|${j.seed}`) as RunDigest);
  };
  return {
    evaluate,
    size: workers.length,
    terminate: () => {
      if (dead) return;
      dead = true;
      for (const w of workers) w.terminate();
      for (const p of pending.values()) p.reject(abortError());
      pending.clear();
    },
  };
}
