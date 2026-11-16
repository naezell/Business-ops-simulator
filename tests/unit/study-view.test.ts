/**
 * Study view helpers (S10): mapping a recorded StudyResult to view rows. Expected values are
 * computed independently from the fixture JSON or by hand.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/study-result.json';
import type { StrategyEvaluation, StudyResult } from '../../src/optimization';
import type { DecisionRule } from '../../src/simulation/types-twin';
import {
  adoptPayload,
  bridgeSteps,
  capacityChartData,
  headroomText,
  hiddenCount,
  longRunBadge,
  lossRows,
  memberDayLabel,
  mergeRules,
  paybackLabel,
  phaseStates,
  stressBadge,
  visibleStrategies,
} from '../../src/components/optimize/studyModel';

const r = fixture as unknown as StudyResult;

describe('phases', () => {
  it('marks done, active and pending', () => {
    const s = phaseStates(['baseline', 'loss-attribution'], 'capacity');
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'active', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(phaseStates(r.phasesCompleted, null).every((x) => x.state === 'done')).toBe(true);
  });
});

describe('loss attribution', () => {
  const rows = lossRows(r.lossAttribution);
  it('sorts by mean value, descending, keeping every source', () => {
    expect(rows).toHaveLength(r.lossAttribution.length);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].mean).toBeGreaterThanOrEqual(rows[i].mean);
    expect(rows[0].id).toBe('demand-shortfall');
  });
  it('uses upper-bound wording, labels demand, and does not claim a gain where there is none', () => {
    expect(rows[0].isDemand).toBe(true);
    expect(rows[0].sentence).toMatch(/^Value of more demand: at most about \$59k if /);
    const travel = rows.find((x) => x.id === 'travel')!;
    expect(travel.sentence).toMatch(/^At most about \$31k if travel takes no time/);
    const weather = rows.find((x) => x.id === 'weather')!;
    expect(weather.noGain).toBe(true);
    expect(weather.sentence).toMatch(/^No measurable gain/);
  });
});

describe('capacity', () => {
  const c = r.capacity!;
  it('sorts points by scale and converts rates to percent', () => {
    const d = capacityChartData(c);
    expect(d).toHaveLength(c.points.length);
    for (let i = 1; i < d.length; i++) expect(d[i].scale).toBeGreaterThanOrEqual(d[i - 1].scale);
    const p1 = d.find((x) => x.scale === 1)!;
    expect(p1.missedPct).toBeCloseTo(1.5833268615, 6);
    expect(p1.hours).toBeCloseTo(332.683692692872, 9);
  });
  it('words headroom for positive, zero and negative values', () => {
    expect(headroomText(c)).toBe('Can take about 30 more customers while keeping service.');
    expect(headroomText({ ...c, headroomCustomers: 0 })).toMatch(/No room/);
    expect(headroomText({ ...c, headroomCustomers: -12 })).toBe('Already about 12 customers past the point where service holds.');
  });
  it('builds a bridge that starts at the first value and reaches the last total', () => {
    const steps = bridgeSteps(c.lossBridge);
    expect(steps[0]).toMatchObject({ from: 0, to: c.lossBridge[0].hoursPerWeek, total: true });
    const mid = steps.slice(1, -1);
    const sum = c.lossBridge[0].hoursPerWeek + mid.reduce((a, s) => a + s.hoursPerWeek, 0);
    expect(mid[mid.length - 1].to).toBeCloseTo(sum, 9);
    // the fixture's bridge sums to the achievable saturation within rounding
    expect(sum).toBeCloseTo(c.saturationHoursPerWeek, 6);
    expect(steps[steps.length - 1]).toMatchObject({ total: true, to: c.saturationHoursPerWeek });
  });
});

describe('strategies', () => {
  it('shows recommended and conditional by default, everything feasible when asked', () => {
    const nonRec = r.strategies.filter((s) => s.verdict !== 'not-recommended').length;
    expect(visibleStrategies(r, false)).toHaveLength(nonRec);
    expect(visibleStrategies(r, true)).toHaveLength(r.strategies.length);
    expect(hiddenCount(r)).toBe(r.strategies.length - nonRec);
    expect(visibleStrategies(r, false).every((s) => s.verdict !== 'not-recommended')).toBe(true);
  });
  it('badges: not validated, validated long-run, stress', () => {
    const plain = r.strategies.find((s) => !s.validation)!;
    expect(longRunBadge(plain).text).toBe('not validated');
    const v = r.strategies.find((s) => s.validation)!;
    const lr = longRunBadge(v);
    expect(lr.text).toBe(`${v.validation!.longRun!.verdict} over 2 yr`);
    const noLong: StrategyEvaluation = { ...v, validation: { ...v.validation!, longRun: null } };
    expect(longRunBadge(noLong).text).toBe('not validated long-run');
    expect(stressBadge(plain)).toBeNull();
    const st = stressBadge(v)!;
    expect(st.text).toBe(`holds in ${v.validation!.stress.cases.filter((c) => c.delta > 0 && c.feasible).length} of ${v.validation!.stress.cases.length} stress cases`);
  });
  it('labels days 1-based and payback in words', () => {
    expect(memberDayLabel(0)).toBe('Day 1');
    expect(memberDayLabel(29)).toBe('Day 30');
    const s = r.strategies[0];
    expect(paybackLabel({ ...s, upfrontCash: 0 })).toBe('no upfront cost');
    expect(paybackLabel({ ...s, upfrontCash: 100, paybackDays: null })).toBe('not paid back within the plan');
    expect(paybackLabel({ ...s, upfrontCash: 100, paybackDays: 30 })).toBe('30 days');
    expect(paybackLabel({ ...s, upfrontCash: 100, paybackDays: 91.2 })).toBe('about 3 months');
  });
});

describe('adopt', () => {
  it('returns the variant actions with their days and rules', () => {
    const withRules = r.strategies.find((s) => (s.variant.rules?.length ?? 0) > 0)!;
    const p = adoptPayload(withRules);
    expect(p.actions).toEqual(withRules.variant.actions ?? []);
    expect(p.rules).toEqual(withRules.variant.rules);
    const none = r.strategies.find((s) => !s.variant.rules)!;
    expect(adoptPayload(none).rules).toEqual([]);
  });
  it('de-duplicates rules by id and keeps the existing one', () => {
    const rule = (id: string, name: string): DecisionRule => ({ id, name, when: [], then: [], cooldownDays: 1, maxFirings: 1 });
    const merged = mergeRules([rule('a', 'old')], [rule('a', 'new'), rule('b', 'b'), rule('b', 'b2')]);
    expect(merged.map((x) => `${x.id}:${x.name}`)).toEqual(['a:old', 'b:b']);
  });
});
