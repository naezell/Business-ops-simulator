import type { CashFlowStatement, IncomeStatement, OpsMetrics, UnservedReason } from '../types';

export const UNSERVED_REASONS: readonly UnservedReason[] = [
  'capacity',
  'weather',
  'vehicle',
  'equipment',
  'skill',
  'crew-size',
  'no-crew',
];

export function zeroIncome(): IncomeStatement {
  return {
    revenue: 0,
    directLabor: 0,
    payrollBurden: 0,
    materials: 0,
    fuel: 0,
    maintenance: 0,
    equipmentLeases: 0,
    grossProfit: 0,
    overhead: 0,
    marketing: 0,
    hiringCosts: 0,
    badDebt: 0,
    ebitda: 0,
    depreciation: 0,
    operatingProfit: 0,
    interest: 0,
    netProfit: 0,
    gainOnDisposal: 0,
  };
}

export function zeroCashFlow(): CashFlowStatement {
  return {
    collections: 0,
    payrollPaid: 0,
    operatingCashOut: 0,
    interestPaid: 0,
    capex: 0,
    loanProceeds: 0,
    principalPaid: 0,
    locDraw: 0,
    locRepay: 0,
    netCashFlow: 0,
    assetSaleProceeds: 0,
    ownerDistributions: 0,
  };
}

export function zeroUnserved(): Record<UnservedReason, number> {
  return { capacity: 0, weather: 0, vehicle: 0, equipment: 0, skill: 0, 'crew-size': 0, 'no-crew': 0 };
}

export function zeroOps(): OpsMetrics {
  return {
    jobsCreated: 0,
    jobsCompleted: 0,
    jobsCancelled: 0,
    jobsLate: 0,
    jobsWithdrawn: 0,
    leads: 0,
    newCustomers: 0,
    churnedCustomers: 0,
    paidHours: 0,
    onSiteHours: 0,
    travelHours: 0,
    idleHours: 0,
    overtimeHours: 0,
    absentShifts: 0,
    crewDaysDeployed: 0,
    crewDaysNotDeployed: 0,
    milesDriven: 0,
    unservedHoursByReason: zeroUnserved(),
    lostRevenue: 0,
    scheduledHours: 0,
    completedLaborHours: 0,
    quits: 0,
  };
}

/** grossProfit, ebitda, operatingProfit, netProfit from the lines (financial-model §8). */
export function computeSubtotals(i: IncomeStatement): void {
  i.grossProfit =
    i.revenue - i.directLabor - i.payrollBurden - i.materials - i.fuel - i.maintenance - i.equipmentLeases;
  i.ebitda = i.grossProfit - i.overhead - i.marketing - i.hiringCosts - i.badDebt;
  // simulation-design §6: + gainOnDisposal (exactly the old value when it is 0).
  i.operatingProfit = i.gainOnDisposal === 0 ? i.ebitda - i.depreciation : i.ebitda - i.depreciation + i.gainOnDisposal;
  i.netProfit = i.operatingProfit - i.interest;
}

export function computeOperatingCashOut(i: IncomeStatement): number {
  return i.materials + i.fuel + i.maintenance + i.equipmentLeases + i.overhead + i.marketing + i.hiringCosts;
}

export function computeNetCashFlow(c: CashFlowStatement): number {
  return (
    c.collections -
    c.payrollPaid -
    c.operatingCashOut -
    c.interestPaid -
    c.capex +
    c.loanProceeds -
    c.principalPaid +
    c.locDraw -
    c.locRepay +
    c.assetSaleProceeds -
    c.ownerDistributions
  );
}

const INCOME_LINES: (keyof IncomeStatement)[] = [
  'revenue',
  'directLabor',
  'payrollBurden',
  'materials',
  'fuel',
  'maintenance',
  'equipmentLeases',
  'overhead',
  'marketing',
  'hiringCosts',
  'badDebt',
  'depreciation',
  'interest',
  'gainOnDisposal',
];

const CASH_LINES: (keyof CashFlowStatement)[] = [
  'collections',
  'payrollPaid',
  'operatingCashOut',
  'interestPaid',
  'capex',
  'loanProceeds',
  'principalPaid',
  'locDraw',
  'locRepay',
  'assetSaleProceeds',
  'ownerDistributions',
];

/** Sum of income lines; subtotals recomputed from the summed lines. */
export function sumIncome(items: IncomeStatement[]): IncomeStatement {
  const out = zeroIncome();
  for (const it of items) for (const k of INCOME_LINES) out[k] += it[k];
  computeSubtotals(out);
  return out;
}

export function sumCashFlow(items: CashFlowStatement[]): CashFlowStatement {
  const out = zeroCashFlow();
  for (const it of items) for (const k of CASH_LINES) out[k] += it[k];
  out.netCashFlow = computeNetCashFlow(out);
  return out;
}

const OPS_NUMERIC: (keyof Omit<OpsMetrics, 'unservedHoursByReason'>)[] = [
  'jobsCreated',
  'jobsCompleted',
  'jobsCancelled',
  'jobsLate',
  'jobsWithdrawn',
  'leads',
  'newCustomers',
  'churnedCustomers',
  'paidHours',
  'onSiteHours',
  'travelHours',
  'idleHours',
  'overtimeHours',
  'absentShifts',
  'crewDaysDeployed',
  'crewDaysNotDeployed',
  'milesDriven',
  'lostRevenue',
  'scheduledHours',
  'completedLaborHours',
  'quits',
];

export function sumOps(items: OpsMetrics[]): OpsMetrics {
  const out = zeroOps();
  for (const it of items) {
    for (const k of OPS_NUMERIC) out[k] += it[k];
    for (const r of UNSERVED_REASONS) out.unservedHoursByReason[r] += it.unservedHoursByReason[r];
  }
  return out;
}
