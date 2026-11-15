/** Assets (simulation-engine §9, financial-model §5–6): breakdowns, acquisitions, depreciation, loans. */
import type { AcquisitionMethod, Id } from './types';
import { STREAM, hashString, rand01, uniformInt, uniformRange } from './rng';
import {
  DEFAULT_RESALE_SHARE,
  acquisitionFlows,
  dailyDepreciation,
  depreciationForDay,
  disposalProceeds,
  loanMonthStep,
  loanPayment,
} from './finance/formulas';
import type { AssetS, DayCtx, SimState } from './state';
import type { BreakdownParams } from './types';
import { scaleProbability } from './conditions';

/** min(1, dailyProb × (1 + ageFactor × ageYears)), never negative. */
export function breakdownProbability(dailyProb: number, ageFactorPerYear: number, ageYears: number): number {
  return Math.max(0, Math.min(1, dailyProb * (1 + ageFactorPerYear * ageYears)));
}

export function assetAgeOnDay(a: AssetS, day: number): number {
  return a.ageYears + (day - a.acquiredDay) / 365;
}

/** Unavailable: under repair, or out of service because of an outage shock today. */
export function isDown(a: AssetS, day: number): boolean {
  return day < a.downUntil || a.out;
}

function maybeBreak(
  st: SimState,
  ctx: DayCtx,
  a: AssetS,
  p: BreakdownParams,
  stream: number,
  probM: number,
): { downDays: number; cost: number } | null {
  const day = ctx.day;
  if (isDown(a, day)) return null;
  const prob = scaleProbability(breakdownProbability(p.dailyProb, p.ageFactorPerYear, assetAgeOnDay(a, day)), probM);
  if (!(prob > 0)) return null;
  if (!(rand01(st.seed, stream, a.key, day, 0) < prob)) return null;
  const downDays = uniformInt(p.repairDaysMin, p.repairDaysMax, rand01(st.seed, STREAM.REPAIR, a.key, day, 0));
  const base = uniformRange(p.repairCostMin, p.repairCostMax, rand01(st.seed, STREAM.REPAIR, a.key, day, 1));
  const rm = ctx.m['repair-cost'];
  const cost = rm === 1 ? base : base * rm;
  a.downUntil = day + downDays;
  ctx.inc.maintenance += cost;
  return { downDays, cost };
}

/** Step 4 (workdays only). */
export function assetStep(st: SimState, ctx: DayCtx): void {
  const rel = st.company.reliability;
  for (const v of st.vehicles) {
    const r = maybeBreak(st, ctx, v.a, rel.vehicle, STREAM.VEHICLE_BREAKDOWN, ctx.m['vehicle-breakdown']);
    if (r) st.events.push({ day: ctx.day, type: 'vehicle-breakdown', vehicleId: v.id, ...r });
  }
  for (const e of st.equipment) {
    const r = maybeBreak(st, ctx, e.a, rel.equipment, STREAM.EQUIPMENT_BREAKDOWN, ctx.m['equipment-breakdown']);
    if (r) st.events.push({ day: ctx.day, type: 'equipment-breakdown', equipmentId: e.id, ...r });
  }
}

interface AcquireSpec {
  purchasePrice: number;
  usefulLifeYears: number;
  salvageValue: number;
  leaseMonthly: number;
}

/** Create the asset record for a purchase during the run and book its day-of flows. */
export function acquireAsset(st: SimState, ctx: DayCtx, id: Id, spec: AcquireSpec, method: AcquisitionMethod): AssetS {
  const nl = st.company.finance.newLoan;
  const f = acquisitionFlows(method, spec.purchasePrice, nl.downPaymentFraction, spec.leaseMonthly);
  ctx.cf.capex += f.capex;
  ctx.assetAdditions += f.assetAddition;
  ctx.newBorrowing += f.newBorrowing;
  const leased = method === 'lease';
  const a: AssetS = {
    id,
    key: hashString(id),
    purchasePrice: spec.purchasePrice,
    salvage: spec.salvageValue,
    ageYears: 0,
    acquiredDay: ctx.day,
    leased,
    leaseDaily: f.leaseDaily,
    book: f.assetAddition,
    dailyDep: leased ? 0 : dailyDepreciation(spec.purchasePrice, spec.salvageValue, spec.usefulLifeYears),
    downUntil: 0,
    loan: null,
    out: false,
  };
  if (method === 'loan') {
    a.loan = {
      balance: f.newBorrowing,
      annualRate: nl.annualRate,
      payment: loanPayment(f.newBorrowing, nl.annualRate, nl.termMonths),
      monthsRemaining: nl.termMonths,
      startDay: ctx.day,
    };
  }
  return a;
}

/** Daily depreciation of every owned/financed asset; returns the total. */
export function depreciateAll(assets: AssetS[]): number {
  let total = 0;
  for (const a of assets) {
    if (a.leased || a.dailyDep <= 0) continue;
    const d = depreciationForDay(a.book, a.salvage, a.dailyDep);
    if (d <= 0) continue;
    if (d === a.book - a.salvage) a.book = a.salvage;
    else a.book -= d;
    total += d;
  }
  return total;
}

/** Loan payments on a first-of-month day. */
export function payLoans(assets: AssetS[], day: number): { interest: number; principal: number } {
  let interest = 0;
  let principal = 0;
  for (const a of assets) {
    const L = a.loan;
    if (!L || L.monthsRemaining <= 0 || day <= L.startDay) continue;
    const s = loanMonthStep(L.balance, L.annualRate, L.payment, L.monthsRemaining);
    L.balance = s.balance;
    L.monthsRemaining = s.monthsRemaining;
    interest += s.interest;
    principal += s.principal;
  }
  return { interest, principal };
}

export function leaseCostPerDay(assets: AssetS[]): number {
  let t = 0;
  for (const a of assets) if (a.leased) t += a.leaseDaily;
  return t;
}

/**
 * Dispose of an asset today (simulation-design §6). Owned/financed: proceeds
 * P = S + share × max(0, B − S), gain P − B, book value leaves net fixed assets, a loan is paid off
 * (principal). Leased: the lease ends; no proceeds, no gain. The asset leaves the company's lists,
 * so it is never used, depreciated, maintained or paid for again. Returns false if unknown.
 */
export function disposeAsset(st: SimState, ctx: DayCtx, assetId: Id): boolean {
  const vi = st.vehicles.findIndex((v) => v.id === assetId);
  const ei = vi >= 0 ? -1 : st.equipment.findIndex((e) => e.id === assetId);
  if (vi < 0 && ei < 0) return false;
  const a = vi >= 0 ? st.vehicles[vi].a : st.equipment[ei].a;
  let proceeds = 0;
  let book = 0;
  if (!a.leased) {
    book = a.book;
    const share = st.company.finance.resaleShareOfBookValue ?? DEFAULT_RESALE_SHARE;
    proceeds = disposalProceeds(book, a.salvage, share);
    ctx.cf.assetSaleProceeds += proceeds;
    ctx.inc.gainOnDisposal += proceeds - book;
    ctx.disposedBook += book;
    if (a.loan && a.loan.balance > 0) {
      ctx.cf.principalPaid += a.loan.balance;
      a.loan.balance = 0;
      a.loan.monthsRemaining = 0;
    }
  }
  if (vi >= 0) {
    st.vehicles.splice(vi, 1);
    for (const c of st.crews) if (c.vehicleId === assetId) c.vehicleId = null;
  } else {
    st.equipment.splice(ei, 1);
  }
  st.events.push({ day: ctx.day, type: 'asset-disposed', assetId, proceeds, bookValue: book });
  return true;
}
