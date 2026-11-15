/**
 * One pure function per formula in docs/financial-model.md.
 * No state, no randomness: callers pass the uniform draws in.
 */

// ───────────── Period costs (§4) ─────────────

/** Daily accrual of a monthly amount: monthly × 12 / 365. */
export function dailyFromMonthly(monthlyAmount: number): number {
  return (monthlyAmount * 12) / 365;
}

// ───────────── Labor (§2) ─────────────

export function grossWages(hourlyWage: number, paidHours: number): number {
  return hourlyWage * paidHours;
}

export interface OvertimeResult {
  otHours: number;
  premium: number;
}

/** Weekly overtime: otHours = max(0, weekPaid − threshold); premium = (mult − 1) × wage × otHours. */
export function weeklyOvertime(
  weekPaidHours: number,
  thresholdHours: number,
  overtimeMultiplier: number,
  hourlyWage: number,
): OvertimeResult {
  const otHours = Math.max(0, weekPaidHours - thresholdHours);
  return { otHours, premium: (overtimeMultiplier - 1) * hourlyWage * otHours };
}

/** Convenience: premium only. */
export function weeklyOvertimePremium(
  weekPaidHours: number,
  thresholdHours: number,
  overtimeMultiplier: number,
  hourlyWage: number,
): number {
  return weeklyOvertime(weekPaidHours, thresholdHours, overtimeMultiplier, hourlyWage).premium;
}

/** Overtime is settled on Sundays (dayOfWeek 6) and on the final day of the horizon. */
export function isOvertimeSettlementDay(day: number, horizonDays: number): boolean {
  return day % 7 === 6 || day === horizonDays - 1;
}

export function payrollBurden(burdenRate: number, directLabor: number): number {
  return burdenRate * directLabor;
}

/** Payroll is disbursed on days with (day + 1) mod payPeriodDays == 0. */
export function isPayday(day: number, payPeriodDays: number): boolean {
  return payPeriodDays > 0 && (day + 1) % payPeriodDays === 0;
}

// ───────────── Receivables (§1) ─────────────

/** Days from completion to collection: round(mean × (1 − jitter + 2·jitter·u)), never negative. */
export function collectionDelay(collectionDaysMean: number, jitter: number, u: number): number {
  return Math.max(0, Math.round(collectionDaysMean * (1 - jitter + 2 * jitter * u)));
}

export function isBadDebt(badDebtRate: number, u: number): boolean {
  return u < badDebtRate;
}

// ───────────── Fixed assets (§5) ─────────────

/** max(salvage, price − (price − salvage) × min(1, age / life)). */
export function openingBookValue(
  purchasePrice: number,
  salvageValue: number,
  usefulLifeYears: number,
  ageYears: number,
): number {
  const frac = usefulLifeYears > 0 ? Math.min(1, ageYears / usefulLifeYears) : 1;
  return Math.max(salvageValue, purchasePrice - (purchasePrice - salvageValue) * frac);
}

/** Straight-line daily depreciation (price − salvage) / (life × 365); 0 if not meaningful. */
export function dailyDepreciation(purchasePrice: number, salvageValue: number, usefulLifeYears: number): number {
  if (!(usefulLifeYears > 0) || purchasePrice <= salvageValue) return 0;
  return (purchasePrice - salvageValue) / (usefulLifeYears * 365);
}

/** Depreciation actually booked today: truncated so book value lands exactly on salvage. */
export function depreciationForDay(bookValue: number, salvageValue: number, daily: number): number {
  if (bookValue <= salvageValue) return 0;
  return Math.min(daily, bookValue - salvageValue);
}

// ───────────── Loans (§5) ─────────────

/** Level annuity payment: B·r / (1 − (1 + r)^−n), r = annualRate/12; B/n when r = 0. */
export function loanPayment(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return principal;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export interface LoanStep {
  interest: number;
  principal: number;
  balance: number;
  monthsRemaining: number;
}

/**
 * One monthly payment. interest = balance × r; principal = min(balance, pmt − interest).
 * The final scheduled payment (monthsRemaining == 1) retires the whole balance so no float residue remains.
 */
export function loanMonthStep(balance: number, annualRate: number, payment: number, monthsRemaining: number): LoanStep {
  if (monthsRemaining <= 0 || balance <= 0) return { interest: 0, principal: 0, balance, monthsRemaining };
  const interest = (balance * annualRate) / 12;
  const principal = monthsRemaining === 1 ? balance : Math.min(balance, Math.max(0, payment - interest));
  return { interest, principal, balance: balance - principal, monthsRemaining: monthsRemaining - 1 };
}

// ───────────── Acquisitions (§6) ─────────────

export interface AcquisitionFlows {
  capex: number;
  assetAddition: number;
  newBorrowing: number;
  leaseDaily: number;
}

export function acquisitionFlows(
  method: 'cash' | 'loan' | 'lease',
  purchasePrice: number,
  downPaymentFraction: number,
  leaseMonthly: number,
): AcquisitionFlows {
  if (method === 'cash') return { capex: purchasePrice, assetAddition: purchasePrice, newBorrowing: 0, leaseDaily: 0 };
  if (method === 'loan') {
    const capex = purchasePrice * downPaymentFraction;
    return { capex, assetAddition: purchasePrice, newBorrowing: purchasePrice - capex, leaseDaily: 0 };
  }
  return { capex: 0, assetAddition: 0, newBorrowing: 0, leaseDaily: dailyFromMonthly(leaseMonthly) };
}

// ───────────── Direct costs (§3) ─────────────

/** (miles / mpg + equipmentGallons) × fuel price. */
export function fuelCost(vehicleMiles: number, mpg: number, equipmentGallons: number, fuelPricePerGallon: number): number {
  const vehicleGallons = mpg > 0 ? vehicleMiles / mpg : 0;
  return (vehicleGallons + equipmentGallons) * fuelPricePerGallon;
}

// ───────────── Line of credit (§7) ─────────────

export interface LocStep {
  interest: number;
  draw: number;
  repay: number;
  /** Cash after interest, draw and repayment. */
  cash: number;
  locBalance: number;
  shortfall: boolean;
}

/**
 * End-of-day line of credit. `cashBefore` is cash after all other movements of the day
 * (but before LOC interest). Interest accrues on the opening LOC balance.
 */
export function locStep(cashBefore: number, locBalance: number, limit: number, annualRate: number): LocStep {
  const interest = (locBalance * annualRate) / 365;
  let cash = cashBefore - interest;
  let draw = 0;
  let repay = 0;
  if (cash < 0) {
    draw = Math.max(0, Math.min(-cash, limit - locBalance));
  } else if (locBalance > 0) {
    repay = Math.min(locBalance, cash);
  }
  cash = cash + draw - repay;
  return { interest, draw, repay, cash, locBalance: locBalance + draw - repay, shortfall: cash < 0 };
}

// ───────────── Balance sheet (§8) ─────────────

export function availableCash(
  cash: number,
  accruedPayroll: number,
  minCashReserve: number,
  locLimit: number,
  locBalance: number,
): number {
  return cash - accruedPayroll - minCashReserve + (locLimit - locBalance);
}

export function equity(
  cash: number,
  ar: number,
  netFixedAssets: number,
  accruedPayroll: number,
  loanBalance: number,
  locBalance: number,
): number {
  return cash + ar + netFixedAssets - accruedPayroll - loanBalance - locBalance;
}

// ───────────── Disposal and owner distributions (digital-twin simulation-design §6) ─────────────

/** Default share of (book − salvage) recovered on sale when FinanceParams.resaleShareOfBookValue is missing. */
export const DEFAULT_RESALE_SHARE = 0.8;

/** Sale proceeds P = S + share × max(0, B − S). */
export function disposalProceeds(bookValue: number, salvageValue: number, resaleShare: number): number {
  return salvageValue + resaleShare * Math.max(0, bookValue - salvageValue);
}

/** Owner distribution D = max(0, cashBefore − X), and 0 while the line of credit has a balance. */
export function ownerDistribution(cashBefore: number, cashAbove: number, locBalance: number): number {
  if (locBalance > 0) return 0;
  return Math.max(0, cashBefore - cashAbove);
}
