/** Daily loop, records and summaries (simulation-engine §4). */
import type {
  BalanceSheet,
  CrewDayLog,
  CrewStats,
  CustomerSnapshot,
  DailyRecord,
  Id,
  JobTypeStats,
  PeriodSummary,
  PlannedAction,
  RunSimulation,
  Scenario,
  SimulationOptions,
  SimulationResult,
  WeatherState,
} from './types';
import { STREAM, rand01 } from './rng';
import { buildCalendar, isWorkday } from './calendar';
import {
  availableCash,
  dailyFromMonthly,
  equity,
  isOvertimeSettlementDay,
  isPayday,
  locStep,
  payrollBurden,
  weeklyOvertime,
} from './finance/formulas';
import {
  computeNetCashFlow,
  computeOperatingCashOut,
  computeSubtotals,
  sumCashFlow,
  sumIncome,
  sumOps,
  zeroCashFlow,
  zeroIncome,
  zeroOps,
} from './finance/statements';
import { applyActionsForDay } from './actions';
import { assetStep, depreciateAll, leaseCostPerDay, payLoans } from './assets';
import { demandStep } from './demand';
import { dispatchDay } from './dispatch';
import { workforceStep } from './workforce';
import { allAssets, initState, type DayCtx, type SimState } from './state';
import { validateScenario } from './validate';

/** Weather from one draw: u < rainout ⇒ rainout; u < rainout + partial ⇒ partial; else clear. */
export function weatherFromDraw(u: number, rainoutProb: number, partialProb: number): WeatherState {
  if (u < rainoutProb) return 'rainout';
  if (u < rainoutProb + partialProb) return 'partial';
  return 'clear';
}

function financeStep(st: SimState, ctx: DayCtx, firstOfMonth: boolean): { shortfall: boolean; balance: BalanceSheet } {
  const day = ctx.day;
  const co = st.company;
  const wf = co.workforce;
  const fin = co.finance;
  const inc = ctx.inc;
  const cf = ctx.cf;
  const b = st.bal;

  // Weekly overtime (Sundays and the final day), including employees who left this week.
  if (isOvertimeSettlementDay(day, st.horizon)) {
    for (const e of st.employees) {
      if (e.weekHours === 0) continue;
      const ot = weeklyOvertime(e.weekHours, wf.overtimeWeeklyThresholdHours, wf.overtimeMultiplier, e.wage);
      inc.directLabor += ot.premium;
      ctx.ops.overtimeHours += ot.otHours;
      e.weekHours = 0;
    }
  }
  inc.payrollBurden = payrollBurden(wf.payrollBurdenRate, inc.directLabor);
  b.accruedPayroll += inc.directLabor + inc.payrollBurden;
  if (isPayday(day, wf.payPeriodDays)) {
    cf.payrollPaid = b.accruedPayroll;
    b.accruedPayroll = 0;
  }

  // Collections and write-offs.
  const due = st.invoices.get(day);
  if (due) {
    for (const inv of due) {
      if (inv.bad) inc.badDebt += inv.amount;
      else cf.collections += inv.amount;
    }
    st.invoices.delete(day);
  }

  // Period costs.
  for (const o of co.costs.overhead) inc.overhead += dailyFromMonthly(o.monthlyAmount);
  inc.marketing += dailyFromMonthly(co.market.marketingMonthlySpend);
  const assets = allAssets(st);
  inc.equipmentLeases += leaseCostPerDay(assets);
  inc.depreciation += depreciateAll(assets);

  // Loans.
  if (firstOfMonth) {
    const p = payLoans(assets, day);
    inc.interest += p.interest;
    cf.interestPaid += p.interest;
    cf.principalPaid += p.principal;
  }

  cf.operatingCashOut = computeOperatingCashOut(inc);

  // Line of credit, after all other cash movements.
  const cashBefore =
    b.cash + cf.collections - cf.payrollPaid - cf.operatingCashOut - cf.interestPaid - cf.capex + cf.loanProceeds - cf.principalPaid;
  const loc = locStep(cashBefore, b.loc, fin.lineOfCredit.limit, fin.lineOfCredit.annualRate);
  inc.interest += loc.interest;
  cf.interestPaid += loc.interest;
  cf.locDraw = loc.draw;
  cf.locRepay = loc.repay;

  computeSubtotals(inc);
  cf.netCashFlow = computeNetCashFlow(cf);

  b.cash += cf.netCashFlow;
  b.ar += inc.revenue - cf.collections - inc.badDebt;
  b.nfa += ctx.assetAdditions - inc.depreciation;
  b.loanBalance += ctx.newBorrowing - cf.principalPaid;
  b.loc += cf.locDraw - cf.locRepay;
  const shortfall = b.cash < 0;
  if (shortfall) st.events.push({ day, type: 'cash-shortfall', amount: -b.cash });

  const balance: BalanceSheet = {
    cash: b.cash,
    availableCash: availableCash(b.cash, b.accruedPayroll, fin.minCashReserve, fin.lineOfCredit.limit, b.loc),
    accountsReceivable: b.ar,
    netFixedAssets: b.nfa,
    accruedPayroll: b.accruedPayroll,
    loanBalance: b.loanBalance,
    locBalance: b.loc,
    equity: equity(b.cash, b.ar, b.nfa, b.accruedPayroll, b.loanBalance, b.loc),
  };
  return { shortfall, balance };
}

function ratio(a: number, b: number): number {
  return b !== 0 ? a / b : 0;
}

export function summarize(days: DailyRecord[], index: number, month: number): PeriodSummary {
  const last = days[days.length - 1];
  const income = sumIncome(days.map((d) => d.income));
  const cashFlow = sumCashFlow(days.map((d) => d.cashFlow));
  const ops = sumOps(days.map((d) => d.ops));
  let minCash = Infinity;
  let shortfallDays = 0;
  for (const d of days) {
    if (d.balance.cash < minCash) minCash = d.balance.cash;
    if (d.cashShortfall) shortfallDays += 1;
  }
  return {
    index,
    startDay: days[0].day,
    endDay: last.day,
    month,
    income,
    cashFlow,
    balance: { ...last.balance },
    ops,
    minCash,
    shortfallDays,
    utilization: ratio(ops.onSiteHours, ops.paidHours),
    travelShare: ratio(ops.travelHours, ops.paidHours),
    missedJobRate: ratio(ops.jobsCancelled, ops.jobsCompleted + ops.jobsCancelled),
    revenuePerPaidHour: ratio(income.revenue, ops.paidHours),
    netMargin: ratio(income.netProfit, income.revenue),
    endActiveCustomers: last.activeCustomers,
    endBacklogLaborHours: last.backlogLaborHours,
  };
}

export const runSimulation: RunSimulation = (scenario: Scenario, options?: SimulationOptions): SimulationResult => {
  const issues = validateScenario(scenario);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new Error('Invalid scenario: ' + errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  }
  const warnings = issues.filter((i) => i.severity === 'warning').map((i) => `${i.path}: ${i.message}`);
  const full = (options?.detail ?? 'full') === 'full';
  const st = initState(scenario, options?.drawCache);
  const H = scenario.horizonDays;
  const cal = buildCalendar(st.company.startMonth, H);

  const actionsByDay = new Map<number, { pa: PlannedAction; index: number }[]>();
  scenario.actions.forEach((pa, index) => {
    if (pa.day >= H) return;
    let l = actionsByDay.get(pa.day);
    if (!l) actionsByDay.set(pa.day, (l = []));
    l.push({ pa, index });
  });

  const days: DailyRecord[] = new Array(H);
  const crewLogs: CrewDayLog[][] | undefined = full ? new Array(H) : undefined;

  for (let day = 0; day < H; day++) {
    const info = cal[day];
    const ctx: DayCtx = {
      day,
      month: info.month,
      inc: zeroIncome(),
      cf: zeroCashFlow(),
      ops: zeroOps(),
      assetAdditions: 0,
      newBorrowing: 0,
    };
    // 1. Actions.
    const todays = actionsByDay.get(day);
    if (todays) applyActionsForDay(st, ctx, todays);
    const co = st.company;
    // 2. Weather.
    const w = weatherFromDraw(
      rand01(st.seed, STREAM.WEATHER, 0, day, 0),
      co.weather.rainoutProbByMonth[info.month],
      co.weather.partialProbByMonth[info.month],
    );
    const workday = isWorkday(day, co.policies.workDaysPerWeek);
    // 3. Workforce.
    workforceStep(st, ctx);
    // 4. Assets.
    if (workday) assetStep(st, ctx);
    // 5. Demand.
    demandStep(st, ctx);
    // 6–7. Dispatch and unserved attribution.
    if (workday) {
      const r = dispatchDay(st, ctx, w, full);
      if (crewLogs) crewLogs[day] = r.logs as CrewDayLog[];
      // drop completed orders
      let k = 0;
      for (const o of st.open) if (o.status === 'open') st.open[k++] = o;
      st.open.length = k;
    } else if (crewLogs) {
      crewLogs[day] = st.crews
        .filter((c) => c.active)
        .map((c) => ({
          crewId: c.id,
          deployed: false,
          notDeployedReason: 'not-a-workday' as const,
          vehicleId: null,
          memberIds: [],
          absentIds: [],
          equipmentIds: [],
          stops: [],
          endClock: 0,
          miles: 0,
          onSiteHours: 0,
          travelHours: 0,
        }));
    }
    // 8. Finance.
    const { shortfall, balance } = financeStep(st, ctx, info.firstOfMonth);
    // 9. Record.
    let backlogHours = 0;
    for (const o of st.open) backlogHours += o.remaining;
    const activeCustomers = st.activeCustomerCount;
    let activeEmployees = 0;
    for (const e of st.employees) if (e.active) activeEmployees += 1;
    days[day] = {
      day,
      dayOfWeek: info.dayOfWeek,
      month: info.month,
      isWorkday: workday,
      weather: w,
      income: ctx.inc,
      cashFlow: ctx.cf,
      balance,
      ops: ctx.ops,
      activeCustomers,
      activeEmployees,
      backlogJobs: st.open.length,
      backlogLaborHours: backlogHours,
      cashShortfall: shortfall,
    };
  }

  // Monthly summaries (calendar months, sequential index) and totals.
  const months: PeriodSummary[] = [];
  let start = 0;
  for (let d = 1; d <= H; d++) {
    if (d === H || cal[d].dayOfMonth === 1) {
      months.push(summarize(days.slice(start, d), months.length, cal[start].month));
      start = d;
    }
  }
  const totals = summarize(days, 0, -1);

  const jobTypeStats: Record<Id, JobTypeStats> = {};
  for (const jt of st.jobTypes) {
    const s = { ...jt.stats };
    s.contribution = s.revenue - s.laborCost - s.materials - s.fuel;
    jobTypeStats[jt.def.id] = s;
  }
  const crewStats: Record<Id, CrewStats> = {};
  for (const c of st.crews) crewStats[c.id] = { ...c.stats };

  const result: SimulationResult = {
    scenarioId: scenario.id,
    seed: scenario.seed,
    horizonDays: H,
    days,
    months,
    totals,
    jobTypeStats,
    crewStats,
    events: st.events,
    warnings,
  };
  if (full) {
    result.crewLogs = crewLogs;
    const customers: CustomerSnapshot[] = st.customers.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      sizeFactor: c.sizeFactor,
      recurringJobTypeId: c.planIdx >= 0 ? st.jobTypes[c.planIdx].def.id : null,
      acquiredDay: c.acquiredDay,
      churnedDay: c.churnedDay,
    }));
    result.customers = customers;
  }
  return result;
};
