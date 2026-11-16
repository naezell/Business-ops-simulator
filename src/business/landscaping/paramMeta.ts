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
  meta('market.oneOffPriceElasticity', 'One-off job price sensitivity', 'Illustrative assumption for how strongly requests for one-off jobs fall when their price rises.', 'elasticity', 0, 5, 0.1, ASSUMPTION),
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

  // reliability: vehicles
  meta('reliability.vehicle.dailyProb', 'Vehicle breakdown chance per workday', 'Illustrative assumption for the chance that a new vehicle breaks down on a given workday.', 'fraction', 0, 0.05, 0.0005, ASSUMPTION),
  meta('reliability.vehicle.ageFactorPerYear', 'Vehicle age effect on breakdowns', 'Illustrative assumption for how much each year of vehicle age raises the breakdown chance (a multiplier of 1 plus this value times age in years).', 'multiplier', 0, 2, 0.05, ASSUMPTION),
  meta('reliability.vehicle.repairDaysMin', 'Shortest vehicle repair', 'Illustrative assumption for the fewest days a vehicle is out of service after a breakdown.', 'days', 0, 30, 1, ASSUMPTION),
  meta('reliability.vehicle.repairDaysMax', 'Longest vehicle repair', 'Illustrative assumption for the most days a vehicle is out of service after a breakdown.', 'days', 0, 60, 1, ASSUMPTION),
  meta('reliability.vehicle.repairCostMin', 'Lowest vehicle repair cost', 'Illustrative assumption for the smallest repair bill for a vehicle breakdown, in US dollars.', 'usd', 0, 20000, 10, ASSUMPTION),
  meta('reliability.vehicle.repairCostMax', 'Highest vehicle repair cost', 'Illustrative assumption for the largest repair bill for a vehicle breakdown, in US dollars.', 'usd', 0, 50000, 10, ASSUMPTION),

  // reliability: equipment
  meta('reliability.equipment.dailyProb', 'Equipment breakdown chance per workday', 'Illustrative assumption for the chance that a new piece of equipment breaks down on a given workday.', 'fraction', 0, 0.05, 0.0005, ASSUMPTION),
  meta('reliability.equipment.ageFactorPerYear', 'Equipment age effect on breakdowns', 'Illustrative assumption for how much each year of equipment age raises the breakdown chance (a multiplier of 1 plus this value times age in years).', 'multiplier', 0, 2, 0.05, ASSUMPTION),
  meta('reliability.equipment.repairDaysMin', 'Shortest equipment repair', 'Illustrative assumption for the fewest days a piece of equipment is out of service after a breakdown.', 'days', 0, 30, 1, ASSUMPTION),
  meta('reliability.equipment.repairDaysMax', 'Longest equipment repair', 'Illustrative assumption for the most days a piece of equipment is out of service after a breakdown.', 'days', 0, 60, 1, ASSUMPTION),
  meta('reliability.equipment.repairCostMin', 'Lowest equipment repair cost', 'Illustrative assumption for the smallest repair bill for an equipment breakdown, in US dollars.', 'usd', 0, 20000, 10, ASSUMPTION),
  meta('reliability.equipment.repairCostMax', 'Highest equipment repair cost', 'Illustrative assumption for the largest repair bill for an equipment breakdown, in US dollars.', 'usd', 0, 50000, 10, ASSUMPTION),

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

  // digital twin: workforce dynamics (optional; off when absent from the company)
  meta('workforce.learningGain', 'Productivity gain from experience', 'Illustrative assumption for the extra work rate an employee gains with long tenure. 0.15 means at most 15% more productive than a new hire, reached gradually.', 'fraction', 0, 0.5, 0.01, ASSUMPTION),
  meta('workforce.learningDays', 'Learning time constant', 'Illustrative assumption for the tenure, in days, at which about 63% of the experience gain has been reached.', 'days', 0, 365, 1, ASSUMPTION),
  meta('workforce.fatigueThresholdHours', 'Fatigue threshold', 'Illustrative assumption for the trailing 28-day average of weekly paid hours above which fatigue starts to build. Fatigue rises by 1 for every 10 weekly hours above this threshold.', 'hours', 0, 80, 1, ASSUMPTION),
  meta('workforce.quitFatigueWeight', 'Quit sensitivity to fatigue', 'Illustrative assumption for how strongly fatigue raises the chance that an employee quits. 1 means fatigue of 1 doubles the base quit chance.', 'multiplier', 0, 5, 0.1, ASSUMPTION),
  meta('workforce.absenceFatigueWeight', 'Absence sensitivity to fatigue', 'Illustrative assumption for how strongly fatigue raises the chance that an employee is absent on a workday.', 'multiplier', 0, 5, 0.1, ASSUMPTION),
  meta('workforce.productivityFatigueLoss', 'Productivity loss from fatigue', 'Illustrative assumption for the share of work rate lost per unit of fatigue. Work rate never falls below 70% of normal.', 'multiplier', 0, 1, 0.01, ASSUMPTION),
  meta('workforce.wageQuitElasticity', 'Wage sensitivity of quits', 'Illustrative assumption for how strongly quits fall when an employee is paid above the market wage for their skill level.', 'elasticity', 0, 5, 0.1, ASSUMPTION),
  meta('workforce.marketWageBySkill.1', 'Market wage, skill level 1', 'Illustrative assumption for the hourly wage that skill level 1 could earn elsewhere. Used to judge whether pay keeps staff.', 'usd/hour', 10, 40, 0.5, ASSUMPTION),
  meta('workforce.marketWageBySkill.2', 'Market wage, skill level 2', 'Illustrative assumption for the hourly wage that skill level 2 could earn elsewhere. Used to judge whether pay keeps staff.', 'usd/hour', 10, 40, 0.5, ASSUMPTION),
  meta('workforce.marketWageBySkill.3', 'Market wage, skill level 3', 'Illustrative assumption for the hourly wage that skill level 3 could earn elsewhere. Used to judge whether pay keeps staff.', 'usd/hour', 10, 40, 0.5, ASSUMPTION),
  meta('workforce.earlyTenureQuitBoost', 'Early-tenure quit boost', 'Illustrative assumption for the extra quit chance in an employee first months. The extra chance fades with tenure.', 'multiplier', 0, 5, 0.1, ASSUMPTION),
  meta('workforce.annualRaiseRate', 'Annual raise rate', 'Illustrative assumption for the yearly pay increase applied to every active employee.', 'fraction', 0, 0.2, 0.005, ASSUMPTION),

  // digital twin: customer dynamics
  meta('market.referralsPerCustomerYear', 'Referrals per customer per year', 'Illustrative assumption for the extra enquiries each active customer brings in a year at perfect service.', 'count', 0, 2, 0.01, ASSUMPTION),
  meta('market.marketSize', 'Addressable customers', 'Illustrative assumption for the number of properties in the service area. New enquiries fall to zero as the active customer base reaches this number.', 'count', 1, 10000, 1, ASSUMPTION),
  meta('market.newCustomerChurnBoost', 'New-customer churn boost', 'Illustrative assumption for the extra churn of customers in their first months. The extra churn fades with tenure.', 'multiplier', 0, 10, 0.1, ASSUMPTION),

  // digital twin: asset aging
  meta('reliability.vehicle.maintenanceAgeFactorPerYear', 'Vehicle upkeep growth per year of age', 'Illustrative assumption for how much each year of vehicle age raises routine maintenance cost. The cost is multiplied by 1 plus this value times the age in years.', 'multiplier', 0, 1, 0.01, ASSUMPTION),
  meta('reliability.equipment.maintenanceAgeFactorPerYear', 'Equipment upkeep growth per year of age', 'Illustrative assumption for how much each year of equipment age raises routine maintenance cost. The cost is multiplied by 1 plus this value times the age in years.', 'multiplier', 0, 1, 0.01, ASSUMPTION),

  // digital twin: finance dynamics
  meta('finance.resaleShareOfBookValue', 'Resale share of book value', 'Illustrative assumption for the share of the amount above salvage value (book value minus salvage) that is recovered when an asset is sold.', 'fraction', 0, 1, 0.01, ASSUMPTION),
]);
