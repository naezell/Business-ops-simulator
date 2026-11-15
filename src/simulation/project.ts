/**
 * Display projection: the company as it looks once a list of planned actions has
 * taken effect. Reuses the engine's own `applyAction`, so validation, rejection
 * reasons and generated ids (`h-d{day}-{index}-{k}`, `crew-d{day}-{index}`,
 * `a-d{day}-{index}-{k}`) are exactly the engine's.
 */
import type { AssetFinance, CompanyConfig, EquipmentItem, Employee, Financing, PlannedAction, Vehicle } from './types';
import { applyAction } from './actions';
import { zeroCashFlow, zeroIncome, zeroOps } from './finance/statements';
import { initState, type AssetS, type DayCtx } from './state';

export interface RejectedProjectionAction {
  /** Position of the action in the input list (the engine's action index). */
  index: number;
  action: PlannedAction;
  /** The engine's rejection reason, identical to the `action-rejected` event's. */
  reason: string;
}

export interface ProjectedCompany {
  company: CompanyConfig;
  rejected: RejectedProjectionAction[];
}

function financingOf(a: AssetS, leaseMonthly: number): Financing {
  if (a.leased) return { kind: 'lease', monthlyPayment: leaseMonthly };
  if (a.loan) return { kind: 'loan', balance: a.loan.balance, annualRate: a.loan.annualRate, monthsRemaining: a.loan.monthsRemaining };
  return { kind: 'owned' };
}

function newAssetFinance(a: AssetS, spec: { purchasePrice: number; usefulLifeYears: number; salvageValue: number; leaseMonthly: number }): AssetFinance {
  return {
    purchasePrice: spec.purchasePrice,
    usefulLifeYears: spec.usefulLifeYears,
    salvageValue: spec.salvageValue,
    ageYears: 0,
    financing: financingOf(a, spec.leaseMonthly),
  };
}

/**
 * FOR DISPLAY ONLY — the roster, fleet, kit, prices, policies, marketing spend and
 * offered services after `actions`, as a plain `CompanyConfig`. It is NOT a substitute
 * for simulating the actions: run `runSimulation({ company, actions })` for any number.
 *
 * Actions are applied in engine order (day ascending, then array index) through the
 * engine's own action code; an action the engine would reject on its day is reported in
 * `rejected` and has no effect. Ids use each action's own day and array index, exactly as
 * the engine assigns them, so they match `crewLogs` and events of a real run.
 *
 * For actions on day 0, simulating `{ company: projected, actions: [] }` reproduces the
 * rosters, kits, vehicles, prices and policies of simulating `{ company, actions }` on
 * every day (tested). What legitimately differs:
 *  - day-0 money: hiring costs and the cash paid for purchases (cash prices and loan
 *    down payments) — the projected company already owns the assets and staff, so cash,
 *    line-of-credit draws and interest differ. Loan balances and repayments agree (an
 *    opening loan and a day-0 loan both first pay on the next first-of-month);
 *  - events: no `action-applied` / `employee-hired` events for the projected items;
 *  - price-shock churn: a `set-price` increase churns some customers at random in the
 *    engine; the projection keeps every customer (customers are returned unchanged).
 * For actions on later days the projection shows them as already in effect; it ignores
 * what would happen before that day (quits, asset ageing, loan repayments) and so may
 * accept an action that a real run rejects (e.g. removing someone who quit earlier).
 */
export function applyActionsAtDayZero(company: CompanyConfig, actions: PlannedAction[]): ProjectedCompany {
  let lastDay = 0;
  for (const pa of actions) lastDay = Math.max(lastDay, pa.day);
  const st = initState({ id: 'projection', name: 'projection', company, actions: [], horizonDays: lastDay + 1, seed: 0 });
  const order = actions.map((pa, index) => ({ pa, index })).sort((a, b) => a.pa.day - b.pa.day || a.index - b.index);
  const rejected: RejectedProjectionAction[] = [];
  for (const { pa, index } of order) {
    const ctx: DayCtx = {
      day: pa.day,
      month: 0,
      inc: zeroIncome(),
      cf: zeroCashFlow(),
      ops: zeroOps(),
      assetAdditions: 0,
      newBorrowing: 0,
    };
    const reason = applyAction(st, ctx, structuredClone(pa.action), index);
    if (reason !== null) rejected.push({ index, action: pa, reason });
  }

  const out = structuredClone(st.company);
  const vehicleById = new Map(company.vehicles.map((v) => [v.id, v]));
  const equipmentById = new Map(company.equipment.map((e) => [e.id, e]));

  out.employees = st.employees
    .filter((e) => e.active)
    .map(
      (e): Employee => ({
        id: e.id,
        name: e.name,
        hourlyWage: e.wage,
        skill: e.skill,
        productivity: e.productivity,
        crewId: e.crewId,
        tenureDays: e.hireDay < 0 ? -e.hireDay : 0,
      }),
    );
  out.crews = st.crews.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, vehicleId: c.vehicleId }));
  out.vehicles = st.vehicles.map((v): Vehicle => {
    const orig = vehicleById.get(v.id);
    if (orig && !v.spec) return structuredClone(orig);
    const spec = v.spec!;
    return {
      id: v.id,
      name: spec.name,
      seats: spec.seats,
      mpg: spec.mpg,
      maintenanceCostPerMile: spec.maintenanceCostPerMile,
      asset: newAssetFinance(v.a, spec),
    };
  });
  out.equipment = st.equipment.map((e): EquipmentItem => {
    const orig = equipmentById.get(e.id);
    if (orig && !e.spec) return { ...structuredClone(orig), crewId: e.crewId };
    const spec = e.spec!;
    return {
      id: e.id,
      name: spec.name,
      equipmentTypeId: spec.equipmentTypeId,
      crewId: e.crewId,
      maintenanceCostPerHour: spec.maintenanceCostPerHour,
      asset: newAssetFinance(e.a, spec),
    };
  });
  // Customers are never changed by an action except through random price-shock churn.
  out.customers = structuredClone(company.customers);
  return { company: out, rejected };
}
