import type { ParamMeta, Provenance } from '../../simulation/types';

type Unit = ParamMeta['unit'];

function meta(
  path: string,
  label: string,
  description: string,
  unit: Unit,
  min: number,
  max: number,
  step: number,
  provenance: Provenance,
): [string, ParamMeta] {
  return [path, { path, label, description, unit, min, max, step, provenance }];
}

const SYNTHETIC: Provenance = 'synthetic-demo';
const ASSUMPTION: Provenance = 'industry-assumption';

/**
 * Editable scalar parameters of the landscaping sample company, keyed by dot path.
 * Labels describe the synthetic demonstration company or illustrative assumptions;
 * none of them is a verified benchmark.
 */
export const landscapingParamMeta: Record<string, ParamMeta> = Object.fromEntries([
  // policies
  meta('policies.shiftHours', 'Shift length', 'Scheduled hours per crew workday before overtime.', 'hours', 4, 12, 0.5, SYNTHETIC),
  meta('policies.workDaysPerWeek', 'Workdays per week', 'Number of days per week the crews work (5 = Monday to Friday).', 'count', 1, 7, 1, SYNTHETIC),
  meta('policies.maxOvertimeHoursPerDay', 'Maximum overtime per day', 'How far a crew may run past the shift length on a day with work left to finish.', 'hours', 0, 4, 0.25, SYNTHETIC),
  meta('policies.minPaidHoursPerShift', 'Minimum paid hours per shift', 'Minimum hours paid to each present employee on a workday, even if the job finishes early.', 'hours', 0, 8, 0.5, SYNTHETIC),
  meta('policies.rainoutPaidHours', 'Paid hours on a rainout day', 'Hours paid to each employee on a full rainout day when the crew does no work.', 'hours', 0, 8, 0.5, SYNTHETIC),

  // market
  meta('market.organicLeadsPerMonth', 'Organic leads per month', 'Illustrative assumption for enquiries that arrive without paid marketing.', 'count', 0, 50, 1, ASSUMPTION),
  meta('market.marketingMonthlySpend', 'Marketing spend per month', 'Monthly budget for paid marketing in the demonstration company.', 'usd/month', 0, 5000, 50, SYNTHETIC),
  meta('market.marketingMaxLeadsPerMonth', 'Maximum paid leads per month', 'Illustrative assumption for the most extra leads per month that paid marketing could produce at unlimited spend.', 'count', 0, 60, 1, ASSUMPTION),
  meta('market.marketingSpendScale', 'Marketing spend scale', 'Illustrative assumption for the monthly spend at which paid marketing reaches about 63% of its maximum lead flow.', 'usd/month', 100, 10000, 50, ASSUMPTION),
  meta('market.baseConversionRate', 'Base lead conversion rate', 'Illustrative assumption for the share of leads that become customers at the current price level.', 'fraction', 0, 1, 0.01, ASSUMPTION),
  meta('market.acquisitionPriceElasticity', 'Acquisition price sensitivity', 'Illustrative assumption for how strongly conversion falls when prices rise.', 'elasticity', 0, 5, 0.1, ASSUMPTION),
  meta('market.baseMonthlyChurn', 'Base monthly churn', 'Illustrative assumption for the share of customers who leave in a typical month at the current price level.', 'fraction', 0, 0.2, 0.001, ASSUMPTION),
  meta('market.retentionPriceElasticity', 'Retention price sensitivity', 'Illustrative assumption for how strongly churn rises when prices rise.', 'elasticity', 0, 5, 0.1, ASSUMPTION),
  meta('market.priceIncreaseShockChurnPerPct', 'Churn shock per 1% price rise', 'Illustrative assumption for the one-time share of customers lost for each 1% price increase.', 'fraction', 0, 0.05, 0.001, ASSUMPTION),
  meta('market.serviceFailureChurnWeight', 'Churn weight of service failures', 'Illustrative assumption for how much recent missed or late service raises the churn rate.', 'multiplier', 0, 10, 0.1, ASSUMPTION),
  meta('market.serviceFailureHalfLifeDays', 'Service failure memory', 'Illustrative assumption for how many days it takes for a service failure to lose half of its effect on churn.', 'days', 1, 365, 1, ASSUMPTION),
  meta('market.newCustomer.serviceRadiusMiles', 'New customer service radius', 'Distance from the depot within which the company accepts new customers.', 'miles', 1, 25, 0.5, SYNTHETIC),
  meta('market.newCustomer.sizeFactorMin', 'Smallest new property size', 'Lowest size factor assumed for newly acquired properties, relative to a standard property.', 'multiplier', 0.2, 2, 0.05, ASSUMPTION),
  meta('market.newCustomer.sizeFactorMax', 'Largest new property size', 'Highest size factor assumed for newly acquired properties, relative to a standard property.', 'multiplier', 0.5, 4, 0.05, ASSUMPTION),

  // workforce
  meta('workforce.payrollBurdenRate', 'Payroll burden rate', 'Employer taxes, workers compensation and benefits as a share of gross wages (illustrative assumption).', 'fraction', 0, 0.6, 0.01, ASSUMPTION),
  meta('workforce.overtimeMultiplier', 'Overtime pay multiplier', 'Pay rate for hours above the weekly overtime threshold, as a multiple of the base wage (illustrative assumption).', 'multiplier', 1, 3, 0.05, ASSUMPTION),
  meta('workforce.overtimeWeeklyThresholdHours', 'Weekly overtime threshold', 'Paid hours in a week after which overtime pay applies.', 'hours', 0, 80, 1, ASSUMPTION),
  meta('workforce.absenceRate', 'Daily absence rate', 'Illustrative assumption for the chance that an employee is absent on a given workday.', 'fraction', 0, 0.3, 0.005, ASSUMPTION),
  meta('workforce.annualTurnoverRate', 'Annual staff turnover', 'Illustrative assumption for the share of the workforce that leaves in a year.', 'fraction', 0, 1.5, 0.01, ASSUMPTION),
  meta('workforce.timeToFillDays', 'Days to fill a vacancy', 'Illustrative assumption for how long a vacant position stays empty before a new hire starts.', 'days', 0, 180, 1, ASSUMPTION),
  meta('workforce.hiringCostPerHire', 'Cost per hire', 'Illustrative assumption for the one-time cost of recruiting and onboarding one employee.', 'usd', 0, 10000, 50, ASSUMPTION),
  meta('workforce.rampDays', 'Ramp-up period', 'Illustrative assumption for the days a new employee needs to reach full productivity.', 'days', 0, 365, 1, ASSUMPTION),
  meta('workforce.rampStartProductivity', 'Starting productivity of new hires', 'Illustrative assumption for the work rate of a new employee on the first day, as a share of full productivity.', 'fraction', 0, 1, 0.01, ASSUMPTION),
  meta('workforce.crewSizeCoordinationLoss', 'Crew size coordination loss', 'Illustrative assumption for the drop in every crew member work rate for each additional person on the crew.', 'fraction', 0, 0.5, 0.005, ASSUMPTION),
  meta('workforce.payPeriodDays', 'Pay period length', 'Number of days between payroll runs.', 'days', 1, 31, 1, SYNTHETIC),

  // weather
  meta('weather.partialDayFraction', 'Partial-day work window', 'Share of the shift during which weather-sensitive work may still start on a partly rained-out day (illustrative assumption).', 'fraction', 0, 1, 0.05, ASSUMPTION),

  // costs
  meta('costs.fuelPricePerGallon', 'Fuel price per gallon', 'Price paid for fuel for vehicles and equipment, in US dollars per gallon.', 'usd/gallon', 0, 10, 0.05, SYNTHETIC),
  meta('costs.avgSpeedMph', 'Average driving speed', 'Illustrative assumption for the average road speed between jobs.', 'mph', 5, 70, 1, ASSUMPTION),
  meta('costs.roadFactor', 'Road distance factor', 'Illustrative assumption for how much longer the road distance is than the straight-line distance.', 'multiplier', 1, 3, 0.05, ASSUMPTION),
  meta('costs.stopOverheadHours', 'Time lost per stop', 'Illustrative assumption for the unproductive time added at each stop for setup, unloading and reloading.', 'hours', 0, 2, 0.01, ASSUMPTION),

  // finance
  meta('finance.startingCash', 'Starting cash', 'Cash balance of the demonstration company on the first day of the simulation.', 'usd', 0, 1000000, 500, SYNTHETIC),
  meta('finance.minCashReserve', 'Minimum cash reserve', 'Cash the owner wants to keep untouched; it is not counted as available cash.', 'usd', 0, 200000, 500, SYNTHETIC),
  meta('finance.lineOfCredit.limit', 'Line of credit limit', 'Maximum amount the demonstration company can borrow on its line of credit.', 'usd', 0, 500000, 1000, SYNTHETIC),
  meta('finance.lineOfCredit.annualRate', 'Line of credit interest rate', 'Annual interest rate on amounts drawn from the line of credit.', 'fraction', 0, 0.5, 0.001, SYNTHETIC),
  meta('finance.ar.collectionDaysMean', 'Average days to collect', 'Average number of days between invoicing a customer and receiving payment.', 'days', 0, 120, 1, ASSUMPTION),
  meta('finance.ar.collectionDaysJitter', 'Collection timing variation', 'Relative spread of collection days around the average, as a fraction of the average (illustrative assumption).', 'fraction', 0, 1, 0.05, ASSUMPTION),
  meta('finance.ar.badDebtRate', 'Bad debt rate', 'Illustrative assumption for the share of billed revenue that is never collected.', 'fraction', 0, 0.2, 0.001, ASSUMPTION),
  meta('finance.newLoan.annualRate', 'Equipment loan interest rate', 'Annual interest rate for loans used to buy vehicles or equipment during the simulation (illustrative assumption).', 'fraction', 0, 0.5, 0.001, ASSUMPTION),
  meta('finance.newLoan.termMonths', 'Equipment loan term', 'Number of monthly payments in an equipment loan taken during the simulation (in months).', 'count', 1, 360, 1, ASSUMPTION),
  meta('finance.newLoan.downPaymentFraction', 'Equipment loan down payment', 'Share of the purchase price paid up front when an asset is bought with a loan (illustrative assumption).', 'fraction', 0, 1, 0.01, ASSUMPTION),

  // pricing
  meta('pricing.globalMultiplier', 'Global price multiplier', 'Scales every job price in the demonstration company; 1 keeps the current price list.', 'multiplier', 0.5, 2, 0.01, SYNTHETIC),
]);
