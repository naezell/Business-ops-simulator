/**
 * Plan search (optimization-design §7): beam search over a pool of the best recommended single
 * per conflict key plus synergy pairs, up to four members.
 */
import type { StrategyEvaluation } from '../study-types';
import { evaluateDefs, meanDelta, type StratDef, type StudyContext } from './context';
import { combine, defsConflict } from './generate';
import type { Unit } from './interactions';

export const POOL_SIZE = 10;
export const BEAM_WIDTH = 3;
export const MAX_PLAN_SIZE = 4;
export const MIN_PLAN_GAIN_USD = 100;
export const MIN_PLAN_GAIN_SHARE = 0.01;

/** Pool: best recommended unit per conflict-key set, then synergy pairs; the ten best by Δ. */
export function planPool(units: Unit[], synergy: Unit[], objective: StudyContext['objective']): Unit[] {
  const byKey = new Map<string, Unit>();
  for (const u of units) {
    if (u.ev.verdict !== 'recommended') continue;
    const k = u.def.conflictKeys.join('|');
    const cur = byKey.get(k);
    if (!cur || meanDelta(u.ev, objective) > meanDelta(cur.ev, objective)) byKey.set(k, u);
  }
  const all = [...byKey.values(), ...synergy.filter((s) => s.ev.verdict === 'recommended')];
  return all.sort((a, b) => meanDelta(b.ev, objective) - meanDelta(a.ev, objective) || (a.def.id < b.def.id ? -1 : 1)).slice(0, POOL_SIZE);
}

/** Beam search; returns every plan evaluation made (feasible or not). */
export async function searchPlans(ctx: StudyContext, pool: Unit[]): Promise<Unit[]> {
  const out: Unit[] = [];
  if (pool.length < 2) return out;
  const objective = ctx.objective;
  let beams: { units: Unit[]; ev: StrategyEvaluation }[] = pool.slice(0, BEAM_WIDTH).map((u) => ({ units: [u], ev: u.ev }));
  const seen = new Set<string>(pool.map((u) => u.def.id));
  for (let size = 2; beams.length > 0; size++) {
    const children = new Map<string, { units: Unit[]; def: StratDef; parentGain: number }>();
    for (const b of beams) {
      for (const u of pool) {
        if (b.units.some((x) => x.def.id === u.def.id || defsConflict(x.def, u.def))) continue;
        const units = [...b.units, u];
        if (units.reduce((n, x) => n + x.def.members.length, 0) > MAX_PLAN_SIZE) continue;
        const def = combine(units.map((x) => x.def));
        const parentGain = meanDelta(b.ev, objective);
        const prev = children.get(def.id);
        if (prev) prev.parentGain = Math.max(prev.parentGain, parentGain);
        else if (!seen.has(def.id)) children.set(def.id, { units, def, parentGain });
      }
    }
    if (children.size === 0) break;
    const list = [...children.values()];
    for (const c of list) seen.add(c.def.id);
    const { evals } = await evaluateDefs(ctx, list.map((c) => c.def), ctx.seeds);
    const next: { units: Unit[]; ev: StrategyEvaluation }[] = [];
    for (const ev of evals) {
      const c = list.find((x) => x.def.id === ev.id) as (typeof list)[number];
      out.push({ def: c.def, ev });
      const gain = meanDelta(ev, objective);
      if (ev.verdict === 'recommended' && gain > c.parentGain + Math.max(MIN_PLAN_GAIN_USD, MIN_PLAN_GAIN_SHARE * c.parentGain))
        next.push({ units: c.units, ev });
    }
    next.sort((a, b) => meanDelta(b.ev, objective) - meanDelta(a.ev, objective) || (a.ev.id < b.ev.id ? -1 : 1));
    beams = next.slice(0, BEAM_WIDTH);
    if (size >= MAX_PLAN_SIZE) break;
  }
  return out;
}
