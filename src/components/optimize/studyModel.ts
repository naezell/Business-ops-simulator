/**
 * Pure mapping from a StudyResult to the rows the Study view draws. No React, no simulation:
 * only ordering, filtering, wording and the running sums a bridge chart needs for display.
 * Wording rules (optimization-design §11): relaxation values are upper bounds, theoretical capacity
 * is only shown next to achievable capacity, nothing is a forecast.
 */
import type { CapacityReport, LossSource, StrategyEvaluation, StudyPhase, StudyResult } from '@/optimization';
import { moneyCompact, num, percent, signedMoney } from '@/services/format';

export const STUDY_PHASES: { id: StudyPhase; label: string }[] = [
  { id: 'baseline', label: 'Measure today' },
  { id: 'loss-attribution', label: 'Find the losses' },
  { id: 'capacity', label: 'Test capacity' },
  { id: 'singles', label: 'Try single changes' },
  { id: 'refine', label: 'Tune timing and price' },
  { id: 'interactions', label: 'Check pairs' },
  { id: 'plans', label: 'Combine the best' },
  { id: 'validation', label: 'Stress-test finalists' },
];

export type PhaseState = 'done' | 'active' | 'pending';

/** State of each phase given the completed list and the phase now running (null when not running). */
export function phaseStates(completed: readonly StudyPhase[], active: StudyPhase | null): { id: StudyPhase; label: string; state: PhaseState }[] {
  return STUDY_PHASES.map((p) => ({ ...p, state: completed.includes(p.id) ? 'done' : p.id === active ? 'active' : 'pending' }));
}

// ───────────────────────── Loss attribution ─────────────────────────

export interface LossRow {
  id: LossSource['id'];
  label: string;
  mean: number;
  min: number;
  max: number;
  share: number;
  /** Demand is the value of MORE demand, not the removal of a loss. */
  isDemand: boolean;
  /** Mean is below $1: removing the source does not help in these runs. */
  noGain: boolean;
  /** Sentence respecting the upper-bound wording rule. */
  sentence: string;
}

export function lossRows(sources: readonly LossSource[]): LossRow[] {
  return [...sources]
    .sort((a, b) => b.valueIfEliminated.mean - a.valueIfEliminated.mean)
    .map((s) => {
      const m = s.valueIfEliminated.mean;
      const isDemand = s.id === 'demand-shortfall';
      const noGain = m < 1;
      const sentence = noGain
        ? `No measurable gain (${signedMoney(m)}) if ${s.relaxation}.`
        : isDemand
          ? `Value of more demand: at most about ${moneyCompact(m)} if ${s.relaxation}.`
          : `At most about ${moneyCompact(m)} if ${s.relaxation}.`;
      return { id: s.id, label: s.label, mean: m, min: s.valueIfEliminated.min, max: s.valueIfEliminated.max, share: s.shareOfRevenue, isDemand, noGain, sentence };
    });
}

// ───────────────────────── Capacity ─────────────────────────

export interface CapacityChartPoint {
  scale: number;
  customers: number;
  hours: number;
  missedPct: number;
  latePct: number;
}

/** Points sorted by scale; percentages are for display (rate × 100). */
export function capacityChartData(c: CapacityReport): CapacityChartPoint[] {
  return [...c.points]
    .sort((a, b) => a.scale - b.scale)
    .map((p) => ({ scale: p.scale, customers: p.customers, hours: p.throughputHoursPerWeek, missedPct: p.missedJobRate * 100, latePct: p.lateJobRate * 100 }));
}

export function headroomText(c: CapacityReport): string {
  const n = Math.floor(c.headroomCustomers);
  if (n > 0) return `Can take about ${num(n)} more customers while keeping service.`;
  if (n === 0) return 'No room for more customers while keeping service.';
  return `Already about ${num(-n)} customers past the point where service holds.`;
}

export interface BridgeStep {
  id: string;
  label: string;
  hoursPerWeek: number;
  /** Bar from `from` to `to` (display coordinates, hours per week). */
  from: number;
  to: number;
  /** First and last steps are totals measured from zero. */
  total: boolean;
}

/** Running sums for a waterfall: first entry starts the bridge, last entry is the total reached; the rest are signed steps. */
export function bridgeSteps(bridge: CapacityReport['lossBridge']): BridgeStep[] {
  let run = 0;
  return bridge.map((b, i) => {
    const total = i === 0 || i === bridge.length - 1;
    if (total) {
      run = b.hoursPerWeek;
      return { ...b, from: 0, to: b.hoursPerWeek, total };
    }
    const from = run;
    run += b.hoursPerWeek;
    return { ...b, from, to: run, total };
  });
}

// ───────────────────────── Strategies ─────────────────────────

export const VERDICT_LABEL: Record<StrategyEvaluation['verdict'], string> = {
  recommended: 'Recommended',
  conditional: 'Conditional',
  'not-recommended': 'Not recommended',
};

/** Recommended and conditional by default; everything feasible when `all`. Order is the study's (best score first). */
export function visibleStrategies(r: Pick<StudyResult, 'strategies'>, all: boolean): StrategyEvaluation[] {
  return all ? r.strategies : r.strategies.filter((s) => s.verdict !== 'not-recommended');
}

export function hiddenCount(r: Pick<StudyResult, 'strategies'>): number {
  return r.strategies.length - visibleStrategies(r, false).length;
}

export type Tone = 'good' | 'warn' | 'neutral';

export function longRunBadge(s: StrategyEvaluation): { text: string; tone: Tone; title: string } {
  const lr = s.validation?.longRun;
  if (!lr) return { text: s.validation ? 'not validated long-run' : 'not validated', tone: 'neutral', title: 'The long-run check was not run for this strategy (budget or not a finalist).' };
  const years = num(lr.horizonDays / 365, 1).replace(/\.0$/, '');
  if (lr.verdict === 'holds') return { text: `holds over ${years} yr`, tone: 'good', title: 'The gain per year after the planning period is at least a quarter of the gain inside it.' };
  if (lr.verdict === 'fades') return { text: `fades over ${years} yr`, tone: 'warn', title: 'After the planning period the yearly gain is under a quarter of what it is inside it.' };
  return { text: `reverses over ${years} yr`, tone: 'warn', title: 'Over the long horizon the strategy ends up no better than doing nothing.' };
}

export function stressBadge(s: StrategyEvaluation): { text: string; tone: Tone; title: string } | null {
  const st = s.validation?.stress;
  if (!st) return null;
  const n = st.cases.length;
  const ok = st.cases.filter((c) => c.delta > 0 && c.feasible).length;
  return {
    text: `holds in ${ok} of ${n} stress cases`,
    tone: st.robustShare >= 2 / 3 ? 'good' : 'warn',
    title: `Share of stress cases that still improve and stay feasible: ${percent(st.robustShare, 0)}. Worst case ${signedMoney(st.worstCase)}.`,
  };
}

export function flipsText(s: StrategyEvaluation): string | null {
  const f = s.validation?.sensitivity.flips ?? [];
  if (f.length === 0) return null;
  return `Changes sign if ${f.map((x) => `${x.label} ×${num(x.factor, 2).replace(/0$/, '').replace(/\.$/, '')}`).join(', ')}`;
}

export function paybackLabel(s: StrategyEvaluation): string {
  if (s.upfrontCash <= 0) return 'no upfront cost';
  if (s.paybackDays === null) return 'not paid back within the plan';
  const d = Math.round(s.paybackDays);
  return d >= 60 ? `about ${num(d / 30.4, 1).replace(/\.0$/, '')} months` : `${d} days`;
}

/** Display day label: simulation day 0 is "Day 1" (same numbering as the plan timeline). */
export function memberDayLabel(day: number): string {
  return `Day ${day + 1}`;
}

// ───────────────────────── Adopt ─────────────────────────

export { adoptPayload, mergeRules, type AdoptPayload } from '@/services/studyAdopt';
