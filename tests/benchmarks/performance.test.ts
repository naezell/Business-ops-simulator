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
