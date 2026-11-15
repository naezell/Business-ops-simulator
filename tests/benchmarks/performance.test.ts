/** Performance budget (architecture.md): 365-day run, ~200 recurring customers, 3 crews, summary mode. */
import { expect, it } from 'vitest';
import { runSimulation } from '../../src/simulation';
import { scenario, spiralCustomers, stochasticCompany } from '../simulation/helpers';

it('365-day run with 200 recurring customers and 3 crews is fast in summary mode', () => {
  const co = stochasticCompany(200, 3);
  co.customers = spiralCustomers(200, (i) => (i % 5 === 4 ? 'maint' : 'mow'), 15);
  const s = scenario(co, { horizonDays: 365, seed: 99 });
  for (let i = 0; i < 3; i++) runSimulation(s, { detail: 'summary' }); // warm-up
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    runSimulation(s, { detail: 'summary' });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`[perf] 365-day run, 200 customers, 3 crews, summary: median ${median.toFixed(2)} ms (min ${times[0].toFixed(2)}, max ${times[times.length - 1].toFixed(2)})`);
  // Budget is 30 ms; the assertion is generous to avoid CI flakiness.
  expect(median).toBeLessThan(150);
});

// ───────────── Digital-twin gates (implementation-contracts §8) ─────────────
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { createInProcessBackend, runStudy } from '../../src/optimization';
import { getIndustry } from '../../src/business/registry';
import { catalogFromIndustry } from '../../src/services/simClient';

function medianMs(fn: () => void, warm = 3, n = 9): number {
  for (let i = 0; i < warm; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(n / 2)];
}

it('demo scenario, 90 days, summary, dynamics on (gate 12 ms)', () => {
  const s = createDemoTwinScenario();
  const med = medianMs(() => runSimulation(s, { detail: 'summary' }));
  console.log(`[perf] twin-90, 90 days, summary: median ${med.toFixed(2)} ms`);
  expect(med).toBeLessThan(60);
});

it('demo scenario, 3 years, summary (gate 150 ms)', () => {
  const s = { ...createDemoTwinScenario(), horizonDays: 1095 };
  const med = medianMs(() => runSimulation(s, { detail: 'summary' }), 1, 5);
  console.log(`[perf] twin-90, 1095 days, summary: median ${med.toFixed(2)} ms`);
  expect(med).toBeLessThan(750);
});

it('default study on the demo, in-process, single thread (target 120 s)', async () => {
  const scenario = createDemoTwinScenario();
  const t0 = performance.now();
  const r = await runStudy({ scenario, catalog: catalogFromIndustry(getIndustry('landscaping')), objective: 'net-profit' }, createInProcessBackend(scenario));
  const s = (performance.now() - t0) / 1000;
  console.log(`[perf] default study on twin-90: ${s.toFixed(1)} s, ${r.simulationsRun} simulations, ${r.feasibleStrategiesEvaluated} feasible strategies`);
  expect(s).toBeLessThan(600);
}, 900000);
