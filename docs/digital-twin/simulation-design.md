# Digital Twin — Simulation Design

Status: **normative** addendum to `docs/simulation-engine.md` and
`docs/financial-model.md`. Types: `src/simulation/types-twin.ts`. Where this
document is silent, the base specs apply unchanged.

**Compatibility rule (applies to every section).** Each mechanism is controlled
by optional fields. A scenario that omits them must produce output bit-identical
to the engine before the mechanism existed. "Off" is always the default.

**Randomness rule.** A mechanism may (a) scale the threshold a draw is compared
with, or (b) use a new stream. It may never change which draw an existing event
uses. New streams: `RULE` is not needed (rules are deterministic); `CLONE` for
customer scaling. Pre-computed draw tables (`schedule.ts`) remain valid only
below their bound; when a scaled probability exceeds the bound the engine must
fall back to the direct draw (the mechanism already exists for one-off types).

## 1. Daily order of operations (amended)

1. **Conditions** — emit `shock-started` / `shock-ended`; compute today's multiplier `M_T` for every target (§2).
2. **Dated actions** — as today.
3. **Rules** — evaluate every active rule against observables as of the end of the previous day; fire in rule order, then entity config order (§9).
4. Weather (forced by a weather shock if one covers today).
5. Workforce events (annual raise first, then requisitions, then quits).
6. Asset events.
7. Demand.
8. Dispatch (with floating, §7).
9. Unserved attribution.
10. Finance (owner distribution just before the line-of-credit step, §6).
11. Record.

## 2. Exogenous conditions (shocks)

`M_T(day) = Π factor` over multiplier shocks with that target and `fromDay ≤ day < toDay`; 1 if none.

| Target | Formula it scales |
|---|---|
| `demand` | recurring accrual increment `seasonality/interval × M`; one-off probability `p × M` (clamped to 1) |
| `leads` | daily lead rate `λ × M` |
| `churn` | monthly rate `c = clamp(c₀ × M, 0, 0.5)` |
| `fuel-price` | `fuelPricePerGallon × M` |
| `materials-cost` | `order.materials × M` on the day the order is first worked |
| `absence` | absence probability, clamped to 1 |
| `turnover` | daily quit hazard, clamped to 1 |
| `vehicle-breakdown`, `equipment-breakdown` | breakdown probability, clamped to 1 |
| `repair-cost` | cost of a breakdown that starts in the window |
| `maintenance-cost` | routine per-mile and per-hour maintenance |
| `travel-time` | road distance `dist × roadFactor × M` — therefore travel time, miles, fuel and mileage upkeep |
| `collection-days` | collection delay of invoices issued in the window, `round(delay × M)` |

- `outage`: the asset is unavailable for the window; no cost; breakdown checks are skipped while it is out; its days count in `asset-down-days-90d`.
- `absence`: listed employees are absent and unpaid on workdays in the window, regardless of their draw.
- `weather`: today's state is forced.

**Required property (tested).** For a probability target and `factor ≥ 1`, every
first-order event of the unshocked run that involves an entity present in both
runs also occurs in the shocked run on the same day (events can only be added),
and for `factor ≤ 1` only removed. Unrelated streams are identical.

`demand` scales how often existing customers want service; it does not remove
customers. A shrinking customer base is modelled with `churn` or `leads`.

## 3. Workforce dynamics

For employee `i` on day `t` with tenure `τ` (days) and base productivity `π_i`:

```
ramp     = existing ramp factor
learn    = 1 + G · (1 − exp(−τ / L))                    G = learningGain, L = learningDays (learn = 1 if G = 0)
h̄_i      = paid hours in the last n days × 7 / n         n = min(28, days since max(hire day, day 0)); h̄ = 0 if n < 7
fatigue  = max(0, (h̄_i − θ) / 10)                        θ = fatigueThresholdHours (fatigue = 0 if θ missing)
prod_i   = π_i · ramp · learn · max(0.7, 1 − κ_p · fatigue)

quitHazard_i = h₀ · (1 + κ_q · fatigue) · (wage_i / w*_skill)^(−ε_w) · (1 + b_q · exp(−τ / 180)) · M_turnover     clamped to [0, 1]
absenceProb_i = p₀ · (1 + κ_a · fatigue) · M_absence                                                              clamped to [0, 1]
```

`h₀` is the existing daily hazard from `annualTurnoverRate`. With dynamics on,
`annualTurnoverRate` describes a long-tenured, market-paid, rested employee.
`prod_i` replaces `productivity × ramp` in the crew-rate formula; nothing else changes.

3.1 **Raises.** On days with `day mod 365 == 0` and `day > 0`, every active
employee's wage is multiplied by `1 + annualRaiseRate`. The model is in constant
dollars, so this is a real raise.

3.2 **Why these four.** Workload → fatigue → quits, absences and slower work is
the feedback that makes overtime and long shifts cost something. Pay → quits
makes wage decisions two-sided. Early-tenure quits make hiring risky. Learning
makes retention valuable. All four are needed for multi-year results to mean anything.

3.3 **Day-0 employees** keep their configured `tenureDays`; `π_i` is their base
productivity, so with learning on, an experienced employee is immediately more
productive than their configured figure. Calibrate `π` accordingly in any
company that enables learning.

3.4 `set-wage` multiplies the wage from that day. `move-employee` changes
`crewId` from that day; the fatigue history moves with the person.

3.5 **Labor stickiness (parameter guidance, not a mechanism).**
`minPaidHoursPerShift` decides how variable labor cost is. Values far below the
shift length make shedding work look almost costless. The demo company must use
a guarantee of at least 75% of the shift.

## 4. Customer dynamics

```
S        = 1 − min(1, mean failureScore over active customers)          service-satisfaction index in [0, 1]
λ_ref    = referralsPerCustomerYear · N_active · S / 365 · leadSeasonality[m]
λ        = (λ_base + λ_ref) · max(0, 1 − N_active / marketSize) · M_leads     (saturation factor = 1 if marketSize missing)
c        = clamp(c₀ · priceIndex^ε_r · (1 + φ·failureScore) · (1 + b_c · exp(−τ_c / 180)) · M_churn, 0, 0.5)
```

`λ_base` is the existing organic + marketing rate. The daily lead count still
uses the single existing `LEADS` draw (inverse-transform Poisson is monotone in
λ, so more referral leads only add leads). `τ_c` is days since acquisition;
customers present at day 0 are treated as long-tenured (boost term 0).

Customer lifetime value is **not** a formula in the engine or in any objective.
The long-run effect of gaining or losing customers is measured by simulating a
longer horizon (optimization-design §7). A CLV figure may be *displayed* as
"contribution per customer-year ÷ annual churn", labelled an estimate.

## 5. Asset aging

Routine maintenance uses `rate × (1 + maintenanceAgeFactorPerYear × ageNow)`,
with the factor taken from `reliability.vehicle` or `reliability.equipment`.
Breakdown probability already grows with age. Together they give an asset a
rising cost curve, which is what makes a replacement decision meaningful.

## 6. Disposal, replacement and owner distributions (financial addendum)

**Disposal** of an owned or financed asset with book value `B` and salvage `S`:

```
proceeds P = S + resaleShareOfBookValue · max(0, B − S)        (default share 0.8)
cash-flow line  assetSaleProceeds += P
income line     gainOnDisposal    += P − B                     (usually ≤ 0)
netFixedAssets  −= B
if financed: principalPaid += remaining loan balance; loan closed
```

Leased asset: the lease ends that day; no proceeds, no gain or loss (early
termination fees are not modelled — known limitation). A disposed asset leaves
its crew (`crew.vehicleId = null` for a vehicle). Emits `asset-disposed`.

**Replacement** = dispose, then acquire under the existing acquisition rules; the
new asset takes over the old one's crew assignment (and becomes the crew's
vehicle if the old one was).

**Owner distribution** (if `ownerDistributionCashAbove = X` is set): on
first-of-month days with `day > 0`, after loan payments and before the
line-of-credit step, if the line of credit has no balance,
`D = max(0, cashBeforeLoc − X)`; `ownerDistributions += D`. Emits `owner-distribution`.

**Amended statements and identities** (replace the corresponding lines of financial-model §8–§9):

```
operatingProfit = ebitda − depreciation + gainOnDisposal
netCashFlow     = … (existing terms) … + assetSaleProceeds − ownerDistributions
identity 4:  netFixedAssets_t = netFixedAssets_{t−1} + additions_t − depreciation_t − disposedBookValue_t
identity 5:  loanBalance_t    = loanBalance_{t−1} + newBorrowing_t − principalPaid_t        (payoff on disposal is principal)
identity 7:  equity_t − equity_{t−1} = netProfit_t − ownerDistributions_t
```

`gainOnDisposal` is a flow line for drivers and summaries. Owner distributions
are not an expense: they reduce equity and cash, never profit.

## 7. Floating idle workers (`policies.floatIdleWorkers`)

After each crew's deployment check and before routing:

1. **Pool** = present members of crews that cannot deploy (reason `vehicle` or
   `understaffed`), seat-overflow members, and present employees with no crew.
   Order: skill descending, then config order.
2. For each pool member in order: among deployed crews with a free seat, choose
   the one with the fewest deployed members (ties: config order); the member
   joins it for the day. If none has a free seat, the member stays in the pool.
3. Floaters count fully for the receiving crew's rate, `minSkill`, `minCrewSize`
   and are paid by its clock. Members left in the pool are paid as today.

A crew with zero present members stays undeployed even if the pool could staff
it (re-forming crews is a `move-employee` decision, not a daily reflex).

## 8. Customer-base scaling and theoretical capacity (pure helpers)

`scaleCustomerBase(scenario, m)` with `r(x) = fmix32(hashString(x)) / 2³²` (murmur3 finalizer; ADR-018):

- `m ≤ 1`: keep customer `c` iff `r(c.id) < m`.
- `m > 1`: keep all; for `k = 1 … ⌈m − 1⌉` add clone `c.id#k` iff `k ≤ ⌊m − 1⌋` or `r(c.id#k) < m − ⌊m⌋` (for the fractional band).
- A clone copies `sizeFactor` and plan; position = original + `0.15·u₁` miles at angle `2π·u₂`; `phase = (phase + u₃) mod 1`, with `u₁…u₃ = rand01(0, CLONE, hash(cloneId), 0, 0…2)` (seed-independent).
- Nesting (tested): for `m₁ < m₂` the customer set of `m₁` is a subset of that of `m₂`.

`theoreticalWeeklyCapacity(scenario)` = Σ over crews that have a vehicle of
`crewRate(day-0 members capped at seats) × shiftHours × workDaysPerWeek`, with
ramp and learning at day-0 tenure and no fatigue. It is an upper bound that no
real week reaches; the capacity experiment (optimization-design §4) measures the gap.

## 9. Decision rules

A rule is a stored, deterministic "if this, then that". On each day, after dated
actions, for every rule (in array order) whose `activeFromDay ≤ day < activeToDay`
window (defaults 0 and ∞) includes today:

- Without `forEach`: one instance. With `forEach`: one instance per existing
  vehicle / equipment item / crew, in config order; `'$each'` in `scope` and in
  action id fields is replaced by the entity id.
- An instance **fires** if all conditions hold, it has fired fewer than
  `maxFirings` times, and at least `cooldownDays` have passed since its last firing.
- Firing applies `then` in order via the normal action path (rejections are
  recorded as usual) and emits `rule-fired`.

**Observables** are read from state as of the end of the previous day (on day 0:
the opening state; trailing metrics are 0). Trailing ratios with a zero
denominator are 0. Scoped observables whose entity no longer exists make the
condition false. `asset-upkeep-365d` is routine maintenance plus repair cost
booked to that asset over the trailing 365 days (or since day 0).

Rules cannot observe the future or random draws, so a rule-driven run is exactly
as reproducible as a scripted one. Ids of entities created by a rule firing use
the day and a stable index `rule:{ruleId}:{firingNumber}` in place of the action index.

Rules make these brief items expressible without new engine code:
"replace equipment when upkeep is excessive" (`asset-upkeep-365d > x → replace-asset`),
"cut marketing in slow months" (`month == m → set-marketing-spend`),
"hire when the backlog stays high" (`backlog-hours > x ∧ missed-rate-28d > y → hire-employee`).

## 10. Extension points for other industries (not built)

| Need | Generic mechanic | Where it attaches |
|---|---|---|
| Emergency / same-day calls | orders with `availableFromClock` and a priority class | dispatch selection loop |
| Appointment windows | `[earliest, latest]` arrival clock per order | `fitOrder` |
| Parts and consumables stock | inventory balance + reorder rule; identity for inventory | finance ledger, rules |
| Multi-day projects with dependencies | order precedence list | dispatch pool filter |
| Certifications | skill tags instead of a single level | crew eligibility |
| Autocorrelated weather | two-state Markov chain on the existing WEATHER draw | weather step |

## 11. Known limitations after this design

Constant dollars; no taxes; no lease termination fees; customers at day 0 have
no tenure; weather independent between days unless forced; one depot; floating
never re-forms a crew; rules are conjunctions only; no competitor behaviour.
