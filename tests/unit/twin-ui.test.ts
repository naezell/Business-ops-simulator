/**
 * S12: demo scenario switching in the store, persistence v4, rule editor model and persistence of rules,
 * and the synthetic-data label on every results page. Expected values are written by hand.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionRule } from '../../src/simulation';
import { migratePersisted, STORAGE_VERSION } from '../../src/services/persistence';
import { scenarioKey, selectHasUserWork, useStore, validateRuleList } from '../../src/services/store';
import { landscaping } from '../../src/business/landscaping';
import { createDemoTwinScenario } from '../../src/business/landscaping/demoTwin';
import { dayFeed } from '../../src/services/playback';
import { OBSERVABLE_INFO, describeCondition, emptyForm, formOf, fromShown, ruleOf, toShown } from '../../src/components/rules/ruleModel';
import { OBSERVABLES } from '../../src/simulation/rules';
import { OperationsPage } from '../../src/pages/OperationsPage';
import { FinancialsPage } from '../../src/pages/FinancialsPage';
import { BusinessPage } from '../../src/pages/BusinessPage';
import { OptimizePage } from '../../src/pages/OptimizePage';
import { SyntheticLabel } from '../../src/components/SyntheticLabel';

const flush = () => vi.runAllTimers();
const state = () => useStore.getState();

const base = {
  industryId: 'landscaping',
  seed: 7,
  horizonMonths: 6,
  baselineActions: [],
  draft: { actions: [], rules: [] as DecisionRule[] },
  patch: {},
  shocks: [],
  selectedDay: 3,
  view: 'business',
};

describe('persistence v4', () => {
  it('migrates v3 to v4 with no demo scenario', () => {
    const m = migratePersisted({ ...base, version: 3 })!;
    expect(STORAGE_VERSION).toBe(4);
    expect(m.version).toBe(4);
    expect(m.demoScenarioId).toBeNull();
    expect(m.seed).toBe(7);
  });
  it('round-trips a demo scenario id and decision rules', () => {
    const rule: DecisionRule = {
      id: 'rule-1',
      name: 'Replace a worn truck',
      forEach: 'vehicle',
      when: [{ observable: 'asset-down-days-90d', op: '>=', value: 5, scope: { assetId: '$each' } }],
      then: [{ type: 'dispose-asset', assetId: '$each' }],
      cooldownDays: 30,
      maxFirings: 1,
      activeFromDay: 10,
      activeToDay: 60,
    };
    const v4 = { ...base, version: 4, demoScenarioId: 'twin-90', shocks: [], draft: { actions: [], rules: [rule] } };
    const m = migratePersisted(JSON.parse(JSON.stringify(v4)))!;
    expect(m.demoScenarioId).toBe('twin-90');
    expect(m.draft.rules).toEqual([rule]);
    expect(migratePersisted(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
  it('treats a missing or non-string id in v4 as no demo', () => {
    expect(migratePersisted({ ...base, version: 4, shocks: [] })!.demoScenarioId).toBeNull();
    expect(migratePersisted({ ...base, version: 4, shocks: [], demoScenarioId: 5 })!.demoScenarioId).toBeNull();
  });
});

describe('demo scenario switching', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    useStore.getState().resetEverything();
    flush();
    vi.useRealTimers();
  });

  it('takes the demo company, horizon and seed, and clears the draft and selected day', () => {
    const demo = createDemoTwinScenario();
    state().setSelectedDay(5);
    state().setDraftAction({ type: 'set-marketing-spend', monthlySpend: 900 }, 0);
    flush();
    const keyBefore = scenarioKey(state());
    expect(selectHasUserWork(state())).toBe(true);
    state().setDemoScenario('twin-90');
    flush();
    const s = state();
    expect(s.demoScenarioId).toBe('twin-90');
    expect(s.company.name).toBe(demo.company.name);
    expect(s.horizonDays).toBe(90);
    expect(s.baselineResult.horizonDays).toBe(90);
    expect(s.seed).toBe(demo.seed);
    expect(s.baselineResult.seed).toBe(demo.seed);
    expect(s.draft).toEqual({ actions: [], rules: [] });
    expect(s.selectedDay).toBe(0);
    expect(scenarioKey(s)).not.toBe(keyBefore);
    expect(selectHasUserWork(s)).toBe(false);
    // Back to the sample company.
    state().setDemoScenario(null);
    flush();
    expect(state().demoScenarioId).toBeNull();
    expect(state().company.name).toBe(landscaping.createSampleCompany().name);
    expect(state().horizonDays).not.toBe(90);
  });

  it('keeps the demo scenario\'s own shocks and rules and appends the user\'s', () => {
    const def = {
      id: 'test-demo',
      name: 'Test demo',
      description: 'with a shock',
      create: () => {
        const sc = createDemoTwinScenario();
        return { ...sc, id: 'test-demo', shocks: [{ type: 'multiplier' as const, target: 'fuel-price' as const, factor: 1.5, fromDay: 0, toDay: 10 }] };
      },
    };
    landscaping.demoScenarios = [...(landscaping.demoScenarios ?? []), def];
    try {
      state().setDemoScenario('test-demo');
      flush();
      const started = (r: typeof state extends () => infer S ? (S extends { baselineResult: infer R } ? R : never) : never) =>
        (r.events as { type: string }[]).filter((e) => e.type === 'shock-started').length;
      expect(started(state().baselineResult)).toBe(1);
      state().addShock({ type: 'weather', state: 'rainout', fromDay: 20, toDay: 22 });
      flush();
      expect(started(state().baselineResult)).toBe(2);
      expect(state().shocks).toHaveLength(1);
    } finally {
      landscaping.demoScenarios = landscaping.demoScenarios?.filter((d) => d.id !== 'test-demo');
    }
  });

  it('ignores unknown ids', () => {
    state().setDemoScenario('nope');
    expect(state().demoScenarioId).toBeNull();
  });
});

describe('rule editor model', () => {
  it('builds a rule from the form with 0-based engine days and a scope', () => {
    const form = {
      ...emptyForm(),
      name: ' Fix the van ',
      forEach: 'vehicle' as const,
      when: [{ observable: 'asset-down-days-90d' as const, op: '>=' as const, value: 5, scopeId: '$each' }],
      then: [{ type: 'dispose-asset' as const, assetId: '$each' }],
      cooldownDays: 30,
      maxFirings: 2,
      fromDay: 11,
      toDay: 60,
    };
    expect(ruleOf(form, [])).toEqual({
      id: 'rule-1',
      name: 'Fix the van',
      forEach: 'vehicle',
      when: [{ observable: 'asset-down-days-90d', op: '>=', value: 5, scope: { assetId: '$each' } }],
      then: [{ type: 'dispose-asset', assetId: '$each' }],
      cooldownDays: 30,
      maxFirings: 2,
      activeFromDay: 10,
      activeToDay: 60,
    });
  });
  it('round-trips a rule through the form and picks unused ids', () => {
    const r: DecisionRule = {
      id: 'rule-3',
      name: 'Cash guard',
      when: [{ observable: 'available-cash', op: '<', value: 1000 }],
      then: [{ type: 'set-marketing-spend', monthlySpend: 0 }],
      cooldownDays: 7,
      maxFirings: 3,
    };
    expect(ruleOf(formOf(r), [])).toEqual(r);
    expect(ruleOf(emptyForm(), [r, { ...r, id: 'rule-1' }]).id).toBe('rule-2');
  });
  it('covers every engine observable and converts shown values', () => {
    expect(OBSERVABLE_INFO.map((o) => o.id).sort()).toEqual([...OBSERVABLES].sort());
    const day = OBSERVABLE_INFO.find((o) => o.id === 'day')!;
    expect(toShown(day, 0)).toBe(1);
    expect(fromShown(day, 31)).toBe(30);
    const month = OBSERVABLE_INFO.find((o) => o.id === 'month')!;
    expect(fromShown(month, 1)).toBe(0);
  });
  it('describes conditions in words', () => {
    expect(describeCondition({ observable: 'utilization-28d', op: '<', value: 0.6 }, (x) => x)).toBe('Utilization, last 28 days is below 60%');
    expect(describeCondition({ observable: 'crew-size', op: '<', value: 3, scope: { crewId: '$each' } }, () => 'x')).toContain('(each one)');
  });
  it('uses the engine validator for rule issues, relative to the rule list', () => {
    const bad: DecisionRule = { id: 'r', name: 'x', when: [{ observable: 'crew-size', op: '<', value: 2 }], then: [], cooldownDays: 1, maxFirings: 1 };
    const issues = validateRuleList(state(), [bad]);
    const paths = issues.map((i) => i.path);
    expect(paths).toContain('rules[0].then');
    expect(paths).toContain('rules[0].when[0].scope');
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    const good: DecisionRule = { ...bad, then: [{ type: 'set-marketing-spend', monthlySpend: 0 }], when: [{ observable: 'cash', op: '<', value: 0 }] };
    expect(validateRuleList(state(), [good])).toEqual([]);
  });
  it('shows rule names and entities in the day feed', () => {
    const names: Record<string, string> = { 'rule-1': 'Fix the van', v1: 'Truck 1' };
    const feed = dayFeed(4, [{ day: 4, type: 'rule-fired', ruleId: 'rule-1', entityId: 'v1' }] as never, [], (id) => names[id] ?? id);
    expect(feed.map((f) => f.text)).toEqual(['Rule fired: Fix the van (Truck 1)']);
  });
});

describe('synthetic demonstration data label', () => {
  const LABEL = 'Synthetic demonstration data';
  it('renders in the shared component', () => {
    expect(renderToStaticMarkup(createElement(SyntheticLabel))).toContain(LABEL);
  });
  const pages = { Operations: OperationsPage, Financials: FinancialsPage, Business: BusinessPage, Optimize: OptimizePage };
  for (const [name, Page] of Object.entries(pages)) {
    it(`${name} page shows it`, () => {
      expect(renderToStaticMarkup(createElement(Page))).toContain(LABEL);
    });
    it(`${name} page shows it with a demo scenario selected`, () => {
      state().setDemoScenario('twin-90');
      try {
        expect(renderToStaticMarkup(createElement(Page))).toContain(LABEL);
      } finally {
        state().setDemoScenario(null);
      }
    });
  }
});
