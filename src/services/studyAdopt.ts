/** Turning a study strategy into draft actions and rules (shared by the store and the Study view). */
import type { PlannedAction } from '@/simulation';
import type { DecisionRule } from '@/simulation/types-twin';
import type { StrategyEvaluation } from '@/optimization';

export interface AdoptPayload {
  actions: PlannedAction[];
  rules: DecisionRule[];
}

export function adoptPayload(s: StrategyEvaluation): AdoptPayload {
  return {
    actions: (s.variant.actions ?? []).map((a) => ({ day: a.day, action: a.action })),
    rules: s.variant.rules ?? [],
  };
}

/** Appends rules whose id is not already present (de-duplicated by id). */
export function mergeRules(existing: readonly DecisionRule[], add: readonly DecisionRule[]): DecisionRule[] {
  const seen = new Set(existing.map((r) => r.id));
  const out = [...existing];
  for (const r of add) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
