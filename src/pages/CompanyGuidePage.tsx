import { useEffect, useRef, type ReactNode } from 'react';
import { CompanyTemplateButtons } from '@/components/CompanyFiles';
import { Button, Disclosure } from '@/components/ui';

type Field = [name: string, meaning: ReactNode];

function Fields({ title, rows }: { title: string; rows: Field[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <caption className="bg-sunken px-3 py-2 text-left font-semibold">{title}</caption>
        <thead className="sr-only"><tr><th scope="col">Field</th><th scope="col">What to enter</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map(([name, meaning]) => (
            <tr key={name} className="align-top">
              <th scope="row" className="w-2/5 px-3 py-2 font-normal wrap-anywhere"><code>{name}</code></th>
              <td className="px-3 py-2 text-muted wrap-anywhere">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SHARED_FIELDS: Field[] = [
  ['id', 'A unique, stable identifier within the list, such as crew-1. Use this exact value when another field refers to the record.'],
  ['name', 'The display name. Aliases work for employees and customer properties.'],
];

export function CompanyGuidePage({ onBack }: { onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <Button size="sm" onClick={onBack}>Back to simulator</Button>
      <header>
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold text-ink">Company file guide</h1>
        <p className="mt-1 text-sm text-muted">Start with <strong>Export company</strong> in the header and edit the downloaded JSON. Then choose <strong>Import company</strong> to check the file and review any errors, warnings and filled-in assumptions before loading it.</p>
      </header>
      <div className="space-y-2 rounded-lg border border-line bg-surface p-4 text-[13px] text-muted">
        <p>Use US dollars, miles and decimal rates such as <code>0.1</code> for 10%. Monthly lists have 12 entries, starting in January. Use empty lists for groups with no records and JSON <code>null</code> for an unassigned crew, vehicle or service plan.</p>
        <p>The JSON stores the company at the start of the simulation, including edited facts. It excludes planned and adopted decisions, rules, and hypothetical conditions. Files are read and saved locally in this browser.</p>
      </div>
      <Disclosure title="File format and company details" subtitle="Version, business name and starting month" defaultOpen>
        <div className="space-y-3">
          <Fields title="File" rows={[
            ['version', 'Set to 1 for this file format.'],
            ['company', 'The company object. Put the company fields and lists below inside this object.'],
            ['assumedPaths', 'Optional export metadata listing fields filled with illustrative defaults. Remove the corresponding path when you replace a default with your own figure.'],
          ]} />
          <Fields title="Company" rows={[
            ['industryId', 'Use landscaping for this industry.'],
            ['name', 'The business name shown in the simulator.'],
            ['startMonth', 'Number the months from 0 for January through 11 for December. The simulation starts on the first day of that month and treats it as a Monday.'],
            ['jobTypes, crews, vehicles, equipment', 'Include each list. Use [] when the company has none.'],
            ['customers, employees', 'Include each list or supply its CSV at import.'],
            ['finance.startingCash', 'Enter the opening balance in dollars.'],
          ]} />
          <p className="text-[13px] text-muted">Omitted operating and finance settings use illustrative industry assumptions. Marketing spend, cash reserve and credit limit default to zero. Overhead and the new-customer service mix default to empty lists or maps. The import review and Business → Assumptions list the defaulted fields.</p>
        </div>
      </Disclosure>
      <Disclosure title="Customers and employees" subtitle="JSON fields and downloadable CSV templates">
        <div className="space-y-3">
          <p className="text-[13px] text-muted">Each optional CSV replaces its entire JSON list. Keep the template header and replace any example data. Leave an unassigned crew or recurring plan blank. Give a number as plain digits with a decimal point if needed, and quote values that contain commas.</p>
          <CompanyTemplateButtons />
          <Fields title="Customers" rows={[
            ...SHARED_FIELDS,
            ['x, y', 'Property location in miles from your depot. Use negative values for west or south and positive values for east or north.'],
            ['sizeFactor', 'Relative job size. A property at 2 uses twice the standard workload, price and materials. Default 1.'],
            ['recurringJobTypeId', 'The ID of a recurring service, or null for no recurring plan.'],
            ['phase', 'Progress toward the first visit at the start of the simulation, from 0 up to but excluding 1. Use different values to stagger visits. Default 0.'],
          ]} />
          <Fields title="Employees" rows={[
            ...SHARED_FIELDS,
            ['hourlyWage', 'Regular base pay per hour, before employer costs and overtime.'],
            ['skill', 'Use 1 for a crew member, 2 for experienced and 3 for a lead or specialist.'],
            ['productivity', 'Work-rate multiplier after training. Use 1 for the standard rate. Default 1.'],
            ['crewId', 'The assigned crew’s ID or null for an unassigned employee.'],
            ['tenureDays', 'Days already employed at the simulation start.'],
          ]} />
        </div>
      </Disclosure>
      <Disclosure title="Crews, vehicles and equipment" subtitle="Assignments, maintenance and financing">
        <div className="space-y-3">
          <Fields title="Crews" rows={[
            ...SHARED_FIELDS,
            ['vehicleId', 'The crew’s assigned vehicle ID or null. Crews without their vehicle may borrow a spare.'],
          ]} />
          <Fields title="Vehicles" rows={[
            ...SHARED_FIELDS,
            ['seats, mpg', 'People the vehicle can carry and its fuel economy in miles per gallon.'],
            ['maintenanceCostPerMile', 'Routine upkeep per road mile in dollars.'],
            ['asset', 'The purchase and financing details below.'],
          ]} />
          <Fields title="Equipment" rows={[
            ...SHARED_FIELDS,
            ['equipmentTypeId', 'A type ID, such as mower. Match this to the type in a service’s requiredEquipmentTypes.'],
            ['crewId', 'The crew that carries this item, or null if it is a spare.'],
            ['maintenanceCostPerHour', 'Routine upkeep per hour of use in dollars.'],
            ['asset', 'The purchase and financing details below.'],
          ]} />
          <Fields title="Asset" rows={[
            ['purchasePrice, salvageValue', 'What the asset cost and what it is expected to be worth at the end of its useful life.'],
            ['usefulLifeYears, ageYears', 'Expected years in service and age at simulation start.'],
            ['financing.kind', 'Use owned, loan, or lease.'],
            ['financing.balance, annualRate, monthsRemaining', 'For a loan, the principal still owed, annual interest rate, and payments remaining in months.'],
            ['financing.monthlyPayment', 'For a lease, the monthly amount due.'],
          ]} />
        </div>
      </Disclosure>
      <Disclosure title="Services, prices and scheduling" subtitle="Job types, service plans and crew policies">
        <div className="space-y-3">
          <Fields title="Job types" rows={[
            ...SHARED_FIELDS,
            ['kind', 'Use recurring for regular visits or one-off for work ordered as needed.'],
            ['standardLaborHours', 'Person-hours on site at standard speed and property size.'],
            ['basePrice, materialCost', 'Price charged and materials used in dollars for a standard job.'],
            ['equipmentFuelGalPerHour', 'Gallons of equipment fuel used per crew-hour on site.'],
            ['requiredEquipmentTypes', 'Every equipment type ID that the crew needs working. Use [] when none are required.'],
            ['minSkill, minCrewSize', 'The minimum skill at least one worker must have and the minimum number of workers needed.'],
            ['weatherSensitive, splittable', 'Whether rain restricts this work and whether it can be finished over several days. Use true or false.'],
            ['seasonality', 'Twelve monthly demand multipliers. Use 1 for normal demand or 0 for a pause.'],
            ['intervalDays', 'For recurring work, days between visits at normal demand. The interval and seasonality must imply at most 100 visits per customer per day.'],
            ['annualRatePerCustomer', 'For one-off work, expected jobs per customer per year at normal demand.'],
            ['lateAfterDays, cancelAfterDays', 'Days from order creation to the late and cancellation cutoffs.'],
            ['offered', 'Use true to allow new orders for this service.'],
          ]} />
          <Fields title="Pricing" rows={[
            ['globalMultiplier', 'Multiplier on every base price. Use 1 for no adjustment.'],
            ['byJobType', 'Map from service ID to an additional multiplier. Services left out use 1.'],
          ]} />
          <Fields title="Policies" rows={[
            ['shiftHours, workDaysPerWeek', 'Normal daily shift and weekly schedule. A weekly schedule of 5 runs Monday to Friday, 6 adds Saturday and 7 runs every day.'],
            ['maxOvertimeHoursPerDay', 'Extra hours the crew may work to fit in jobs.'],
            ['minPaidHoursPerShift, rainoutPaidHours', 'Minimum paid hours on a regular shift and paid hours on a full rainout.'],
            ['routing', 'Use fifo for oldest jobs first, nearest for closest next stop, or zoned to group by area.'],
            ['autoBackfill, acceptNewCustomers, floatIdleWorkers', 'Use true or false to replace workers who quit, accept new customers, or lend idle workers to other crews, respectively. Floating is optional.'],
          ]} />
        </div>
      </Disclosure>
      <Disclosure title="Money and operating assumptions" subtitle="Finance, demand, workforce, weather, reliability and costs">
        <div className="space-y-3">
          <Fields title="Finance" rows={[
            ['startingCash, minCashReserve', 'Cash on day 0 and the amount you want to hold in reserve. Starting cash is required.'],
            ['lineOfCredit.limit, lineOfCredit.annualRate', 'Maximum credit available and annual interest rate.'],
            ['ar.collectionDaysMean, ar.collectionDaysJitter, ar.badDebtRate', 'Average days to get paid, fractional spread around that delay and share of revenue that goes uncollected.'],
            ['newLoan.annualRate, newLoan.termMonths, newLoan.downPaymentFraction', 'Interest rate, months to repay and share paid upfront on new purchases.'],
            ['resaleShareOfBookValue, ownerDistributionCashAbove', 'Optional. Share of remaining book value above salvage recovered on sale, and cash threshold above which the owner takes monthly distributions.'],
          ]} />
          <Fields title="Market" rows={[
            ['organicLeadsPerMonth, leadSeasonality', 'Monthly inquiries without paid marketing and monthly multipliers for all inquiries.'],
            ['marketingMonthlySpend, marketingMaxLeadsPerMonth, marketingSpendScale', 'Advertising budget, upper limit on additional monthly leads, and spend that yields roughly 63% of that limit.'],
            ['baseConversionRate, acquisitionPriceElasticity', 'Share of inquiries that become customers at base prices and how strongly that share falls as prices rise.'],
            ['baseMonthlyChurn, retentionPriceElasticity, oneOffPriceElasticity', 'Monthly share of recurring customers lost and how strongly higher prices raise customer loss or reduce one-off demand. The one-off response is optional.'],
            ['priceIncreaseShockChurnPerPct', 'One-time chance of losing a customer for each percentage point of price increase.'],
            ['serviceFailureChurnWeight, serviceFailureHalfLifeDays', 'How much missed or late jobs increase churn, and days for the effect to halve.'],
            ['newCustomer.serviceRadiusMiles, newCustomer.sizeFactorMin, newCustomer.sizeFactorMax', 'Service-area radius and the smallest and largest relative sizes for newly acquired properties.'],
            ['newCustomer.recurringJobTypeMix', 'Map of recurring job type IDs to relative weights for assigning plans to new customers.'],
            ['referralsPerCustomerYear, marketSize, newCustomerChurnBoost', 'Optional. Referrals per customer at perfect service, number of potential accounts, and extra customer loss early in the relationship.'],
          ]} />
          <Fields title="Workforce" rows={[
            ['payrollBurdenRate, overtimeMultiplier, overtimeWeeklyThresholdHours', 'Employer costs as a share of wages, overtime pay multiplier and weekly hours before overtime starts.'],
            ['absenceRate, annualTurnoverRate', 'Chance of a workday absence and annual employee turnover.'],
            ['timeToFillDays, hiringCostPerHire', 'Days to fill a vacancy and cost of each hire.'],
            ['rampDays, rampStartProductivity', 'Days to reach full speed and starting fraction of full productivity.'],
            ['crewSizeCoordinationLoss, payPeriodDays', 'Productivity loss per additional crew member and days between paydays.'],
            ['learningGain, learningDays', 'Optional. Long-term speed gain from experience and days to reach about 63% of that gain.'],
            ['fatigueThresholdHours, quitFatigueWeight, absenceFatigueWeight, productivityFatigueLoss', 'Optional. Weekly hours above which crews accumulate fatigue, then how fatigue changes quits, absences and work speed.'],
            ['wageQuitElasticity, marketWageBySkill', 'Optional. How strongly quits respond to pay relative to reference wages. Provide reference wages at array positions 1 through 3 for the corresponding skill levels when using this setting.'],
            ['earlyTenureQuitBoost, annualRaiseRate', 'Optional. Extra risk of quitting soon after hire and annual wage increases.'],
          ]} />
          <Fields title="Reliability (vehicle and equipment)" rows={[
            ['dailyProb, ageFactorPerYear', 'Chance of a breakdown on a workday for a new asset and how much that risk grows each year.'],
            ['repairDaysMin, repairDaysMax, repairCostMin, repairCostMax', 'Lower and upper limits for breakdown downtime and cost.'],
            ['maintenanceAgeFactorPerYear', 'Optional. How much routine upkeep rises per year of asset age.'],
          ]} />
          <Fields title="Weather" rows={[
            ['rainoutProbByMonth, partialProbByMonth', 'Twelve chances of a full rainout and twelve chances of a shorter work window, one per month.'],
            ['partialDayFraction', 'Share of the shift during which crews can start weather-sensitive jobs on a partial day.'],
          ]} />
          <Fields title="Costs" rows={[
            ['fuelPricePerGallon, avgSpeedMph, roadFactor', 'Fuel price, driving speed, and multiplier that converts straight-line miles to road miles.'],
            ['stopOverheadHours', 'Hours spent parking, unloading and packing up at each stop.'],
            ['overhead[].id, overhead[].name, overhead[].monthlyAmount', 'Unique code, label and monthly cost for each fixed expense, such as rent or administrative payroll.'],
          ]} />
        </div>
      </Disclosure>
    </article>
  );
}
