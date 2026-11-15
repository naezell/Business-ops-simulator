/**
 * O9 gate: adopting a strategy the way the store does (dated actions + rules appended to the
 * draft) reproduces the study's Δ net profit at the store seed, bit for bit.
 */
import { describe, expect, it } from 'vitest';
import { createInProcessBackend, runStudy } from '../../src/optimization';
import { runSimulation, type Scenario } from '../../src/simulation';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { getIndustry } from '../../src/business/registry';
import { catalogFromIndustry } from '../../src/services/simClient';
import { adoptPayload } from '../../src/services/studyAdopt';

describe('adopting a study strategy', () => {
  it('reproduces its Δ net profit for the store seed', async () => {
    const scenario = createDemoTwinScenario();
    const r = await runStudy(
      {
        scenario,
        catalog: catalogFromIndustry(getIndustry('landscaping')),
        objective: 'net-profit',
        // One seed, so each Δ distribution is exactly the store seed's Δ.
        budget: { seeds: 1, screenSeeds: 1, validationSeeds: 1, maxSimulations: 500 },
        phases: ['baseline', 'singles', 'refine', 'interactions', 'plans'],
      },
      createInProcessBackend(scenario),
    );
    expect(r.seeds).toEqual([scenario.seed]);
    const picks = r.strategies.filter((s) => (s.variant.actions?.length ?? 0) + (s.variant.rules?.length ?? 0) > 0).slice(0, 4);
    expect(picks.length).toBeGreaterThan(0);
    const net = (s: Scenario) => (runSimulation(s).totals.income.netProfit);
    const base = net(scenario);
    for (const s of picks) {
      // Only actions and rules are adoptable; skip strategies that need patches/shocks/scale.
      if (s.variant.patches?.length || s.variant.shocks?.length || s.variant.customerScale !== undefined) continue;
      const { actions, rules } = adoptPayload(s);
      const draft: Scenario = { ...scenario, actions: [...scenario.actions, ...actions], ...(rules.length ? { rules: [...(scenario.rules ?? []), ...rules] } : {}) };
      expect(net(draft) - base).toBeCloseTo(s.deltaNetProfit.mean, 6);
    }
  }, 120000);
});
