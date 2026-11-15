/** Demand (simulation-engine §5): visits, one-offs, leads, conversions, churn, cancellation. */
import type { Id, JobTypeDef, Pricing } from './types';
import { STREAM, hashString, poissonInverse, rand01, rand01FromPrefix, randPrefix } from './rng';
import type { CustomerS, DayCtx, JobTypeS, OrderS, SimState } from './state';

/** Tolerance for visit accrual so that k × (1/k) reaches 1 despite float rounding. */
export const ACCRUAL_EPS = 1e-9;

// ───────────── Pure formulas ─────────────

/** P_j = globalMultiplier × (byJobType[j] ?? 1). */
export function priceMultiplier(pricing: Pricing, jobTypeId: Id): number {
  return pricing.globalMultiplier * (pricing.byJobType[jobTypeId] ?? 1);
}

/** Weighted mean of multipliers; plain mean if all weights are 0; 1 if no entries. */
export function priceIndexFrom(entries: { multiplier: number; weight: number }[]): number {
  if (entries.length === 0) return 1;
  let sw = 0;
  let swp = 0;
  let sp = 0;
  for (const e of entries) {
    sw += e.weight;
    swp += e.weight * e.multiplier;
    sp += e.multiplier;
  }
  return sw > 0 ? swp / sw : sp / entries.length;
}

/**
 * Price index of the company: over offered recurring job types, weighted by the number of
 * active customers on each plan.
 */
export function priceIndex(
  jobTypes: JobTypeDef[],
  pricing: Pricing,
  activePlanCounts: Record<Id, number>,
): number {
  const entries: { multiplier: number; weight: number }[] = [];
  for (const j of jobTypes) {
    if (j.kind !== 'recurring' || !j.offered) continue;
    entries.push({ multiplier: priceMultiplier(pricing, j.id), weight: activePlanCounts[j.id] ?? 0 });
  }
  return priceIndexFrom(entries);
}

/** Expected leads per day: (organic + max × (1 − e^(−spend/scale))) × seasonality / 30. */
export function leadRatePerDay(
  organicPerMonth: number,
  marketingMaxPerMonth: number,
  monthlySpend: number,
  spendScale: number,
  seasonality: number,
): number {
  const mkt = spendScale > 0 ? marketingMaxPerMonth * (1 - Math.exp(-monthlySpend / spendScale)) : 0;
  return ((organicPerMonth + mkt) * seasonality) / 30;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** clamp(base × priceIndex^(−elasticity), 0, 1). */
export function conversionProbability(baseRate: number, priceIdx: number, elasticity: number): number {
  return clamp(baseRate * Math.pow(priceIdx, -elasticity), 0, 1);
}

/** c = clamp(base × priceIndex^e × (1 + w × failureScore), 0, 0.5). */
export function monthlyChurnRate(
  baseMonthlyChurn: number,
  priceIdx: number,
  retentionElasticity: number,
  failureWeight: number,
  failureScore: number,
): number {
  return clamp(baseMonthlyChurn * Math.pow(priceIdx, retentionElasticity) * (1 + failureWeight * failureScore), 0, 0.5);
}

/** Daily hazard from a monthly probability: 1 − (1 − c)^(1/30). */
export function dailyHazardFromMonthly(c: number): number {
  return 1 - Math.pow(1 - c, 1 / 30);
}

/** Churn hazard per day for one customer. */
export function churnHazard(
  baseMonthlyChurn: number,
  priceIdx: number,
  retentionElasticity: number,
  failureWeight: number,
  failureScore: number,
): number {
  return dailyHazardFromMonthly(monthlyChurnRate(baseMonthlyChurn, priceIdx, retentionElasticity, failureWeight, failureScore));
}

/** Daily decay multiplier of the service-failure score: 0.5^(1/halfLife); 0 if halfLife ≤ 0. */
export function failureDecayFactor(halfLifeDays: number): number {
  return halfLifeDays > 0 ? Math.pow(0.5, 1 / halfLifeDays) : 0;
}

/** min(0.9, perPct × 100δ) for δ > 0, else 0. */
export function priceShockProbability(shockPerPct: number, delta: number): number {
  return delta > 0 ? Math.min(0.9, shockPerPct * 100 * delta) : 0;
}

/**
 * Price response of one-off arrivals (§5.2, ADR-008): P^(−elasticity).
 * Missing/0 elasticity ⇒ 1; P ≤ 0 (or non-finite) ⇒ 1.
 */
export function oneOffPriceFactor(priceMult: number, elasticity: number | undefined): number {
  const e = elasticity ?? 0;
  if (e === 0 || !(priceMult > 0) || !Number.isFinite(priceMult)) return 1;
  return Math.pow(priceMult, -e);
}

/**
 * One-off arrival probability per customer per day (§5.2):
 * annualRate × seasonality / 365 × P^(−elasticity). With the default price arguments this is
 * exactly annualRate × seasonality / 365.
 */
export function oneOffDailyProbability(
  annualRatePerCustomer: number,
  seasonality: number,
  priceMult = 1,
  elasticity?: number,
): number {
  const base = (annualRatePerCustomer * seasonality) / 365;
  const f = oneOffPriceFactor(priceMult, elasticity);
  return f === 1 ? base : base * f;
}

// ───────────── State helpers ─────────────

export function createOrder(st: SimState, ctx: DayCtx, c: CustomerS, jt: JobTypeS, n: number): OrderS {
  const d = jt.def;
  const P = priceMultiplier(st.company.pricing, d.id);
  const labor = d.standardLaborHours * c.sizeFactor;
  ctx.ops.jobsCreated += 1;
  return {
    id: `${c.id}:${d.id}:${ctx.day}:${n}`,
    cust: c,
    jt,
    x: c.x,
    y: c.y,
    price: d.basePrice * c.sizeFactor * P,
    labor,
    remaining: labor,
    materials: d.materialCost * c.sizeFactor,
    createdDay: ctx.day,
    status: 'open',
    started: false,
    sector: 0,
    tBack: -1,
  };
}

/** Customer leaves; its open orders are withdrawn (not missed, no lost revenue). */
export function churnCustomer(st: SimState, ctx: DayCtx, c: CustomerS): void {
  if (!c.active) return;
  c.active = false;
  c.churnedDay = ctx.day;
  ctx.ops.churnedCustomers += 1;
  for (const o of st.open) {
    if (o.status === 'open' && o.cust === c) {
      o.status = 'withdrawn';
      ctx.ops.jobsWithdrawn += 1;
    }
  }
}

export function compactOpen(st: SimState): void {
  let w = 0;
  const arr = st.open;
  for (let r = 0; r < arr.length; r++) if (arr[r].status === 'open') arr[w++] = arr[r];
  arr.length = w;
}

function byId(a: OrderS, b: OrderS): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Cached rng prefix for the customer's one-off draws of job type `jt` (seed is fixed within a run). */
function oneOffPrefix(seed: number, c: CustomerS, jt: JobTypeS): number {
  let k = c.oneOffKeys[jt.idx];
  if (k === undefined) {
    k = randPrefix(seed, STREAM.ONEOFF_DEMAND, hashString(c.id + ':' + jt.def.id));
    c.oneOffKeys[jt.idx] = k;
  }
  return k;
}

function churnPrefix(seed: number, c: CustomerS): number {
  if (Number.isNaN(c.churnPrefix)) c.churnPrefix = randPrefix(seed, STREAM.CHURN, c.key);
  return c.churnPrefix;
}

export function currentPriceIndex(st: SimState): number {
  // Count per job-type index first (hot path: once per day over every customer), then key by id.
  const byIdx = new Array<number>(st.jobTypes.length).fill(0);
  for (const c of st.customers) if (c.active && c.planIdx >= 0) byIdx[c.planIdx] += 1;
  const counts: Record<Id, number> = {};
  for (let i = 0; i < byIdx.length; i++) if (byIdx[i] > 0) counts[st.jobTypes[i].def.id] = byIdx[i];
  return priceIndex(st.company.jobTypes, st.company.pricing, counts);
}

/** Step 5 of the daily loop. */
export function demandStep(st: SimState, ctx: DayCtx): void {
  const { day, month: m } = ctx;
  const mk = st.company.market;
  const seed = st.seed;
  const pIdx = currentPriceIndex(st);
  const decay = failureDecayFactor(mk.serviceFailureHalfLifeDays);
  const oneOffs = st.jobTypes.filter((j) => j.def.kind === 'one-off' && j.def.offered);
  // Same draw u at every price: the price factor only scales the threshold (ADR-008).
  const oneOffP = oneOffs.map((j) =>
    oneOffDailyProbability(
      j.def.annualRatePerCustomer ?? 0,
      j.def.seasonality[m],
      priceMultiplier(st.company.pricing, j.def.id),
      mk.oneOffPriceElasticity,
    ),
  );
  const fresh: OrderS[] = [];

  // Recurring accrual and one-off arrivals (customers present at start of step).
  for (const c of st.customers) {
    if (!c.active) continue;
    c.failure *= decay;
    if (c.planIdx >= 0) {
      const jt = st.jobTypes[c.planIdx];
      const d = jt.def;
      if (d.offered && d.kind === 'recurring' && (d.intervalDays ?? 0) > 0) {
        c.accrual += d.seasonality[m] / (d.intervalDays as number);
        let n = 0;
        while (c.accrual >= 1 - ACCRUAL_EPS) {
          fresh.push(createOrder(st, ctx, c, jt, n++));
          c.accrual -= 1;
        }
      }
    }
    for (let i = 0; i < oneOffs.length; i++) {
      const p = oneOffP[i];
      if (!(p > 0)) continue;
      const u = rand01FromPrefix(oneOffPrefix(seed, c, oneOffs[i]), day, 0);
      if (u < p) {
        // one order per (customer, type, day) at most from this draw
        fresh.push(createOrder(st, ctx, c, oneOffs[i], 0));
      }
    }
  }
  fresh.sort(byId);
  for (const o of fresh) st.open.push(o);

  // Leads and conversions.
  const lambda = leadRatePerDay(
    mk.organicLeadsPerMonth,
    mk.marketingMaxLeadsPerMonth,
    mk.marketingMonthlySpend,
    mk.marketingSpendScale,
    mk.leadSeasonality[m],
  );
  const leads = poissonInverse(lambda, rand01(seed, STREAM.LEADS, 0, day, 0));
  ctx.ops.leads += leads;
  if (leads > 0 && st.company.policies.acceptNewCustomers) {
    const conv = conversionProbability(mk.baseConversionRate, pIdx, mk.acquisitionPriceElasticity);
    const nc = mk.newCustomer;
    const mix: { idx: number; w: number }[] = [];
    let W = 0;
    for (const j of st.jobTypes) {
      if (j.def.kind !== 'recurring' || !j.def.offered) continue;
      const w = nc.recurringJobTypeMix[j.def.id] ?? 0;
      if (w > 0) {
        mix.push({ idx: j.idx, w });
        W += w;
      }
    }
    for (let k = 0; k < leads; k++) {
      if (!(rand01(seed, STREAM.CONVERSION, 0, day, k) < conv)) continue;
      const u1 = rand01(seed, STREAM.NEW_CUSTOMER, 0, day, 4 * k);
      const u2 = rand01(seed, STREAM.NEW_CUSTOMER, 0, day, 4 * k + 1);
      const u3 = rand01(seed, STREAM.NEW_CUSTOMER, 0, day, 4 * k + 2);
      const u4 = rand01(seed, STREAM.NEW_CUSTOMER, 0, day, 4 * k + 3);
      const r = nc.serviceRadiusMiles * Math.sqrt(u1);
      const th = 2 * Math.PI * u2;
      let planIdx = -1;
      if (W > 0) {
        const target = u4 * W;
        let cum = 0;
        planIdx = mix[mix.length - 1].idx;
        for (const e of mix) {
          cum += e.w;
          if (target < cum) {
            planIdx = e.idx;
            break;
          }
        }
      }
      const id = `c-d${day}-${k}`;
      st.customers.push({
        id,
        x: r * Math.cos(th),
        y: r * Math.sin(th),
        sizeFactor: nc.sizeFactorMin + (nc.sizeFactorMax - nc.sizeFactorMin) * u3,
        planIdx,
        accrual: 0,
        failure: 0,
        active: true,
        key: hashString(id),
        acquiredDay: day,
        churnedDay: null,
        oneOffKeys: [],
        churnPrefix: NaN,
      });
      ctx.ops.newCustomers += 1;
    }
  }

  // Churn.
  if (mk.baseMonthlyChurn > 0) {
    // monthlyChurnRate with the price term hoisted out of the customer loop (same arithmetic order).
    const k = mk.baseMonthlyChurn * Math.pow(pIdx, mk.retentionPriceElasticity);
    const w = mk.serviceFailureChurnWeight;
    const h0 = dailyHazardFromMonthly(clamp(k, 0, 0.5));
    // Every hazard is clamped to at most hMax, so a draw >= hMax can never churn: skip the pow() then.
    // The draw is counter-based, so computing it unconditionally changes no other draw.
    const hMax = dailyHazardFromMonthly(0.5);
    for (const c of st.customers) {
      if (!c.active) continue;
      const u = rand01FromPrefix(churnPrefix(seed, c), day, 0);
      if (u >= hMax) continue;
      const h = c.failure === 0 ? h0 : dailyHazardFromMonthly(clamp(k * (1 + w * c.failure), 0, 0.5));
      if (h > 0 && u < h) churnCustomer(st, ctx, c);
    }
  }

  // Cancellation of stale orders (§5.5).
  for (const o of st.open) {
    if (o.status !== 'open') continue;
    if (day - o.createdDay >= o.jt.def.cancelAfterDays) cancelOrder(ctx, o);
  }
  compactOpen(st);
}

export function cancelOrder(ctx: DayCtx, o: OrderS): void {
  o.status = 'cancelled';
  ctx.ops.jobsCancelled += 1;
  ctx.ops.lostRevenue += o.price;
  o.cust.failure += 1;
  o.jt.stats.jobsCancelled += 1;
}
