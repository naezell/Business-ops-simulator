/**
 * Reusable invariant checker: financial-model §9 and simulation-engine §12, every day.
 * Opening balances and asset additions are derived independently from the scenario and the
 * event log (not from engine internals).
 */
import { expect } from 'vitest';
import type {
  Action,
  AssetFinance,
  CashFlowStatement,
  IncomeStatement,
  OpsMetrics,
  PeriodSummary,
  Policies,
  Scenario,
  SimulationResult,
  DailyRecord,
} from '../../src/simulation';

const REL = 1e-6;

export function close(a: number, b: number, what: string, scale = 1): void {
  const tol = REL * Math.max(1, Math.abs(a), Math.abs(b), scale);
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} != ${b} (diff ${a - b}, tol ${tol})`);
}

/** Independent opening book value (financial-model §5). */
function openingBook(a: AssetFinance): number {
  if (a.financing.kind === 'lease') return 0;
  const used = a.ageYears >= a.usefulLifeYears ? 1 : a.ageYears / a.usefulLifeYears;
  const v = a.purchasePrice - used * (a.purchasePrice - a.salvageValue);
  return v < a.salvageValue ? a.salvageValue : v;
}

function acquisitionsOf(action: Action): { price: number; method: 'cash' | 'loan' | 'lease' }[] {
  switch (action.type) {
    case 'add-crew':
      return [
        { price: action.vehicle.spec.purchasePrice, method: action.vehicle.method },
        ...action.equipment.map((e) => ({ price: e.spec.purchasePrice, method: e.method })),
      ];
    case 'acquire-vehicle':
    case 'acquire-equipment':
      return [{ price: action.spec.purchasePrice, method: action.method }];
    default:
      return [];
  }
}

function checkIncomeSubtotals(i: IncomeStatement, what: string): void {
  const gp = i.revenue - i.directLabor - i.payrollBurden - i.materials - i.fuel - i.maintenance - i.equipmentLeases;
  const eb = gp - i.overhead - i.marketing - i.hiringCosts - i.badDebt;
  const op = eb - i.depreciation;
  const np = op - i.interest;
  const s = Math.max(1, i.revenue, i.directLabor);
  close(i.grossProfit, gp, `${what} grossProfit`, s);
  close(i.ebitda, eb, `${what} ebitda`, s);
  close(i.operatingProfit, op, `${what} operatingProfit`, s);
  close(i.netProfit, np, `${what} netProfit`, s);
}

function checkCashFlow(c: CashFlowStatement, i: IncomeStatement, what: string): void {
  const opOut = i.materials + i.fuel + i.maintenance + i.equipmentLeases + i.overhead + i.marketing + i.hiringCosts;
  close(c.operatingCashOut, opOut, `${what} operatingCashOut`);
  const net =
    c.collections - c.payrollPaid - c.operatingCashOut - c.interestPaid - c.capex + c.loanProceeds - c.principalPaid + c.locDraw - c.locRepay;
  close(c.netCashFlow, net, `${what} netCashFlow`, Math.max(c.collections, c.payrollPaid));
  expect(c.loanProceeds).toBe(0);
  close(c.interestPaid, i.interest, `${what} interestPaid = interest`);
}

function sumDays<T extends object>(days: DailyRecord[], pick: (d: DailyRecord) => T, key: keyof T): number {
  let s = 0;
  for (const d of days) s += pick(d)[key] as unknown as number;
  return s;
}

function checkPeriod(p: PeriodSummary, all: DailyRecord[], what: string): void {
  const days = all.slice(p.startDay, p.endDay + 1);
  for (const k of Object.keys(p.income) as (keyof IncomeStatement)[]) {
    close(p.income[k], sumDays(days, (d) => d.income, k), `${what} income.${k}`, 1e3);
  }
  for (const k of Object.keys(p.cashFlow) as (keyof CashFlowStatement)[]) {
    close(p.cashFlow[k], sumDays(days, (d) => d.cashFlow, k), `${what} cashFlow.${k}`, 1e3);
  }
  for (const k of Object.keys(p.ops) as (keyof OpsMetrics)[]) {
    if (k === 'unservedHoursByReason') {
      for (const r of Object.keys(p.ops.unservedHoursByReason) as (keyof OpsMetrics['unservedHoursByReason'])[]) {
        close(p.ops.unservedHoursByReason[r], days.reduce((s, d) => s + d.ops.unservedHoursByReason[r], 0), `${what} unserved.${r}`);
      }
    } else close(p.ops[k] as number, sumDays(days, (d) => d.ops, k), `${what} ops.${k}`);
  }
  expect(p.balance).toEqual(days[days.length - 1].balance);
  checkIncomeSubtotals(p.income, what);
  checkCashFlow(p.cashFlow, p.income, what);
  expect(p.minCash).toBe(Math.min(...days.map((d) => d.balance.cash)));
  expect(p.shortfallDays).toBe(days.filter((d) => d.cashShortfall).length);
  expect(p.endActiveCustomers).toBe(days[days.length - 1].activeCustomers);
}

/** Throws (via expect) if any invariant is violated on any day. */
export function assertInvariants(scenario: Scenario, result: SimulationResult): void {
  const co = scenario.company;
  const days = result.days;
  expect(days.length).toBe(scenario.horizonDays);

  // Opening balance sheet.
  let cash = co.finance.startingCash;
  let ar = 0;
  let accrued = 0;
  let loc = 0;
  let nfa = 0;
  let loan = 0;
  for (const a of [...co.vehicles.map((v) => v.asset), ...co.equipment.map((e) => e.asset)]) {
    nfa += openingBook(a);
    if (a.financing.kind === 'loan') loan += a.financing.balance;
  }
  let equity = cash + ar + nfa - accrued - loan - loc;

  // Additions and borrowing per day from applied actions.
  const additions = new Map<number, number>();
  const borrowing = new Map<number, number>();
  const policyPatches = new Map<number, Partial<Policies>[]>();
  for (const ev of result.events) {
    if (ev.type !== 'action-applied') continue;
    for (const acq of acquisitionsOf(ev.action)) {
      if (acq.method === 'lease') continue;
      additions.set(ev.day, (additions.get(ev.day) ?? 0) + acq.price);
      if (acq.method === 'loan')
        borrowing.set(ev.day, (borrowing.get(ev.day) ?? 0) + acq.price * (1 - co.finance.newLoan.downPaymentFraction));
    }
    if (ev.action.type === 'set-policy') {
      const l = policyPatches.get(ev.day) ?? [];
      l.push(ev.action.patch);
      policyPatches.set(ev.day, l);
    }
  }
  // Down periods per vehicle/equipment from breakdown events.
  const downUntil = new Map<string, { from: number; to: number }[]>();
  for (const ev of result.events) {
    if (ev.type === 'vehicle-breakdown' || ev.type === 'equipment-breakdown') {
      const id = ev.type === 'vehicle-breakdown' ? ev.vehicleId : ev.equipmentId;
      const l = downUntil.get(id) ?? [];
      l.push({ from: ev.day, to: ev.day + ev.downDays - 1 });
      downUntil.set(id, l);
    }
  }
  const isDown = (id: string, day: number) => (downUntil.get(id) ?? []).some((p) => day >= p.from && day <= p.to);

  let policies: Policies = { ...co.policies };
  let created = 0;
  let completed = 0;
  let cancelled = 0;
  let withdrawn = 0;

  for (const d of days) {
    const t = d.day;
    const w = `day ${t}`;
    for (const p of policyPatches.get(t) ?? []) policies = { ...policies, ...p };
    const i = d.income;
    const c = d.cashFlow;
    const b = d.balance;
    const scale = Math.max(1, Math.abs(b.cash), Math.abs(b.equity), nfa, loan);

    // §8 / §9.9 subtotals; cash flow composition.
    checkIncomeSubtotals(i, w);
    checkCashFlow(c, i, w);
    // Non-negative flows.
    for (const k of Object.keys(i) as (keyof IncomeStatement)[]) {
      if (!['grossProfit', 'ebitda', 'operatingProfit', 'netProfit'].includes(k)) expect(i[k], `${w} ${k}`).toBeGreaterThanOrEqual(0);
    }
    for (const k of Object.keys(c) as (keyof CashFlowStatement)[]) {
      if (k !== 'netCashFlow') expect(c[k], `${w} ${k}`).toBeGreaterThanOrEqual(0);
    }
    close(i.payrollBurden, co.workforce.payrollBurdenRate * i.directLabor, `${w} burden`);

    // §9.1–9.6 roll-forwards.
    close(b.cash, cash + c.netCashFlow, `${w} cash roll-forward`, scale);
    close(b.accountsReceivable, ar + i.revenue - c.collections - i.badDebt, `${w} AR roll-forward`, scale);
    close(b.accruedPayroll, accrued + i.directLabor + i.payrollBurden - c.payrollPaid, `${w} accrued payroll roll-forward`, scale);
    close(b.netFixedAssets, nfa + (additions.get(t) ?? 0) - i.depreciation, `${w} NFA roll-forward`, scale);
    close(b.loanBalance, loan + (borrowing.get(t) ?? 0) - c.principalPaid, `${w} loan roll-forward`, scale);
    close(b.locBalance, loc + c.locDraw - c.locRepay, `${w} LOC roll-forward`, scale);
    // Balance definitions.
    close(b.equity, b.cash + b.accountsReceivable + b.netFixedAssets - b.accruedPayroll - b.loanBalance - b.locBalance, `${w} equity def`, scale);
    close(
      b.availableCash,
      b.cash - b.accruedPayroll - co.finance.minCashReserve + (co.finance.lineOfCredit.limit - b.locBalance),
      `${w} availableCash def`,
      scale,
    );
    // §9.7 master identity.
    close(b.equity - equity, i.netProfit, `${w} equity change = net profit`, scale);
    // Balance sanity.
    expect(b.accountsReceivable).toBeGreaterThanOrEqual(-1e-6);
    expect(b.accruedPayroll).toBeGreaterThanOrEqual(-1e-6);
    expect(b.loanBalance).toBeGreaterThanOrEqual(-1e-6);
    expect(b.locBalance).toBeGreaterThanOrEqual(-1e-9);
    expect(b.locBalance).toBeLessThanOrEqual(co.finance.lineOfCredit.limit + 1e-6);
    expect(d.cashShortfall).toBe(b.cash < 0);
    if (c.locDraw > 0) expect(c.locRepay).toBe(0);

    // §12.3 hours.
    const o = d.ops;
    close(o.paidHours, o.onSiteHours + o.travelHours + o.idleHours, `${w} hours identity`);
    for (const k of ['paidHours', 'onSiteHours', 'travelHours', 'overtimeHours', 'milesDriven', 'lostRevenue'] as const) {
      expect(o[k], `${w} ${k}`).toBeGreaterThanOrEqual(0);
    }
    expect(o.idleHours, `${w} idle`).toBeGreaterThanOrEqual(-1e-9);
    for (const v of Object.values(o.unservedHoursByReason)) expect(v).toBeGreaterThanOrEqual(0);
    if (!d.isWorkday) {
      expect(o.paidHours).toBe(0);
      expect(o.jobsCompleted).toBe(0);
    }

    // §12.4 order conservation (cumulative).
    created += o.jobsCreated;
    completed += o.jobsCompleted;
    cancelled += o.jobsCancelled;
    withdrawn += o.jobsWithdrawn;
    expect(created, `${w} order conservation`).toBe(completed + cancelled + withdrawn + d.backlogJobs);
    expect(d.backlogLaborHours).toBeGreaterThanOrEqual(0);

    // §12.5 physical constraints, from full logs when present.
    const logs = result.crewLogs?.[t];
    if (logs) {
      const L = policies.shiftHours + policies.maxOvertimeHoursPerDay;
      const vehicles = new Set<string>();
      const items = new Set<string>();
      let miles = 0;
      for (const l of logs) {
        expect(l.endClock, `${w} clock limit ${l.crewId}`).toBeLessThanOrEqual(L + 1e-9);
        for (const m of l.memberIds) expect(l.absentIds).not.toContain(m);
        if (l.deployed) {
          expect(l.vehicleId).not.toBeNull();
          expect(l.stops.length).toBeGreaterThan(0);
          expect(l.memberIds.length).toBeGreaterThan(0);
        } else {
          expect(l.stops.length).toBe(0);
          expect(l.endClock).toBe(0);
        }
        if (l.vehicleId !== null) {
          expect(vehicles.has(l.vehicleId), `${w} vehicle ${l.vehicleId} used twice`).toBe(false);
          vehicles.add(l.vehicleId);
          expect(isDown(l.vehicleId, t), `${w} vehicle ${l.vehicleId} used while down`).toBe(false);
        }
        for (const e of l.equipmentIds) {
          expect(items.has(e), `${w} equipment ${e} used twice`).toBe(false);
          items.add(e);
          expect(isDown(e, t), `${w} equipment ${e} used while down`).toBe(false);
        }
        let prev = 0;
        for (const s of l.stops) {
          expect(s.arrive).toBeGreaterThanOrEqual(prev - 1e-9);
          expect(s.depart).toBeGreaterThanOrEqual(s.arrive - 1e-9);
          prev = s.depart;
        }
        miles += l.miles;
      }
      close(miles, o.milesDriven, `${w} miles`);
      expect(new Set(logs.flatMap((l) => l.memberIds)).size).toBe(logs.reduce((s, l) => s + l.memberIds.length, 0));
    }

    cash = b.cash;
    ar = b.accountsReceivable;
    accrued = b.accruedPayroll;
    nfa = b.netFixedAssets;
    loan = b.loanBalance;
    loc = b.locBalance;
    equity = b.equity;
  }

  // §9.8 period summaries.
  for (const m of result.months) checkPeriod(m, days, `month ${m.index}`);
  checkPeriod(result.totals, days, 'totals');
  // Months tile the horizon.
  let next = 0;
  result.months.forEach((m, k) => {
    expect(m.index).toBe(k);
    expect(m.startDay).toBe(next);
    expect(days[m.startDay].month).toBe(m.month);
    next = m.endDay + 1;
  });
  expect(next).toBe(scenario.horizonDays);

  // Job type / crew stats consistent with totals.
  const jt = Object.values(result.jobTypeStats);
  close(jt.reduce((s, x) => s + x.revenue, 0), result.totals.income.revenue, 'jobTypeStats revenue', 1e3);
  expect(jt.reduce((s, x) => s + x.jobsCompleted, 0)).toBe(result.totals.ops.jobsCompleted);
  expect(jt.reduce((s, x) => s + x.jobsCancelled, 0)).toBe(result.totals.ops.jobsCancelled);
  close(jt.reduce((s, x) => s + x.materials, 0), result.totals.income.materials, 'jobTypeStats materials', 1e3);
  for (const x of jt) close(x.contribution, x.revenue - x.laborCost - x.materials - x.fuel, `contribution ${x.jobTypeId}`, 1e3);
  const cs = Object.values(result.crewStats);
  close(cs.reduce((s, x) => s + x.revenue, 0), result.totals.income.revenue, 'crewStats revenue', 1e3);
  close(cs.reduce((s, x) => s + x.milesDriven, 0), result.totals.ops.milesDriven, 'crewStats miles', 1e3);
  expect(cs.reduce((s, x) => s + x.daysDeployed, 0)).toBe(result.totals.ops.crewDaysDeployed);
  expect(cs.reduce((s, x) => s + x.daysNotDeployed, 0)).toBe(result.totals.ops.crewDaysNotDeployed);
}
