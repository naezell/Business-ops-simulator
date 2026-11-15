/**
 * ADR-008 / simulation-engine §5.2: one-off arrivals respond to price through P_j^(−oneOffPriceElasticity),
 * using the same draw u at every price.
 */
import { NO_SHOCK } from '../../src/simulation/conditions';
import { describe, expect, it } from 'vitest';
import { buildCalendar, runSimulation, type CompanyConfig, type Scenario } from '../../src/simulation';
import { demandStep } from '../../src/simulation/demand';
import { initState, type DayCtx } from '../../src/simulation/state';
import { zeroCashFlow, zeroIncome, zeroOps } from '../../src/simulation/finance/statements';
import { scenario, stochasticCompany } from './helpers';
import { stochasticMid } from './scenarios';

const ONE_OFF = new Set(['cleanup', 'install']);

/**
 * Runs only the demand step (§5) for `horizon` days and returns the ids of the one-off orders it created.
 * Open orders are cleared after each day, so dispatch never feeds back into churn: the customer set
 * evolves identically at every one-off price (price index only weighs recurring plans, §5).
 */
function oneOffOrderIds(company: CompanyConfig, seed: number, horizon: number): Set<string> {
  const sc: Scenario = scenario(company, { seed, horizonDays: horizon });
  const st = initState(sc);
  const cal = buildCalendar(st.company.startMonth, horizon);
  const ids = new Set<string>();
  for (let day = 0; day < horizon; day++) {
    const ctx: DayCtx = { day, month: cal[day].month, inc: zeroIncome(), cf: zeroCashFlow(), ops: zeroOps(), assetAdditions: 0, newBorrowing: 0, disposedBook: 0, m: NO_SHOCK };
    demandStep(st, ctx);
    for (const o of st.open) if (ONE_OFF.has(o.jt.def.id)) ids.add(o.id);
    st.open.length = 0;
  }
  return ids;
}

function withOneOffPrice(mult: number, elasticity: number | undefined): CompanyConfig {
  const c = stochasticCompany(120);
  c.pricing = { ...c.pricing, byJobType: { ...c.pricing.byJobType, cleanup: mult, install: mult } };
  if (elasticity === undefined) delete c.market.oneOffPriceElasticity;
  else c.market.oneOffPriceElasticity = elasticity;
  return c;
}

describe('one-off price response under common random numbers', () => {
  it('orders created at a higher price are a subset of those at a lower price (and strictly fewer)', () => {
    for (const seed of [1, 7, 42]) {
      const low = oneOffOrderIds(withOneOffPrice(0.9, 1.5), seed, 365);
      const mid = oneOffOrderIds(withOneOffPrice(1.0, 1.5), seed, 365);
      const high = oneOffOrderIds(withOneOffPrice(1.4, 1.5), seed, 365);
      expect(low.size).toBeGreaterThan(50);
      for (const id of high) expect(mid.has(id), `${seed} ${id}`).toBe(true);
      for (const id of mid) expect(low.has(id), `${seed} ${id}`).toBe(true);
      expect(high.size).toBeLessThan(mid.size);
      expect(mid.size).toBeLessThan(low.size);
    }
  });

  it('the share of orders kept is close to the price factor 1.4^(−1.5) ≈ 0.6037', () => {
    // 1.4^1.5 = 1.4 × √1.4 = 1.4 × 1.18321596 = 1.65650235; 1 / 1.65650235 = 0.60368170.
    let kept = 0;
    let base = 0;
    for (const seed of [1, 2, 3, 4]) {
      base += oneOffOrderIds(withOneOffPrice(1.0, 1.5), seed, 365).size;
      kept += oneOffOrderIds(withOneOffPrice(1.4, 1.5), seed, 365).size;
    }
    expect(base).toBeGreaterThan(400);
    expect(kept / base).toBeGreaterThan(0.6037 - 0.06);
    expect(kept / base).toBeLessThan(0.6037 + 0.06);
  });

  it('with elasticity 0 the one-off orders do not depend on price', () => {
    const a = oneOffOrderIds(withOneOffPrice(0.8, 0), 5, 200);
    const b = oneOffOrderIds(withOneOffPrice(1.5, 0), 5, 200);
    expect([...b].sort()).toEqual([...a].sort());
  });
});

describe('backward compatibility: elasticity missing or 0', () => {
  it('a scenario with the field absent and the same scenario with 0 give identical results', () => {
    for (const seed of [3, 9]) {
      const absent = stochasticMid(seed);
      delete absent.company.market.oneOffPriceElasticity;
      absent.company.pricing = { ...absent.company.pricing, byJobType: { ...absent.company.pricing.byJobType, cleanup: 1.3 } };
      const zero = structuredClone(absent);
      zero.company.market.oneOffPriceElasticity = 0;
      expect(runSimulation(zero)).toEqual(runSimulation(absent));
    }
  });

  it('a non-zero elasticity at price multiplier 1 for every one-off type changes nothing', () => {
    const absent = stochasticMid(4);
    delete absent.company.market.oneOffPriceElasticity;
    absent.company.pricing = { globalMultiplier: 1, byJobType: { maint: 0.95 } };
    const withE = structuredClone(absent);
    withE.company.market.oneOffPriceElasticity = 2;
    expect(runSimulation(withE)).toEqual(runSimulation(absent));
  });

  it('in a full run, a higher one-off price with elasticity creates fewer one-off orders', () => {
    const base = stochasticMid(11);
    base.company.market.oneOffPriceElasticity = 1.5;
    const pricey = structuredClone(base);
    pricey.company.pricing = { ...pricey.company.pricing, byJobType: { ...pricey.company.pricing.byJobType, cleanup: 1.6 } };
    // Completed + cancelled cleanups: the factor 1.6^(−1.5) ≈ 0.494 halves arrivals, far beyond dispatch noise.
    const handled = (s: Scenario) => {
      const js = runSimulation(s, { detail: 'summary' }).jobTypeStats.cleanup;
      return js.jobsCompleted + js.jobsCancelled;
    };
    expect(handled(pricey)).toBeLessThan(0.75 * handled(base));
  });
});
