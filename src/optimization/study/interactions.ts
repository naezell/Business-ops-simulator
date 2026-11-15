/**
 * Pair screening (optimization-design §7): every non-conflicting pair of a short list, on the
 * screening seeds; pairs worth more together than apart are re-evaluated on K seeds.
 */
import { mean } from '../evaluate';
import type { RunDigest, StrategyEvaluation } from '../study-types';
import { costOf, evaluateDefs, fetchRuns, meanDelta, objectiveOf, variantOf, type FetchItem, type StratDef, type StudyContext } from './context';
import { combine, defsConflict } from './generate';

export const SHORT_LIST_TOP = 8;
export const SHORT_LIST_MAX = 12;
export const SHORT_LIST_CATEGORIES = ['crew', 'staffing', 'marketing', 'pricing', 'fleet', 'scheduling'];
export const SYNERGY_MIN_USD = 100;

export interface Unit {
  def: StratDef;
  ev: StrategyEvaluation;
}

/** Best feasible strategy per conflict key, the eight largest |Δ|, plus the best of each missing category (≤ 12). */
export function shortList(units: Unit[], objective: StudyContext['objective']): Unit[] {
  const byKey = new Map<string, Unit>();
  for (const u of units) {
    if (!u.ev.feasible) continue;
    const k = u.def.conflictKeys.join('|');
    const cur = byKey.get(k);
    if (!cur || meanDelta(u.ev, objective) > meanDelta(cur.ev, objective)) byKey.set(k, u);
  }
  const best = [...byKey.values()].sort(
    (a, b) => Math.abs(meanDelta(b.ev, objective)) - Math.abs(meanDelta(a.ev, objective)) || (a.def.id < b.def.id ? -1 : 1),
  );
  const out = best.slice(0, SHORT_LIST_TOP);
  for (const cat of SHORT_LIST_CATEGORIES) {
    if (out.length >= SHORT_LIST_MAX) break;
    if (out.some((u) => u.def.category === cat)) continue;
    const c = best
      .filter((u) => u.def.category === cat)
      .sort((a, b) => meanDelta(b.ev, objective) - meanDelta(a.ev, objective) || (a.def.id < b.def.id ? -1 : 1))[0];
    if (c) out.push(c);
  }
  return out;
}

export interface PairResult {
  def: StratDef;
  /** Screening Δ of the pair and of each member (same seeds). */
  deltaPair: number;
  deltaA: number;
  deltaB: number;
  interaction: number;
}

/** Screens every non-conflicting pair; returns all pair results and the synergy pairs evaluated on K seeds. */
export async function screenPairs(ctx: StudyContext, list: Unit[]): Promise<{ pairs: PairResult[]; synergy: Unit[] }> {
  const seeds = ctx.screenSeeds;
  const combos: { a: Unit; b: Unit; def: StratDef }[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      if (defsConflict(list[i].def, list[j].def)) continue;
      combos.push({ a: list[i], b: list[j], def: combine([list[i].def, list[j].def]) });
    }
  const base = await fetchRuns(ctx, [{ variant: {}, seeds }]);
  if (!base) return { pairs: [], synergy: [] };
  // The largest prefix of pairs (with their members) the phase can afford, fetched as one batch.
  const items = (n: number): FetchItem[] => combos.slice(0, n).flatMap((c) => [c.a.def, c.b.def, c.def].map((d) => ({ variant: variantOf(d), seeds })));
  let n = combos.length;
  while (n > 0 && !ctx.budget.canAfford(costOf(ctx, items(n)))) n -= 1;
  if (n < combos.length) ctx.budget.cut();
  const got = n > 0 ? await fetchRuns(ctx, items(n)) : [];
  const delta = (runs: RunDigest[]) => mean(runs.map((r, k) => objectiveOf(r, ctx.objective) - objectiveOf(base[0][k], ctx.objective)));
  const pairs: PairResult[] = [];
  for (let i = 0; i < n; i++) {
    const g = got as RunDigest[][];
    const dA = delta(g[3 * i]);
    const dB = delta(g[3 * i + 1]);
    const dAB = delta(g[3 * i + 2]);
    pairs.push({ def: combos[i].def, deltaPair: dAB, deltaA: dA, deltaB: dB, interaction: dAB - dA - dB });
  }
  const syn = pairs.filter((p) => p.deltaPair > Math.max(p.deltaA, p.deltaB, 0) + SYNERGY_MIN_USD);
  const { evals } = await evaluateDefs(ctx, syn.map((p) => p.def), ctx.seeds);
  const synergy: Unit[] = [];
  for (const ev of evals) {
    const p = syn.find((x) => x.def.id === ev.id) as PairResult;
    ev.interaction = p.interaction;
    synergy.push({ def: p.def, ev });
  }
  return { pairs, synergy };
}
