/**
 * Study known-answer tests (optimization-design §12, tests 1–6). Each company is built so the right
 * answer is known before running: the reasoning is in the comments.
 */
import { describe, expect, it } from 'vitest';
import { createInProcessBackend, runStudy, type StudyRequest } from '../../src/optimization';
import type { CompanyConfig, Scenario } from '../../src/simulation';
import { createContext, evaluateDefs, type StratDef } from '../../src/optimization/study/context';
import { screenPairs } from '../../src/optimization/study/interactions';
import { longRun, stressAndProbes } from '../../src/optimization/study/validate';
import { applyVerdict, orderStrategies } from '../../src/optimization/study/verdict';
import { catalog, oneCrew, sc } from './helpers';

const def = (id: string, category: StratDef['category'], actions: StratDef['actions'], rules: StratDef['rules'] = []): StratDef => ({
  id,
  label: id,
  category,
  members: [{ candidateId: id, label: id, category, day: 0 }],
  conflictKeys: [id],
  actions,
  rules,
});

/** Wasteful marketing: $900/month that brings no leads (marketingMaxLeadsPerMonth 0). Cutting it is a durable saving. */
function withWastefulMarketing(c: CompanyConfig): CompanyConfig {
  return { ...c, market: { ...c.market, marketingMonthlySpend: 900, marketingMaxLeadsPerMonth: 0, marketingSpendScale: 100 } };
}
const cutMarketing = def('marketing:0', 'marketing', [{ day: 0, action: { type: 'set-marketing-spend', monthlySpend: 0 } }]);
const raise10 = def('price:all:1.1', 'pricing', [{ day: 0, action: { type: 'set-price', jobTypeId: 'all', multiplier: 1.1 } }]);

describe('study known answers', () => {
  it('1 timing: demand only from April and a 30-day ramp — hiring on day 0 loses, a later start wins', async () => {
    // Jan–Mar have no demand (seasonality 0); from 1 April (day 90) 110 weekly customers exceed the crew's
    // ≈ 78 visits a week. A hire costs 8 h × $20 = $160 per workday from its start and ramps from 30% to full
    // in 30 days. It is worth ≈ 32 extra visits × $50 − $800 ≈ $800 a week once demand starts, i.e. ≈ $7,500
    // over the 9.4 weeks of demand in a 156-day horizon. Day 0: 64 idle workdays ≈ $10,200 first ⇒ loses.
    // Starting on day 59 or 90 (first of March / April) avoids most of the idle pay ⇒ wins.
    const base = oneCrew(110);
    const company: CompanyConfig = {
      ...base,
      jobTypes: [{ ...base.jobTypes[0], seasonality: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1], lateAfterDays: 3, cancelAfterDays: 7 }],
      workforce: { ...base.workforce, rampDays: 30, rampStartProductivity: 0.3 },
    };
    const r = await runStudy(
      { scenario: sc(company, 156), catalog, objective: 'net-profit', budget: { seeds: 2, screenSeeds: 2 }, phases: ['baseline', 'singles', 'refine'] },
      createInProcessBackend(sc(company, 156)),
    );
    const day0 = r.strategies.find((s) => s.id === 'hire:hand:c1');
    expect(day0 && day0.deltaNetProfit.mean).toBeLessThan(0);
    const timed = r.strategies.filter((s) => s.id.startsWith('hire:hand:c1@d') && s.verdict === 'recommended');
    expect(timed.length).toBeGreaterThan(0);
    for (const t of timed) {
      const day = t.members[0].day;
      expect(day).toBeGreaterThan(0);
      expect(day).toBeLessThanOrEqual(90);
    }
  }, 120000);

  it('2 synergy: a new crew alone has no work and marketing alone has no capacity; together they win', async () => {
    // The crew is full (78 customers ≈ capacity). Marketing at $2,000/month brings ≈ 40 new weekly customers a
    // month that nobody can serve (missed jobs, cost) — not recommended. A new 3-person crew alone is paid
    // to idle — loses. Together the new crew serves the new customers — wins.
    const base = oneCrew(78);
    const company: CompanyConfig = {
      ...base,
      jobTypes: [{ ...base.jobTypes[0], lateAfterDays: 3, cancelAfterDays: 7 }],
      market: {
        ...base.market,
        marketingMonthlySpend: 0,
        marketingMaxLeadsPerMonth: 60,
        marketingSpendScale: 1000,
        baseConversionRate: 0.8,
        newCustomer: { serviceRadiusMiles: 1, sizeFactorMin: 1, sizeFactorMax: 1, recurringJobTypeMix: { mow: 1 } },
      },
    };
    const scenario = sc(company, 120);
    const ctx = createContext({ scenario, catalog, objective: 'net-profit', budget: { seeds: 3, screenSeeds: 3 } }, createInProcessBackend(scenario));
    ctx.budget.startPhase('interactions');
    const marketing = def('marketing:2000', 'marketing', [{ day: 0, action: { type: 'set-marketing-spend', monthlySpend: 2000 } }]);
    const truck = { name: 'Truck', seats: 3, mpg: 20, maintenanceCostPerMile: 0, purchasePrice: 30000, usefulLifeYears: 5, salvageValue: 5000, leaseMonthly: 600 };
    const hire = { hourlyWage: 20, skill: 2, productivity: 1 };
    const crew = def('add-crew', 'crew', [{ day: 0, action: { type: 'add-crew', name: 'New', hires: [hire, hire, hire], vehicle: { spec: truck, method: 'lease' }, equipment: [] } }]);
    const { evals } = await evaluateDefs(ctx, [marketing, crew], ctx.seeds);
    for (const e of evals) applyVerdict(e, 'net-profit', 120, 0.7);
    expect(evals.map((e) => e.verdict)).toEqual(['not-recommended', 'not-recommended']);
    const { synergy } = await screenPairs(ctx, [
      { def: marketing, ev: evals[0] },
      { def: crew, ev: evals[1] },
    ]);
    expect(synergy.length).toBe(1);
    const pair = applyVerdict(synergy[0].ev, 'net-profit', 120, 0.7);
    expect(pair.verdict).toBe('recommended');
    expect(pair.interaction).toBeGreaterThan(0);
  }, 120000);

  it('3 long-run reversal: a price rise wins inside the horizon, reverses over three years and ranks below a durable saving', async () => {
    // Churn 2%/month at today's prices; churn ∝ priceIndex^8, so +10% prices ⇒ ×1.1^8 ≈ 2.14 ⇒ 4.3%/month.
    // No new customers. Over 56 days the +10% price outweighs the extra ≈ 4% of customers lost; over three
    // years 0.957^36 ≈ 20% of customers remain against 0.98^36 ≈ 48% ⇒ revenue and profit fall.
    const base = withWastefulMarketing(oneCrew(60));
    const company: CompanyConfig = { ...base, market: { ...base.market, baseMonthlyChurn: 0.02, retentionPriceElasticity: 8 } };
    const scenario = sc(company, 56);
    const req: StudyRequest = { scenario, catalog, objective: 'net-profit', budget: { seeds: 3, screenSeeds: 3, validationSeeds: 3 }, longRunDays: 1095 };
    const ctx = createContext(req, createInProcessBackend(scenario));
    ctx.budget.startPhase('validation');
    const { evals } = await evaluateDefs(ctx, [raise10, cutMarketing], ctx.seeds);
    expect(evals[0].deltaNetProfit.mean).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) {
      const u = { def: [raise10, cutMarketing][i], ev: evals[i] };
      evals[i].validation = { longRun: await longRun(ctx, u), stress: { cases: [], robustShare: 1, worstCase: 0 }, sensitivity: { probes: [], flips: [] } };
      applyVerdict(evals[i], 'net-profit', 56, 0.7);
    }
    expect(evals[0].validation!.longRun!.verdict).toBe('reverses');
    expect(evals[0].verdict).toBe('not-recommended');
    expect(evals[1].verdict).toBe('recommended');
    expect(evals[1].deltaNetProfit.mean).toBeLessThan(evals[0].deltaNetProfit.mean); // the smaller in-horizon gain…
    expect(orderStrategies(evals).map((e) => e.id)).toEqual(['marketing:0', 'price:all:1.1']); // …ranks first
  }, 120000);

  it('4 fatigue: a 10-hour shift is recommended without the fatigue model and not with it; Δ quits > 0 is reported', async () => {
    // 9-hour shifts on a full crew (45 h a week). A 10-hour shift adds two crew-hours a day of paid work on a
    // backlog, worth more than its pay without fatigue. With fatigue (θ 45 h, productivity −0.8 per point,
    // quits ×(1 + 4 × fatigue)), 50-hour weeks give fatigue 0.5 ⇒ productivity × 0.7 (floor) ⇒ less work done
    // per paid hour than before (missed jobs rise above the cap, so it is even infeasible), and quits × (1 + 10 × 0.5) = 6.
    const base = oneCrew(120);
    const plain: CompanyConfig = {
      ...base,
      jobTypes: [{ ...base.jobTypes[0], lateAfterDays: 3, cancelAfterDays: 7, basePrice: 60 }],
      policies: { ...base.policies, shiftHours: 9, minPaidHoursPerShift: 9 },
      workforce: { ...base.workforce, annualTurnoverRate: 0.5, overtimeWeeklyThresholdHours: 60 },
    };
    const tired: CompanyConfig = {
      ...plain,
      workforce: { ...plain.workforce, fatigueThresholdHours: 45, productivityFatigueLoss: 0.8, quitFatigueWeight: 10 },
    };
    const verdictOf = async (c: CompanyConfig) => {
      const s = sc(c, 168);
      const r = await runStudy({ scenario: s, catalog, objective: 'net-profit', budget: { seeds: 4, screenSeeds: 4 }, phases: ['baseline', 'singles'] }, createInProcessBackend(s));
      return [...r.strategies, ...r.infeasible].find((x) => x.id === 'policy:shiftHours:10')!;
    };
    const off = await verdictOf(plain);
    const on = await verdictOf(tired);
    expect(off.verdict).toBe('recommended');
    expect(on.verdict).not.toBe('recommended');
    expect(on.operations.quits[1]).toBeGreaterThan(on.operations.quits[0]);
  }, 120000);

  it('5 stress pairing: under "demand down" a cost saving still has a positive paired delta though profit is below the unstressed baseline', async () => {
    const company = withWastefulMarketing(oneCrew(60));
    const scenario = sc(company, 56);
    const ctx = createContext({ scenario, catalog, objective: 'net-profit', budget: { seeds: 2, screenSeeds: 2, validationSeeds: 2 } }, createInProcessBackend(scenario));
    ctx.budget.startPhase('validation');
    const { evals } = await evaluateDefs(ctx, [cutMarketing], ctx.seeds);
    const H = 56;
    const demandDown = { id: 'demand-down', label: 'Demand 20% lower', shocks: [{ type: 'multiplier' as const, target: 'demand' as const, factor: 0.8, fromDay: 0, toDay: H }] };
    const sp = (await stressAndProbes(ctx, { def: cutMarketing, ev: evals[0] }, [demandDown], []))!;
    expect(sp.stress.cases[0].delta).toBeGreaterThan(0);
    expect(sp.stress.cases[0].feasible).toBe(true);
    // The stressed strategy's absolute profit is below the unstressed baseline's — the comparison is paired anyway.
    const stressedWith = [...ctx.digests.entries()].filter(([k]) => k.includes('demand') && k.includes('set-marketing-spend')).map(([, d]) => d.total.income.netProfit);
    const plainBase = [...ctx.digests.entries()].filter(([k]) => k.startsWith('{}|')).map(([, d]) => d.total.income.netProfit);
    expect(Math.max(...stressedWith)).toBeLessThan(Math.min(...plainBase));
  });

  it('6 assumption flip: a price rise that wins only because few customers leave on a rise is flagged on that path', async () => {
    // +10% prices; on a rise each customer leaves with probability 0.005 × 100 × 0.1 = 5% ⇒ revenue × 0.95 × 1.1
    // = 1.045 ⇒ wins (labor is fixed by the 8-hour guarantee). If customers are 3× as likely to leave (15%):
    // × 0.85 × 1.1 = 0.935 ⇒ loses. The probe with factor 3 must flip the sign.
    const base = oneCrew(70);
    const company: CompanyConfig = { ...base, market: { ...base.market, priceIncreaseShockChurnPerPct: 0.005 } };
    const scenario: Scenario = sc(company, 56);
    const ctx = createContext({ scenario, catalog, objective: 'net-profit', budget: { seeds: 3, screenSeeds: 3, validationSeeds: 3 } }, createInProcessBackend(scenario));
    ctx.budget.startPhase('validation');
    const { evals } = await evaluateDefs(ctx, [raise10], ctx.seeds);
    expect(evals[0].deltaNetProfit.mean).toBeGreaterThan(0);
    const probes = [
      { path: 'market.priceIncreaseShockChurnPerPct', label: 'customers lost when prices rise', factors: [3] },
      { path: 'workforce.absenceRate', label: 'absence', factors: [0.7, 1.3] }, // 0 in this company ⇒ skipped
    ];
    const sp = (await stressAndProbes(ctx, { def: raise10, ev: evals[0] }, [], probes))!;
    expect(sp.sensitivity.probes.map((p) => p.path)).toEqual(['market.priceIncreaseShockChurnPerPct']);
    expect(sp.sensitivity.flips).toEqual([{ path: 'market.priceIncreaseShockChurnPerPct', label: 'customers lost when prices rise', factor: 3 }]);
    evals[0].validation = { longRun: null, stress: sp.stress, sensitivity: sp.sensitivity };
    expect(applyVerdict(evals[0], 'net-profit', 56, 0.7).verdict).toBe('conditional');
  });
});
