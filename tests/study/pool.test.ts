/** Worker pool (implementation-contracts §5) with fake in-process workers; the study result must not depend on it. */
import { describe, expect, it } from 'vitest';
import { createInProcessBackend, runStudy, variantKey, type StudyRequest } from '../../src/optimization';
import { createStudyPool, type WorkerLike } from '../../src/services/studyPool';
import { createWorkerState, handleStudyMessage, type StudyWorkerIn, type StudyWorkerOut } from '../../src/services/studyWorkerCore';
import { catalog, oneCrew, sc } from './helpers';

/** A fake worker that answers asynchronously, `delay` microtask hops later (to scramble completion order). */
function fakeWorker(delay: number, log: StudyWorkerIn[]): WorkerLike {
  const state = createWorkerState();
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => {
      w.onmessage = null;
    },
    postMessage: (msg) => {
      log.push(msg);
      const reply = handleStudyMessage(state, structuredClone(msg));
      if (!reply) return;
      let p = Promise.resolve();
      for (let i = 0; i < delay; i++) p = p.then(() => undefined);
      void p.then(() => w.onmessage?.({ data: structuredClone(reply) } as MessageEvent<StudyWorkerOut>));
    },
  };
  return w;
}

describe('study pool', () => {
  const scenario = sc(oneCrew(40), 28);

  it('round-robins jobs, returns them in job order, sends the base once per worker and never repeats a job', async () => {
    const logs: StudyWorkerIn[][] = [[], [], []];
    let n = 0;
    const pool = createStudyPool(scenario, 3, () => fakeWorker(3 - n, logs[n++]));
    const jobs = [1, 2, 3, 4, 5].map((seed) => ({ key: variantKey({}), variant: {}, seed }));
    const a = await pool.evaluate(jobs);
    const b = await pool.evaluate([...jobs].reverse());
    expect(a.map((d) => d.seed)).toEqual([1, 2, 3, 4, 5]);
    expect(b.map((d) => d.seed)).toEqual([5, 4, 3, 2, 1]);
    expect(logs.map((l) => l.filter((m) => m.type === 'init').length)).toEqual([1, 1, 1]);
    const sent = logs.flatMap((l) => l.flatMap((m) => (m.type === 'jobs' ? m.jobs.map((j) => j.seed) : [])));
    expect(sent.sort()).toEqual([1, 2, 3, 4, 5]); // second call served from the pool cache
    expect(logs[0].filter((m) => m.type === 'jobs').flatMap((m) => (m.type === 'jobs' ? m.jobs.map((j) => j.seed) : []))).toEqual([1, 4]);
    expect(structuredClone(a)).toEqual(a);
  });

  it('terminate rejects pending and later batches with AbortError', async () => {
    const pool = createStudyPool(scenario, 2, () => {
      const w: WorkerLike = { onmessage: null, onerror: null, terminate: () => undefined, postMessage: () => undefined };
      return w;
    });
    const p = pool.evaluate([{ key: '{}', variant: {}, seed: 1 }]);
    pool.terminate();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pool.evaluate([{ key: '{}', variant: {}, seed: 2 }])).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a study through the pool equals the in-process study', async () => {
    const req: StudyRequest = { scenario, catalog, objective: 'net-profit', budget: { maxSimulations: 120, seeds: 2, screenSeeds: 2, validationSeeds: 1, finalists: 1 }, longRunDays: 56 };
    let n = 0;
    const pool = createStudyPool(scenario, 3, () => fakeWorker(1 + (n++ % 3), []));
    const viaPool = await runStudy(req, pool.evaluate);
    const inProc = await runStudy(req, createInProcessBackend(scenario));
    expect({ ...viaPool, elapsedMs: 0 }).toEqual({ ...inProc, elapsedMs: 0 });
  }, 60000);
});
