/**
 * Refinement (optimization-design §6): start-day search with temporary variants, and a
 * golden-section line search on price multipliers.
 */
import type { PlannedAction } from '../../simulation';
import type { StrategyEvaluation } from '../study-types';
import { evaluateDefs, meanDelta, type StratDef, type StudyContext } from './context';
import type { BaselineFacts } from './generate';

export const TIMING_CATEGORIES = ['staffing', 'crew', 'fleet', 'equipment', 'marketing'];
export const TIMING_CANDIDATES = 6;
export const MAX_START_DAYS = 6;
export const PRICE_BOUNDS: [number, number] = [0.85, 1.3];
export const GOLDEN_EVALS = 4;
export const GOLDEN_TOL = 0.01;
export const REPLACE_MIN_GAIN_USD = 100;
export const REPLACE_MIN_GAIN_SHARE = 0.02;

/** Day 0 plus first-of-month days, thinned to at most `max` evenly spaced (first and last kept). */
export function startDays(monthStarts: number[], max = MAX_START_DAYS): number[] {
  const all = [0, ...monthStarts.filter((d) => d > 0)];
  if (all.length <= max) return all;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(all[Math.round((i * (all.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

/** The same strategy starting on `day` (every action moved; rules unchanged). */
export function shifted(d: StratDef, day: number): StratDef {
  if (day === 0) return d;
  return {
    ...d,
    id: `${d.id}@d${day}`,
    label: `${d.label}, from day ${day + 1}`,
    members: d.members.map((m) => ({ ...m, day })),
    actions: d.actions.map((a) => ({ ...a, day })),
  };
}

/**
 * Temporary variant (§6): a hire or a marketing increase that starts on `day` and is reversed on
 * the first first-of-month after it whose baseline month had no cancelled jobs. Null if not applicable.
 */
export function temporary(ctx: StudyContext, d: StratDef, day: number, facts: BaselineFacts): StratDef | null {
  if (d.actions.length !== 1 || d.rules.length > 0) return null;
  const a = d.actions[0].action;
  const end = facts.months.find((m) => m.startDay > day && m.jobsCancelled === 0)?.startDay;
  if (end === undefined) return null;
  const index = ctx.base.actions.length; // the strategy's actions follow the scenario's own
  let undo: PlannedAction | null = null;
  if (a.type === 'hire-employee') undo = { day: end, action: { type: 'remove-employee', employeeId: `h-d${day}-${index}-0` } };
  else if (a.type === 'set-marketing-spend' && a.monthlySpend > ctx.company.market.marketingMonthlySpend)
    undo = { day: end, action: { type: 'set-marketing-spend', monthlySpend: ctx.company.market.marketingMonthlySpend } };
  if (!undo) return null;
  const s = shifted(d, day);
  return {
    ...s,
    id: `${d.id}@d${day}-d${end}`,
    label: `${d.label}, from day ${day + 1} to day ${end}`,
    actions: [...s.actions, undo],
  };
}

function better(a: StrategyEvaluation, b: StrategyEvaluation, objective: StudyContext['objective']): boolean {
  const ga = meanDelta(a, objective);
  const gb = meanDelta(b, objective);
  return ga > gb + Math.max(REPLACE_MIN_GAIN_USD, REPLACE_MIN_GAIN_SHARE * Math.abs(gb));
}

/** Timing search. Returns new strategy evaluations (on K seeds) that beat their day-0 version. */
export async function refineTiming(
  ctx: StudyContext,
  singles: { def: StratDef; ev: StrategyEvaluation }[],
  facts: BaselineFacts,
): Promise<{ def: StratDef; ev: StrategyEvaluation }[]> {
  const days = startDays(facts.months.map((m) => m.startDay));
  const picks = singles
    .filter((s) => s.ev.feasible && s.def.rules.length === 0 && TIMING_CATEGORIES.includes(s.def.category))
    .sort((a, b) => Math.abs(meanDelta(b.ev, ctx.objective)) - Math.abs(meanDelta(a.ev, ctx.objective)) || (a.def.id < b.def.id ? -1 : 1))
    .slice(0, TIMING_CANDIDATES);
  const out: { def: StratDef; ev: StrategyEvaluation }[] = [];
  for (const p of picks) {
    const variants = days.filter((d) => d > 0).map((d) => shifted(p.def, d));
    const { evals } = await evaluateDefs(ctx, variants, ctx.screenSeeds);
    const feasible = evals.filter((e) => e.feasible);
    if (feasible.length === 0) continue;
    const bestScreen = feasible.reduce((x, y) => (meanDelta(y, ctx.objective) > meanDelta(x, ctx.objective) ? y : x));
    const bestDef = variants.find((v) => v.id === bestScreen.id) as StratDef;
    const tried: StratDef[] = [bestDef];
    const temp = temporary(ctx, p.def, bestDef.members[0].day, facts);
    if (temp) tried.push(temp);
    const full = await evaluateDefs(ctx, tried, ctx.seeds);
    for (const ev of full.evals) {
      if (ev.feasible && better(ev, p.ev, ctx.objective)) out.push({ def: tried.find((t) => t.id === ev.id) as StratDef, ev });
    }
  }
  return out;
}

/** Golden-section maximisation of f ↦ g(f) on [a, b] with at most `evals` evaluations. */
export async function goldenSection(
  a: number,
  b: number,
  g: (x: number) => Promise<number>,
  evals = GOLDEN_EVALS,
  tol = GOLDEN_TOL,
): Promise<{ x: number; value: number }[]> {
  const phi = (Math.sqrt(5) - 1) / 2;
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  const seen: { x: number; value: number }[] = [];
  let c = r(b - phi * (b - a));
  let d = r(a + phi * (b - a));
  let fc: number | null = null;
  let fd: number | null = null;
  while (seen.length < evals && b - a > tol) {
    if (fc === null) {
      fc = await g(c);
      seen.push({ x: c, value: fc });
      continue;
    }
    if (fd === null) {
      fd = await g(d);
      seen.push({ x: d, value: fd });
      continue;
    }
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = r(b - phi * (b - a));
      fc = null;
    } else {
      a = c;
      c = d;
      fc = fd;
      d = r(a + phi * (b - a));
      fd = null;
    }
  }
  return seen;
}

/**
 * Price line search on the global multiplier and the two job types with the largest |mean Δ|.
 * Returns the refined strategies evaluated on K seeds (only those that beat their best grid point).
 */
export async function refinePrices(
  ctx: StudyContext,
  singles: { def: StratDef; ev: StrategyEvaluation }[],
): Promise<{ def: StratDef; ev: StrategyEvaluation }[]> {
  const price = singles.filter((s) => s.def.category === 'pricing' && s.def.id.startsWith('price:') && s.def.actions.length === 1);
  const byTarget = new Map<string, { def: StratDef; ev: StrategyEvaluation; f: number }[]>();
  for (const s of price) {
    const [, target, f] = s.def.id.split(':');
    const l = byTarget.get(target) ?? [];
    l.push({ ...s, f: Number(f) });
    byTarget.set(target, l);
  }
  const jobTargets = [...byTarget.keys()]
    .filter((t) => t !== 'all')
    .map((t) => ({ t, m: Math.max(...(byTarget.get(t) as { ev: StrategyEvaluation }[]).map((x) => Math.abs(meanDelta(x.ev, ctx.objective)))) }))
    .sort((a, b) => b.m - a.m || (a.t < b.t ? -1 : 1))
    .slice(0, 2)
    .map((x) => x.t);
  const targets = [...(byTarget.has('all') ? ['all'] : []), ...jobTargets];
  const out: { def: StratDef; ev: StrategyEvaluation }[] = [];
  for (const target of targets) {
    const pts = (byTarget.get(target) as { def: StratDef; ev: StrategyEvaluation; f: number }[]).sort((a, b) => a.f - b.f);
    const feasible = pts.filter((p) => p.ev.feasible);
    if (feasible.length === 0) continue;
    const best = feasible.reduce((x, y) => (meanDelta(y.ev, ctx.objective) > meanDelta(x.ev, ctx.objective) ? y : x));
    const grid = [PRICE_BOUNDS[0], ...pts.map((p) => p.f), 1, PRICE_BOUNDS[1]].filter((f, i, arr) => arr.indexOf(f) === i).sort((a, b) => a - b);
    const gi = grid.indexOf(best.f);
    const lo = Math.max(PRICE_BOUNDS[0], grid[Math.max(0, gi - 1)]);
    const hi = Math.min(PRICE_BOUNDS[1], grid[Math.min(grid.length - 1, gi + 1)]);
    const template = best.def.actions[0].action as { type: 'set-price'; jobTypeId: string; multiplier: number };
    const current = target === 'all' ? ctx.company.pricing.globalMultiplier : (ctx.company.pricing.byJobType[target] ?? 1);
    const defFor = (f: number): StratDef => {
      const id = `price:${target}:${f}`;
      const pct = Math.round(Math.abs(f - 1) * 1000) / 10;
      const label = `${f >= 1 ? 'Raise' : 'Lower'} ${target === 'all' ? 'all prices' : best.def.label.replace(/^(Raise|Lower) /, '').replace(/ prices by .*$/, ' prices')} by ${pct}%`;
      return {
        ...best.def,
        id,
        label,
        members: [{ candidateId: id, label, category: 'pricing', day: 0 }],
        actions: [{ day: 0, action: { ...template, multiplier: Math.round(current * f * 1e6) / 1e6 } }],
      };
    };
    const evalAt = new Map<number, StrategyEvaluation>();
    const seen = await goldenSection(lo, hi, async (f) => {
      const { evals } = await evaluateDefs(ctx, [defFor(f)], ctx.screenSeeds);
      const e = evals[0];
      if (!e) return -Infinity;
      evalAt.set(f, e);
      return e.feasible ? meanDelta(e, ctx.objective) : -Infinity;
    });
    const top = seen.filter((s) => Number.isFinite(s.value)).sort((a, b) => b.value - a.value)[0];
    if (!top || pts.some((p) => p.f === top.x)) continue;
    const full = await evaluateDefs(ctx, [defFor(top.x)], ctx.seeds);
    const ev = full.evals[0];
    if (ev && ev.feasible && better(ev, best.ev, ctx.objective)) out.push({ def: defFor(top.x), ev });
  }
  return out;
}
