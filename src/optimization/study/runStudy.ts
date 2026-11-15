/**
 * The study (optimization-design §1): baseline → loss attribution → capacity → singles → refine →
 * interactions → plans → validation. Deterministic given the request (except elapsedMs); the
 * backend only supplies simulation results. Emits a partial result after every phase.
 */
import { diagnoseBottlenecks } from '../bottlenecks';
import { distribution, mean } from '../evaluate';
import { fmtUsd } from '../explain';
import type { RunDigest, RunStudy, StrategyEvaluation, StudyPhase, StudyResult } from '../study-types';
import { attachRelaxationValues, lossAttribution } from './attribution';
import { capacityExperiment } from './capacity';
import { createContext, evaluateDefs, fetchRuns, meanDelta, objectiveOf, onTop, StudyStopped, toSummary, type StratDef, type StudyContext } from './context';
import { baselineFacts, generateStudyCandidates, type BaselineFacts } from './generate';
import { screenPairs, shortList, type Unit } from './interactions';
import { planPool, searchPlans } from './plans';
import { refinePrices, refineTiming } from './refine';
import { defaultStressCases, DEFAULT_PROBES, longRun, stressAndProbes } from './validate';
import { applyVerdict, markPareto, orderStrategies } from './verdict';

export const ALL_PHASES: StudyPhase[] = ['baseline', 'loss-attribution', 'capacity', 'singles', 'refine', 'interactions', 'plans', 'validation'];
/** Screened singles carried to K seeds: the best this many plus every positive one. */
export const SCREEN_KEEP = 15;
export const BREAK_EVEN_STEPS = 4;

interface State {
  ctx: StudyContext;
  base: RunDigest[];
  result: StudyResult;
  units: Map<string, Unit>;
  infeasible: Map<string, StrategyEvaluation>;
  facts: BaselineFacts | null;
}

function record(st: State, u: Unit): void {
  if (!u.ev.feasible) {
    st.infeasible.set(u.ev.id, u.ev);
    return;
  }
  const cur = st.units.get(u.def.id);
  if (!cur || u.ev.seedsEvaluated >= cur.ev.seedsEvaluated) st.units.set(u.def.id, u);
}

function snapshot(st: State, t0: number): StudyResult {
  const ctx = st.ctx;
  const strategies = [...st.units.values()].map((u) => applyVerdict(u.ev, ctx.objective, ctx.H, ctx.constraints.minProbabilityOfImprovement));
  markPareto(strategies, ctx.objective);
  return {
    ...st.result,
    strategies: orderStrategies(strategies).map((e) => structuredClone(e)),
    infeasible: [...st.infeasible.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((e) => structuredClone(e)),
    feasibleStrategiesEvaluated: strategies.length,
    simulationsRun: ctx.simulationsRun,
    budgetExhausted: ctx.budget.exhausted,
    elapsedMs: ctx.control?.clock ? ctx.control.clock() - t0 : 0,
  };
}

export const runStudy: RunStudy = async (request, evaluate, control) => {
  const ctx = createContext(request, evaluate, control);
  const t0 = control?.clock ? control.clock() : 0;
  const phases = request.phases ?? ALL_PHASES;
  const z = { mean: 0, min: 0, max: 0, stdDev: 0 };
  const st: State = {
    ctx,
    base: [],
    units: new Map(),
    infeasible: new Map(),
    facts: null,
    result: {
      objective: ctx.objective,
      seeds: ctx.seeds,
      horizonDays: ctx.H,
      baseline: { netProfit: z, endingCash: z, revenue: z, minCash: 0, utilization: 0, missedJobRate: 0, endCustomers: 0 },
      bottlenecks: [],
      lossAttribution: [],
      capacity: null,
      strategies: [],
      infeasible: [],
      feasibleStrategiesEvaluated: 0,
      simulationsRun: 0,
      phasesCompleted: [],
      budgetExhausted: false,
      elapsedMs: 0,
    },
  };
  let last = snapshot(st, t0);
  const done = (phase: StudyPhase) => {
    st.result.phasesCompleted.push(phase);
    last = snapshot(st, t0);
    control?.onProgress?.({ phase, completed: st.result.phasesCompleted.length, total: phases.length, partial: last });
  };
  const run = async (phase: StudyPhase, body: () => Promise<void>) => {
    if (!phases.includes(phase)) return;
    ctx.budget.startPhase(phase);
    control?.onProgress?.({ phase, completed: st.result.phasesCompleted.length, total: phases.length });
    await body();
    done(phase);
  };

  try {
    // Baseline (always needed).
    ctx.budget.startPhase('baseline');
    const b = await fetchRuns(ctx, [{ variant: {}, seeds: ctx.seeds }]);
    if (!b) {
      ctx.budget.cut();
      return { ...last, budgetExhausted: true };
    }
    st.base = b[0];
    const B = st.base.map(toSummary);
    st.result.baseline = {
      netProfit: distribution(B.map((r) => r.netProfit)),
      endingCash: distribution(B.map((r) => r.endingCash)),
      revenue: distribution(B.map((r) => r.revenue)),
      minCash: Math.min(...B.map((r) => r.minCash)),
      utilization: mean(B.map((r) => r.utilization)),
      missedJobRate: mean(B.map((r) => r.missedJobRate)),
      endCustomers: mean(B.map((r) => r.endActiveCustomers)),
    };
    st.result.bottlenecks = diagnoseBottlenecks(ctx.company, B, ctx.H, []);
    if (phases.includes('baseline')) done('baseline');

    await run('loss-attribution', async () => {
      const la = await lossAttribution(ctx, st.base);
      if (la) {
        st.result.lossAttribution = la;
        st.result.bottlenecks = attachRelaxationValues(st.result.bottlenecks, la, ctx.H);
      }
    });

    await run('capacity', async () => {
      st.result.capacity = await capacityExperiment(ctx);
    });

    // Singles.
    let singles: Unit[] = [];
    const facts = () => (st.facts ??= baselineFacts(ctx, st.base));
    await run('singles', async () => {
      const defs = generateStudyCandidates(ctx.base, request.catalog, facts(), ctx.constraints.maxMissedJobRate);
      const screened = await evaluateDefs(ctx, defs, ctx.screenSeeds);
      const byId = new Map(defs.map((d) => [d.id, d]));
      const feasibleRanked = screened.evals
        .filter((e) => e.feasible)
        .sort((a, b) => meanDelta(b, ctx.objective) - meanDelta(a, ctx.objective) || (a.id < b.id ? -1 : 1));
      const keep = feasibleRanked.filter((e, i) => i < SCREEN_KEEP || meanDelta(e, ctx.objective) > 0).map((e) => byId.get(e.id) as StratDef);
      const full = ctx.seeds.length > ctx.screenSeeds.length ? (await evaluateDefs(ctx, keep, ctx.seeds)).evals : [];
      const best = new Map<string, StrategyEvaluation>();
      for (const e of [...screened.evals, ...full]) {
        const cur = best.get(e.id);
        if (!cur || e.seedsEvaluated >= cur.seedsEvaluated) best.set(e.id, e);
      }
      singles = [...best.values()].map((ev) => ({ def: byId.get(ev.id) as StratDef, ev }));
      for (const u of singles) record(st, u);
      await breakEven(ctx, singles);
    });

    await run('refine', async () => {
      const f = facts();
      for (const u of [...(await refineTiming(ctx, singles, f)), ...(await refinePrices(ctx, singles))]) record(st, u);
    });

    let synergy: Unit[] = [];
    await run('interactions', async () => {
      const res = await screenPairs(ctx, shortList([...st.units.values()], ctx.objective));
      synergy = res.synergy;
      for (const u of synergy) record(st, u);
    });

    await run('plans', async () => {
      const units = [...st.units.values()].map((u) => ({ ...u, ev: applyVerdict(u.ev, ctx.objective, ctx.H, ctx.constraints.minProbabilityOfImprovement) }));
      for (const u of await searchPlans(ctx, planPool(units, synergy, ctx.objective))) record(st, u);
    });

    await run('validation', async () => {
      const f = facts();
      const cases = request.stressCases ?? defaultStressCases(ctx, f);
      const probes = request.assumptionProbes ?? DEFAULT_PROBES;
      const seen = new Set<string>();
      const finalists = [...st.units.values()]
        .filter((u) => u.ev.feasible && u.ev.probabilityOfImprovement >= ctx.constraints.minProbabilityOfImprovement && meanDelta(u.ev, ctx.objective) > 0)
        .sort((a, b) => meanDelta(b.ev, ctx.objective) - meanDelta(a.ev, ctx.objective) || (a.def.id < b.def.id ? -1 : 1))
        .filter((u) => {
          const k = JSON.stringify([u.def.actions, u.def.rules]);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, ctx.budgetCfg.finalists);
      // Pass 1: stress and sensitivity, best first. Pass 2: long run (dropped first when short of budget).
      const checked: Unit[] = [];
      for (const u of finalists) {
        const sp = await stressAndProbes(ctx, u, cases, probes);
        if (!sp) break;
        u.ev.validation = { longRun: null, stress: sp.stress, sensitivity: sp.sensitivity };
        checked.push(u);
      }
      for (const u of checked) {
        const lr = await longRun(ctx, u);
        if (!lr) break;
        (u.ev.validation as NonNullable<StrategyEvaluation['validation']>).longRun = lr;
      }
    });
  } catch (err) {
    if (err instanceof StudyStopped) return last;
    throw err;
  }
  return last;
};

/**
 * Break-even demand (§4): for the best capacity-adding single (hire or new crew) that is not
 * recommended at today's demand, bisect the customer scale in [1, 2.5] for where its Δ crosses zero.
 */
async function breakEven(ctx: StudyContext, singles: Unit[]): Promise<void> {
  const cand = singles
    .filter((u) => u.ev.feasible && (u.def.id.startsWith('hire:') || u.def.id.startsWith('add-crew:')))
    .sort((a, b) => meanDelta(b.ev, ctx.objective) - meanDelta(a.ev, ctx.objective) || (a.def.id < b.def.id ? -1 : 1))[0];
  if (!cand || (cand.ev.verdict === 'recommended' && meanDelta(cand.ev, ctx.objective) > 0)) return;
  const seeds = ctx.screenSeeds;
  const deltaAt = async (s: number): Promise<number | null> => {
    const got = await fetchRuns(ctx, [
      { variant: { customerScale: s }, seeds },
      { variant: { ...onTop({}, cand.def), customerScale: s }, seeds },
    ]);
    if (!got) return null;
    return mean(got[1].map((r, i) => objectiveOf(r, ctx.objective) - objectiveOf(got[0][i], ctx.objective)));
  };
  const top = await deltaAt(2.5);
  if (top === null || top <= 0) return;
  let lo = 1;
  let hi = 2.5;
  for (let k = 0; k < BREAK_EVEN_STEPS; k++) {
    const mid = Math.round(((lo + hi) / 2) * 1e6) / 1e6;
    const d = await deltaAt(mid);
    if (d === null) return;
    if (d > 0) hi = mid;
    else lo = mid;
  }
  const customers = Math.round(hi * ctx.company.customers.length);
  cand.ev.explanation.push(
    `It does not pay at today's demand, but it pays for itself from about ${customers} customers (today ${ctx.company.customers.length}); at 2.5 times today's customers it adds ${fmtUsd(top)} over the plan.`,
  );
}
