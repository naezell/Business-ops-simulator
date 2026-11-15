/**
 * Budget accounting (optimization-design §10). One unit = one run of the scenario horizon H;
 * a run of L days costs ⌈L / H⌉. Phase reservations are ceilings; validation gets the remainder.
 */
import type { StudyBudget, StudyPhase } from '../study-types';

export const DEFAULT_BUDGET: StudyBudget = { maxSimulations: 1500, seeds: 5, screenSeeds: 2, validationSeeds: 2, finalists: 8 };

/** Ceiling per phase in units (baseline is K; validation takes what is left). */
export const PHASE_RESERVATION: Partial<Record<StudyPhase, number>> = {
  'loss-attribution': 20,
  capacity: 60,
  singles: 300,
  refine: 150,
  interactions: 140,
  plans: 200,
};

export function resolveBudget(b: Partial<StudyBudget> | undefined): StudyBudget {
  const pos = (x: number | undefined, d: number) => (x !== undefined && Number.isFinite(x) && x >= 1 ? Math.floor(x) : d);
  const seeds = pos(b?.seeds, DEFAULT_BUDGET.seeds);
  return {
    maxSimulations: pos(b?.maxSimulations, DEFAULT_BUDGET.maxSimulations),
    seeds,
    screenSeeds: Math.min(seeds, pos(b?.screenSeeds, DEFAULT_BUDGET.screenSeeds)),
    validationSeeds: Math.min(seeds, pos(b?.validationSeeds, DEFAULT_BUDGET.validationSeeds)),
    finalists: pos(b?.finalists, DEFAULT_BUDGET.finalists),
  };
}

export class Budget {
  used = 0;
  exhausted = false;
  private phaseStart = 0;
  private phaseCap = Infinity;

  constructor(readonly cap: number) {}

  remaining(): number {
    return Math.max(0, this.cap - this.used);
  }

  /** Starts a phase whose spending may not exceed its reservation (or the remaining total). */
  startPhase(phase: StudyPhase): void {
    this.phaseStart = this.used;
    this.phaseCap = PHASE_RESERVATION[phase] ?? Infinity;
  }

  /** Units still available to the current phase. */
  phaseRemaining(): number {
    return Math.max(0, Math.min(this.remaining(), this.phaseCap - (this.used - this.phaseStart)));
  }

  canAfford(units: number): boolean {
    return units <= this.phaseRemaining();
  }

  charge(units: number): void {
    this.used += units;
    if (this.used > this.cap) throw new Error(`internal: budget exceeded (${this.used} > ${this.cap})`);
  }

  /** Records that some planned work was skipped for lack of budget. */
  cut(): void {
    this.exhausted = true;
  }
}
