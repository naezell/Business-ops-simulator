/**
 * simClient protocol tests with a stand-in Worker (Node has no module workers).
 * The fake speaks simWorker's message protocol by calling the real optimizer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { landscaping } from '../../src/business/landscaping';
import { optimize } from '../../src/optimization';
import { catalogFromIndustry, runOptimization } from '../../src/services/simClient';
import { request, testCatalog, zeroElasticity } from './scenarios';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor(
    public url: URL,
    public options: { type?: string },
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { type: string; request: Parameters<typeof optimize>[0] }) {
    const req = structuredClone(msg.request); // fails like the real thing on non-cloneable input
    setTimeout(() => {
      if (this.terminated) return;
      const result = optimize(req, (progress) => this.onmessage?.({ data: { type: 'progress', progress } }));
      if (!this.terminated) this.onmessage?.({ data: { type: 'result', result } });
    }, 0);
  }
  terminate() {
    this.terminated = true;
  }
}

const g = globalThis as { Worker?: unknown };
let saved: unknown;
beforeEach(() => {
  saved = g.Worker;
  g.Worker = FakeWorker;
  FakeWorker.instances = [];
});
afterEach(() => {
  g.Worker = saved;
});

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

describe('runOptimization', () => {
  const req = request(zeroElasticity(), testCatalog(), { seedCount: 1, maxPlanSize: 1 });

  it('creates a module worker, reports progress and resolves with the optimizer result', async () => {
    const phases: string[] = [];
    const handle = runOptimization(req, (p) => phases.push(p.phase));
    const result = await handle.promise;
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].options.type).toBe('module');
    expect(String(FakeWorker.instances[0].url)).toMatch(/simWorker\.ts$/);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(phases[0]).toBe('baseline');
    expect(phases).toContain('singles');
    expect(result).toEqual(optimize(req));
  });

  it('cancel terminates the worker and rejects with an AbortError', async () => {
    const handle = runOptimization(req);
    handle.cancel();
    await expect(handle.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});
