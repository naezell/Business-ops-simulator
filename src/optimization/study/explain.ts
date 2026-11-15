/**
 * Caveat and finding sentences for the study (optimization-design §9, §11). Template text only;
 * every number comes from simulated runs.
 */
import { fmtDelta, fmtUsd } from '../explain';
import type { LongRunCheck, SensitivityCheck, StressCheck, StrategyEvaluation } from '../study-types';

export function longRunCaveat(lr: LongRunCheck, H: number): string | null {
  const months = Math.max(1, Math.round(H / 30.4));
  if (lr.verdict === 'reverses')
    return `Over ${Math.round(lr.horizonDays / 365)} years the gain reverses: the long-run change is ${fmtDelta(lr.delta.mean)}.`;
  if (lr.verdict === 'fades')
    return `Gain fades after the first ${months} month${months === 1 ? '' : 's'}: about ${fmtUsd(lr.annualizedInHorizon)} a year inside the plan, ${fmtUsd(lr.annualizedBeyondHorizon)} a year after.`;
  return null;
}

export function stressCaveats(st: StressCheck): string[] {
  return st.cases
    .filter((c) => !(c.delta > 0 && c.feasible))
    .map((c) => (c.feasible ? `Loses money under "${c.label}" (${fmtDelta(c.delta)} versus the same conditions without it).` : `Breaks a limit under "${c.label}".`));
}

export function flipCaveats(se: SensitivityCheck): string[] {
  return se.flips.map((f) => {
    const pct = Math.round(Math.abs(f.factor - 1) * 100);
    return `Depends on the assumption "${f.label}": the result reverses if it is ${pct}% ${f.factor > 1 ? 'higher' : 'lower'} than assumed.`;
  });
}

export function customerCaveat(e: StrategyEvaluation): string | null {
  const n = Math.round(e.deltaEndCustomers.mean);
  if (n >= 0) return null;
  return `Ends the plan with about ${-n} fewer active customer${n === -1 ? '' : 's'}; that loss keeps reducing revenue after the plan.`;
}

export const NOT_VALIDATED_LONG_RUN = 'Not validated long-run: the study budget ran out before the multi-year check.';
