# Financial Model Specification

Status: **normative**. Implemented in `src/simulation/finance/` as small pure
functions plus a ledger. Each formula below must exist as an exported,
independently tested function. Pre-tax throughout (ADR-006).

The model keeps four things strictly apart: **revenue** (earned when a job is
completed), **profit** (revenue minus accrued expenses), **cash flow** (money
actually moving), and **available cash** (what the owner can safely spend).

## 1. Revenue and receivables

- Revenue is recognized on the day an order **completes**, at `order.price`. Split jobs earn nothing until completion.
- Each completed order becomes an invoice. Collection day =
  `completionDay + round(collectionDaysMean × (1 − jitter + 2 × jitter × u))` (COLLECTION).
  A delay of 0 collects the same day.
- With probability `badDebtRate` (BAD_DEBT) the invoice is uncollectible: on its
  collection day it is written off instead — AR decreases, `badDebt` expense increases, no cash.
- `AR_end = AR_start + revenue − collections − writeOffs`.

## 2. Labor

- Gross wages accrue daily: `wage × paidHours` per employee (hours per simulation-engine §7.4).
- **Overtime** is weekly: on each `dayOfWeek == 6` (and on the final day of the
  horizon for the partial week) for each employee
  `otHours = max(0, weekPaidHours − overtimeWeeklyThresholdHours)`,
  premium `= (overtimeMultiplier − 1) × wage × otHours`, added to `directLabor`
  that day; `otHours` is added to `ops.overtimeHours`. Employees who left mid-week are settled on that day too.
- `payrollBurden = payrollBurdenRate × directLabor` (same day).
- **Payroll cash**: wages + burden accumulate in `accruedPayroll`; on every day
  with `(day + 1) mod payPeriodDays == 0` the whole balance is paid (`payrollPaid`).
  Accrued payroll remaining at the horizon stays a liability.

## 3. Direct costs (expense and cash on the same day)

- Materials: `order.materials`, expensed on the day the order is first worked.
- Fuel: `(vehicleMiles / mpg + Σ onSiteClockHours_order × equipmentFuelGalPerHour_jobType) × fuelPricePerGallon`.
- Maintenance: `vehicleMiles × maintenanceCostPerMile + Σ equipmentHours × maintenanceCostPerHour + repair costs`.

## 4. Period costs

- Overhead: each item accrues and is paid daily, `monthlyAmount × 12 / 365`.
- Marketing: `marketingMonthlySpend × 12 / 365` daily.
- Leases (vehicles and equipment): `monthlyPayment × 12 / 365` daily → `equipmentLeases`.
- Hiring: `hiringCostPerHire` on the start day.

## 5. Fixed assets, depreciation, loans

- Opening book value of an owned/loan asset:
  `max(salvage, price − (price − salvage) × min(1, ageYears / usefulLifeYears))`.
- Daily depreciation: `(price − salvage) / (usefulLifeYears × 365)` while book value > salvage
  (the last day is truncated so book value lands exactly on salvage). Leased assets: none, not on the balance sheet.
- Loan payment (level annuity): `pmt = B × r / (1 − (1 + r)^(−n))`, `r = annualRate / 12`; `pmt = B / n` if `r = 0`.
  For opening loans `B = balance`, `n = monthsRemaining`.
- On each first-of-month day (`day > 0`) while `monthsRemaining > 0`:
  `interest = balance × r` (expense, `interestPaid`), `principal = min(balance, pmt − interest)`
  (`principalPaid`, balance decreases), `monthsRemaining −= 1`.

## 6. Acquisitions during a run

| Method | Day-of effects | Ongoing |
|---|---|---|
| `cash` | `capex = price`; fixed assets += price | depreciation |
| `loan` | `capex = price × downPaymentFraction` (cash); loan += the rest (non-cash, so `loanProceeds = 0`); fixed assets += price | depreciation, loan payments at `newLoan` terms starting next first-of-month |
| `lease` | none | `leaseMonthly × 12 / 365` daily |

New assets have `ageYears = 0`.

## 7. Line of credit (end of day, after all other cash movements)

1. Interest: `locBalance × annualRate / 365` → `interest` expense and `interestPaid` (cash).
2. If `cash < 0`: `draw = min(−cash, limit − locBalance)`.
3. Else if `locBalance > 0`: `repay = min(locBalance, cash)`.
4. If still `cash < 0`: `cashShortfall = true` (event with the amount). The run
   continues with negative cash so the user can see the size of the hole.

## 8. Statements

```
revenue
− directLabor − payrollBurden − materials − fuel − maintenance − equipmentLeases
= grossProfit
− overhead − marketing − hiringCosts − badDebt
= ebitda
− depreciation
= operatingProfit
− interest
= netProfit
```

```
netCashFlow = collections − payrollPaid − operatingCashOut − interestPaid
              − capex + loanProceeds − principalPaid + locDraw − locRepay
operatingCashOut = materials + fuel + maintenance + equipmentLeases + overhead + marketing + hiringCosts
```

```
availableCash = cash − accruedPayroll − minCashReserve + (loc.limit − locBalance)
equity        = cash + AR + netFixedAssets − accruedPayroll − loanBalance − locBalance
```

Opening balance sheet: `cash = startingCash`, `AR = 0`, `accruedPayroll = 0`,
`locBalance = 0`, fixed assets and loans from the asset list.

## 9. Accounting identities (must hold every day to 1e-6 relative)

1. `cash_t = cash_{t−1} + netCashFlow_t`
2. `AR_t = AR_{t−1} + revenue_t − collections_t − badDebt_t`
3. `accruedPayroll_t = accruedPayroll_{t−1} + directLabor_t + payrollBurden_t − payrollPaid_t`
4. `netFixedAssets_t = netFixedAssets_{t−1} + assetAdditions_t − depreciation_t`
5. `loanBalance_t = loanBalance_{t−1} + newBorrowing_t − principalPaid_t`
6. `locBalance_t = locBalance_{t−1} + locDraw_t − locRepay_t`
7. **`equity_t − equity_{t−1} = netProfit_t`** — the master check: it fails if any expense, receipt or accrual is double-counted or dropped.
8. Period summaries equal the sum of their days (flows) or the last day (balances).
9. The three subtotals in §8 recompute exactly from their lines.

## 10. What is and is not "verified"

The arithmetic above is verified by tests against independent hand
calculations. The **inputs** are not: wages, prices, churn, elasticities,
breakdown rates and weather in the sample company are synthetic or
illustrative assumptions and are labelled so in the UI (`ParamMeta.provenance`).
