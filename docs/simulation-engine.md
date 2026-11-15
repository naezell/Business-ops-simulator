# Simulation Engine Specification

Status: **normative**. The engine in `src/simulation/` must implement exactly
this. Types are in `src/simulation/types.ts`; money rules are in
`financial-model.md`. If code and this document disagree, the document wins
until an ADR changes it.

## 1. Shape

- Pure function: `runSimulation(scenario, options) → SimulationResult`. No I/O,
  no `Date`, no `Math.random`, no globals. Same input ⇒ bit-identical output.
- Discrete daily time step, `day = 0 … horizonDays−1`.
- Job-level: every visit/job is an individual order that a specific crew
  travels to and works on. Aggregates are sums of those events, never formulas
  applied to averages.
- The input scenario is never mutated (deep-copy on init).

## 2. Calendar

- Year = 365 days, no leap years, month lengths 31,28,31,30,31,30,31,31,30,31,30,31.
- Day 0 is the 1st of `company.startMonth` and is a **Monday**. `dayOfWeek = day mod 7` (0 = Mon).
- Workday ⇔ `dayOfWeek < policies.workDaysPerWeek`.
- "First of month" days (`dayOfMonth == 1`, `day > 0`) trigger loan payments.
- Monthly summaries follow calendar months; a horizon may end mid-month.

## 3. Randomness (ADR-003)

Counter-based, never sequential:

```
u = rand01(seed, stream, entityKey, day, index)   ∈ [0, 1)
```

- `stream` is a fixed integer per purpose: WEATHER, ABSENCE, QUIT,
  VEHICLE_BREAKDOWN, EQUIPMENT_BREAKDOWN, REPAIR, ONEOFF_DEMAND, LEADS,
  CONVERSION, NEW_CUSTOMER, CHURN, PRICE_SHOCK, COLLECTION, BAD_DEBT.
- `entityKey` is a 32-bit hash (FNV-1a) of the entity's string id (0 for global draws).
- Implementation: 32-bit integer mixing (murmur3-style `mix` + `fmix` via
  `Math.imul`), result `>>> 0` divided by 2³².
- Consequence (required, tested): changing one part of a scenario does not
  change the draws of unrelated entities. Two scenarios with the same seed see
  the same weather, the same absences for the same employees, the same
  breakdown days for the same vehicles. This is what makes before/after
  comparisons low-noise (common random numbers).
- Ids of entities created during a run are deterministic: new customers
  `c-d{day}-{k}`, backfill hires `{quitterId}~{n}`, action hires
  `h-d{day}-{actionIndex}-{k}`, acquired assets `a-d{day}-{actionIndex}-{k}`,
  new crews `crew-d{day}-{actionIndex}`.

Setting every stochastic rate to 0 (absence, turnover, breakdown, weather,
churn, leads, one-off rates, collection jitter, bad debt) must yield a fully
hand-computable run. The benchmark tests depend on this.

## 4. Daily order of operations

Each day executes these steps in this order. Order is part of the spec.

1. **Actions** — apply `PlannedAction`s with `action.day == day` in array order (§10).
2. **Weather** — one draw `u` (WEATHER, key 0): `u < rainout[m]` ⇒ rainout;
   else `u < rainout[m] + partial[m]` ⇒ partial; else clear.
3. **Workforce events** (every day):
   - Requisitions whose fill day has arrived become hires (§8).
   - Each active employee quits with daily hazard `1 − (1 − annualTurnoverRate)^(1/365)` (QUIT).
4. **Asset events** (workdays only): assets whose `downUntil ≤ day` return to
   service. Each in-service, not-down vehicle and equipment item breaks down
   with probability `min(1, dailyProb × (1 + ageFactorPerYear × ageNow))`,
   `ageNow = ageYears + day/365` (§9).
5. **Demand** (every day): recurring visit accrual, one-off arrivals, leads and
   conversions, churn (§5). Then cancel pending orders with
   `day − createdDay ≥ cancelAfterDays` (§5.5).
6. **Dispatch** (workdays only): absences, crew deployment, routing, work (§6, §7).
7. **Unserved attribution** (workdays only) (§7.5).
8. **Finance**: accruals, weekly overtime, payroll, collections, write-offs,
   loans, depreciation, line of credit, balances (see `financial-model.md`).
9. **Record** the `DailyRecord` (and logs when `detail = 'full'`).

## 5. Demand

Let `m` be the month, `P_j = pricing.globalMultiplier × (pricing.byJobType[j] ?? 1)`
the price multiplier of job type `j`.

**Price index** of the company as seen by the market:
`priceIndex = Σ_j w_j P_j / Σ_j w_j` over offered recurring job types, weighted by
`w_j` = number of active customers on plan `j` (if no such customers: plain mean over
offered job types; if none offered: 1).

### 5.1 Recurring visits

Each active customer with plan `j` (offered) carries `accrual` (initially `phase`).
Each day: `accrual += seasonality_j[m] / intervalDays_j`. While `accrual ≥ 1`:
create one order and `accrual −= 1`. With seasonality 1 and interval 7 a
customer generates exactly one visit every 7 days.

### 5.2 One-off jobs

For each active customer and each offered one-off job type `j`:
one draw (ONEOFF_DEMAND, key = hash(customerId + ':' + j)); create an order if
`u < annualRatePerCustomer_j × seasonality_j[m] / 365 × P_j^(−oneOffPriceElasticity)`
(`oneOffPriceElasticity` missing ⇒ 0 ⇒ factor 1; `P_j ≤ 0` ⇒ factor 1). The same draw `u` is used
at every price, so raising a price can only remove orders, never reshuffle them (ADR-008).

### 5.3 Orders

`order.price = basePrice × sizeFactor × P_j` (fixed at creation),
`laborHours = standardLaborHours × sizeFactor`, `materials = materialCost × sizeFactor`,
`createdDay = day`, status `pending`. Order ids: `{customerId}:{jobTypeId}:{day}:{n}`.

### 5.4 Acquisition and churn

- Leads: `λ = (organic + mktMax × (1 − exp(−spend / spendScale))) × leadSeasonality[m] / 30`
  (the marketing term is 0 when `spendScale ≤ 0`). Daily lead count ~ Poisson(λ)
  by inverse transform from one draw (LEADS, key 0).
- Each lead `k` converts if `policies.acceptNewCustomers` and
  `u_k < clamp(baseConversionRate × priceIndex^(−acquisitionPriceElasticity), 0, 1)` (CONVERSION, index k).
- A new customer gets (NEW_CUSTOMER, key 0, indices 4k…4k+3): position uniform
  in the disc of radius `serviceRadiusMiles` (`r = R√u₁, θ = 2πu₂`), `sizeFactor`
  uniform in `[min, max]`, plan drawn from `recurringJobTypeMix` (restricted to
  offered types), `phase = 0`. First visit therefore arrives one interval later.
- Churn: each active customer, daily hazard `h = 1 − (1 − c)^(1/30)` with
  `c = clamp(baseMonthlyChurn × priceIndex^retentionPriceElasticity × (1 + serviceFailureChurnWeight × failureScore), 0, 0.5)` (CHURN).
- `failureScore` decays daily by `0.5^(1/halfLife)`; `+1` when one of the
  customer's orders is cancelled, `+0.5` when one completes late.
- Price shock: when a `set-price` action raises `P_j` by fraction `δ > 0`, every
  active customer on plan `j` (for `'all'`: every customer) churns immediately
  with probability `min(0.9, priceIncreaseShockChurnPerPct × 100δ)` (PRICE_SHOCK).
- On churn the customer's pending orders are cancelled **without** counting as
  missed jobs or lost revenue.

### 5.5 Cancellation and lateness

Pending or in-progress orders reaching `cancelAfterDays` are cancelled: counts
in `jobsCancelled`, price added to `lostRevenue`, customer `failureScore += 1`.
Labor already spent on a cancelled split job stays spent; no revenue. An order
completing on a day `> createdDay + lateAfterDays` is late (`jobsLate`,
`failureScore += 0.5`) but pays in full.

## 6. Crews and deployment (workdays)

For each crew, in config order:

1. **Members present** = active employees on the crew not absent. Absence: one
   draw per employee per workday, absent if `u < absenceRate` (ABSENCE). Absent
   employees are unpaid.
2. **Vehicle** = the assigned vehicle if working; else the first (config order)
   working vehicle not assigned to any crew and not already borrowed today;
   else the crew does not deploy (`vehicle`).
3. **Deployed members** = the present members, highest skill first (ties: config
   order), capped at `vehicle.seats`. None present ⇒ not deployed (`understaffed`).
   Present members beyond the seat cap are paid the minimum shift (§7.4) and counted idle.
4. **Kit** = working equipment assigned to the crew. For each equipment type the
   crew owns but currently has no working item of, borrow the first working
   unassigned item of that type not already borrowed today.
5. **Crew rate** (standard person-hours per clock hour):
   `rate = (Σ_i productivity_i × ramp_i) × max(0.5, 1 − coordinationLoss × (n − 1))`,
   `ramp_i = min(1, rampStart + (1 − rampStart) × tenureNow_i / rampDays)` (1 if `rampDays ≤ 0`).

A crew is **eligible** for an order iff: all `requiredEquipmentTypes` are in its
kit; some deployed member has `skill ≥ minSkill`; `n ≥ minCrewSize`; and, if the
job type is weather-sensitive, the weather rule (§7.2) allows it.

## 7. Dispatch

### 7.1 Clock and fit

Each deployed crew has a clock starting at 0 at the depot `(0,0)`, limit
`L = shiftHours + maxOvertimeHoursPerDay`.
`travel(a,b) = dist(a,b) × roadFactor / avgSpeedMph`. For an order at `p` with
remaining standard labor `R`, from current position `q`:

- `tIn = travel(q,p) + stopOverheadHours`, `tBack = travel(p, depot)`, `D = R / rate`.
- **Fits fully** iff `clock + tIn + D + tBack ≤ L` ⇒ work it, complete it.
- Else, if `splittable` and `A = L − clock − tIn − tBack ≥ 0.5`: work `A` clock
  hours (`R −= A × rate`), status `in-progress`, and the crew's day ends.
- Else the order does not fit this crew now.

### 7.2 Weather rule

Weather-sensitive orders cannot be started on a rainout. On a partial day they
can only be **started** while `clock + tIn ≤ partialDayFraction × shiftHours`.

### 7.3 Loop and routing policy

Repeat: take the open crew with the smallest clock (ties: config order). It
selects one order from the pool of pending/in-progress orders it is eligible for
and that fit (fully or as a split):

- `fifo` — the first in priority order `(createdDay asc, id asc)`.
- `nearest` — if any candidate is **urgent** (`createdDay + cancelAfterDays − day ≤ 1`),
  the nearest urgent one; otherwise the nearest. Nearest = smallest `tIn` (ties: priority order).
- `zoned` — before the loop, sort today's pool by polar angle around the depot
  and cut it into `K` contiguous sectors of approximately equal total remaining
  labor (`K` = deployed crews); crew `i` owns sector `i`. Selection is `nearest`
  restricted to the crew's own sector; when that yields nothing, `nearest` over
  the whole pool.

No candidate ⇒ the crew closes, drives back, `endClock = clock + travel(pos, depot)`.
A crew that never took an order is recorded as not deployed with reason
`no-work` (or `weather` on a rainout) and `endClock = 0`.

### 7.4 Hours

Per deployed member: `worked = endClock`; `paid = max(worked, minPaidHoursPerShift)`.
Present members of a crew that did not deploy (any reason) are paid
`minPaidHoursPerShift`, except on a rainout with no work done, where they are
paid `rainoutPaidHours`. Person-hours: `onSite = n × Σ D`, `travel = n × Σ(tIn) + n × final tBack`,
`idle = paid − onSite − travel`. Employees with no crew are paid `minPaidHoursPerShift`
on workdays (idle). Non-workdays: nobody is paid.

Vehicle miles = total road miles of the route. Each equipment item of a required
type in the kit accrues the on-site clock hours of the orders that required its type.

### 7.5 Unserved attribution

At the end of a workday every order still pending/in-progress that was created
on or before that day contributes its remaining standard labor to exactly one
`unservedHoursByReason` bucket, first match wins:

1. `weather` — weather-sensitive and today was a rainout (or partial and no crew could start it under §7.2).
2. `no-crew` — the company has no crews.
3. `vehicle` — no crew deployed and at least one failed for lack of a vehicle.
4. `crew-size` — no crew deployed (understaffed), or every deployed crew failed `minCrewSize`.
5. `equipment` — no deployed crew had the required working equipment.
6. `skill` — no deployed crew met `minSkill`.
7. `capacity` — some crew was eligible but had no time.

## 8. Hiring and turnover

- Quit ⇒ employee leaves immediately (event). If `autoBackfill`, a requisition
  with the same wage/skill/productivity/crew fills `timeToFillDays` later.
- Any hire (backfill or action): `hiringCostPerHire` expensed and paid on the
  start day; `tenureDays = 0`.
- `hire-employee` actions start the employee the same day (the user is modelling
  "what if I had this person"); the ramp still applies.

## 9. Breakdowns

On breakdown: `downDays` = integer uniform in `[repairDaysMin, repairDaysMax]`,
`cost` uniform in `[repairCostMin, repairCostMax]` (REPAIR, indices 0 and 1);
the asset is unavailable for days `day … day + downDays − 1`; cost is a
maintenance expense paid that day. Leased assets break down the same way.

## 10. Actions

Applied at the start of their day; each emits `action-applied` or
`action-rejected` (the run continues). Rejections: unknown ids, removing a
non-existent entity, hiring into a missing crew.

| Action | Effect |
|---|---|
| `hire-employee` | Add employee to crew (§8). |
| `remove-employee` | Employee leaves; no backfill; no severance. |
| `add-crew` | Create crew, acquire vehicle + equipment for it, hire members. |
| `remove-crew` | Members leave (no backfill); its vehicle and equipment become unassigned spares and keep costing money. |
| `acquire-vehicle` / `acquire-equipment` | See financial-model §6. If `crewId` is set on a vehicle and that crew has none, it becomes the crew's vehicle; otherwise it is a spare. |
| `set-price` | Sets `byJobType[j]` (or `globalMultiplier` for `'all'`); triggers price shock when increasing. Affects orders created afterwards. |
| `set-policy` | Shallow-merge into policies. |
| `set-marketing-spend` | Sets `market.marketingMonthlySpend`. |
| `set-job-type-offered` | Toggles `offered`. Turning off cancels that type's pending orders (not counted as missed) and stops generation; recurring customers on that plan stay but generate nothing. |

## 11. Validation

`validateScenario` returns errors (engine throws) for: non-finite or negative
numbers where meaningless, monthly arrays not of length 12, `horizonDays < 1`,
dangling ids (crew → vehicle, employee → crew, equipment → crew/type, customer →
job type), duplicate ids, recurring type without `intervalDays > 0`. Warnings
for: crews with no members/vehicle, job types no crew can ever perform, zero
customers, zero employees. Empty companies are **valid** and must simulate.

## 12. Required invariants (tested every day of every test scenario)

1. Determinism: two runs of the same scenario are deeply equal.
2. Scenario input is not mutated.
3. `paidHours = onSiteHours + travelHours + idleHours`, all ≥ 0.
4. Orders: `created = completed + cancelled + churn/offer-cancelled + pending` (cumulative).
5. No crew clock exceeds `L`; no vehicle or equipment item is used while down or by two crews on one day; no absent employee works.
6. All accounting identities in `financial-model.md` §9.
7. Common random numbers: changing price, policies, or adding a crew does not change the weather sequence nor the absence/quit draws of pre-existing employees.

## 13. Known simplifications (v1)

No floating of idle workers between crews; one depot; straight-line × road
factor distance; all crew members ride one vehicle; no PTO; no part-day
absences; jobs never need two crews; no income tax; no inventory; no AP (vendors
are paid same-day); price changes do not reprice already-created orders.
These are listed in `docs/development-roadmap.md` as candidates, not bugs.
