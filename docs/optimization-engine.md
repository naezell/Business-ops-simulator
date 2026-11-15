# Optimization Engine Specification

Status: **normative**. Implemented in `src/optimization/`; contract in
`src/optimization/types.ts`. Entry point: `optimize(request, onProgress?)` —
pure, synchronous, deterministic. The UI runs it in a Web Worker.

## 1. Method (ADR-004)

Simulation-based optimization. The simulator is the only source of truth about
what a decision does; the optimizer never estimates profit with its own
formulas. It:

1. runs the baseline on `K` seeds,
2. diagnoses bottlenecks from those runs,
3. generates candidate actions,
4. rejects candidates that violate constraints,
5. evaluates the rest as **paired differences** against the baseline on the same seeds,
6. ranks them, searches for the best small combination, and
7. explains each result from the simulated P&L differences.

Because the engine's randomness is counter-based (simulation-engine §3), the
baseline and a candidate experience the same weather, absences and breakdowns.
The paired difference therefore isolates the effect of the decision, and a
handful of seeds is enough to rank.

## 2. Evaluation

- Seeds: `seed_k = scenario.seed + 7919·k`, `k = 0 … K−1` (`K = seedCount`, default 5).
- Candidate scenario = baseline scenario with the candidate's actions appended at day 0. Runs use `detail: 'summary'`.
- Objective per seed: `net-profit` → `totals.income.netProfit`;
  `ending-cash` → final `balance.cash − balance.locBalance`.
- `deltaX_k = X_candidate,k − X_baseline,k`. A `Distribution` reports mean, min, max and sample std-dev over `k`.
- `probabilityOfImprovement` = share of seeds with objective delta > 0.
- **Screening** (performance): all candidates are evaluated on the first
  `min(2, K)` seeds. Only the 15 best by mean objective delta (plus every
  candidate with a positive mean) continue to all `K` seeds. `seedsEvaluated` records which applies.
- `confidence`: `high` if improvement in every seed and `|mean| > 2·stdDev/√K`
  (with `K ≥ 3`); `medium` if `probabilityOfImprovement ≥ 0.7`; else `low`.

## 3. Bottleneck detection

Computed from baseline seed-means; "annualized" = × `365 / horizonDays`.
`R` = annualized revenue. Severity is clamped to `[0, 1]`; bottlenecks with
severity < 0.02 are omitted; the list is sorted by severity.

| Kind | Evidence | Estimated annual impact | Severity |
|---|---|---|---|
| `crew-capacity`, `equipment-availability`, `vehicle-availability`, `staffing-reliability`, `skill-gap`, `weather` | Share of total `unservedHoursByReason` for the mapped reason (`capacity`+`no-crew`, `equipment`, `vehicle`, `crew-size`, `skill`, `weather`) | `lostRevenue × share`, annualized | `impact / (0.10·R)` |
| `weak-demand` | `idleShare = idleHours / paidHours`; flagged when > 0.15 | `(idleShare − 0.10) × (directLabor + payrollBurden)`, annualized | `(idleShare − 0.10) / 0.30` |
| `routing-inefficiency` | Baseline re-run with each other routing policy | best positive mean Δ net profit, annualized (a **simulated** figure) | `impact / (0.05·R)` |
| `unprofitable-job-type` | `jobTypeStats[j].contribution < 0` | `−contribution`, annualized | `impact / (0.05·R)` |
| `cash-constraint` | any shortfall day, or min cash < `minCashReserve` | annualized interest paid | 1 if any shortfall day, else `0.25 × (reserve − minCash) / reserve` |

If `R = 0`, severities with `R` in the denominator are 1 when impact > 0.
Headline and detail strings are deterministic templates filled from `evidence`.
The impact figures other than routing are estimates from accounting data and
must be worded as such ("up to about …"), never as guaranteed gains.

## 4. Candidate generation

Single actions, generated from the company and the `OptimizerCatalog`,
independent of the bottleneck list (bottlenecks explain; the simulator decides).
Each candidate has a stable `id` and a **conflict key**; two candidates with the
same key cannot be in one plan.

| Category | Candidates | Conflict key |
|---|---|---|
| staffing | hire each hire template into each crew with a free seat; remove the lowest-skill (then lowest-productivity) member of each crew with ≥ 2 members | `crew:{id}:staff` |
| crew | add the catalog's standard crew, financed by `loan` and by `lease`; remove each crew | `crew:add` / `crew:{id}:staff` |
| fleet | acquire each catalog vehicle as an unassigned spare by `loan` and `lease` | `fleet:spare` |
| equipment | for each catalog item: acquire one as a spare (`cash` if price < 2000, else `loan`); if no crew owns that type, assign it to the crew with the highest-skilled member | `equip:{typeId}` |
| pricing | all prices × {0.90, 0.95, 1.05, 1.10, 1.15}; each job type with completed jobs × {0.90, 1.10, 1.20} (relative to current) | `price:all` / `price:{jobTypeId}` |
| scheduling | each other routing policy; `maxOvertimeHoursPerDay` ∈ {0, 1, 2} \ current; `workDaysPerWeek` 5↔6; `shiftHours` ± 1 within [6, 10] | `policy:{field}` |
| marketing | spend × {0, 0.5, 1.5, 2} (if current spend is 0: `spendScale × {0.5, 1}`) | `marketing` |
| service-mix | stop offering each job type that had demand | `price:{jobTypeId}` |

`price:all` also conflicts with every `price:{jobTypeId}`.

## 5. Constraints

A candidate or plan is **infeasible** — reported in `infeasible` with reasons,
never ranked, never recommended — if any of:

Static (checked before simulating):
- `upfrontCash > startingCash + lineOfCredit.limit`. `upfrontCash` = cash prices
  + loan down payments + hiring costs of its day-0 actions.
- It would hire into a crew beyond its vehicle's seats, or remove the last member of a crew (use `remove-crew`).

Simulated (any seed):
- an `action-rejected` event;
- more shortfall days than the baseline in the same seed, or (when the baseline
  has none) end-of-day cash below `minCashFloor` (default 0);
- seed-mean missed-job rate above `max(maxMissedJobRate, baselineRate + 0.005)` (default cap 0.05);
- seed-mean ending active customers below `(1 − maxCustomerLossFraction) ×` the baseline's (default 0.10).
  Rationale: the horizon is finite. An action that sheds customers (a steep price
  rise, dropping a service) can raise profit inside the horizon while damaging the
  years after it. The simulator cannot see past the horizon, so the guard is an
  explicit, owner-adjustable constraint rather than a hidden terminal-value formula.

`recommended` = feasible ∧ mean objective delta > 0 ∧
`probabilityOfImprovement ≥ minProbabilityOfImprovement` (default 0.7).

## 6. Ranking and plan search

- `candidates` = feasible singles sorted by mean objective delta, descending
  (ties: lower `upfrontCash`, then `id`).
- Beam search for `bestPlan`:
  1. Pool = the best `recommended` single **per conflict key**, then the 10 best of those.
     (Without this, ten price points crowd out every other kind of action and no plan can be formed.)
  2. Beams = the best `beamWidth` (default 3) of the pool, as 1-action plans.
  3. For size 2 … `maxPlanSize` (default 3): extend every beam with every pool
     member that does not conflict; de-duplicate by action-id set; evaluate on
     all `K` seeds with the full constraint check; keep the best `beamWidth`
     `recommended` plans whose mean objective exceeds their parent's by more
     than `max($100, 1% of the parent's gain)`.
  4. `bestPlan` = the best plan seen at any size (a smaller plan wins when
     within 2% of a larger one). `null` if the pool is empty.
- Interactions (e.g. a new crew only pays with more marketing) are captured
  because every combination is re-simulated, not added up.

## 7. Explanation

- `drivers`: for every `IncomeStatement` line, the seed-mean change expressed
  as its effect on net profit (revenue +, costs −). Subtotals are excluded; the
  drivers sum to the mean Δ net profit (tested).
- `explanation`: 3–5 template sentences built only from simulated numbers:
  what changed operationally (jobs completed, utilization, missed-job rate,
  customers), where the money moved (revenue and the two largest cost drivers),
  the range across seeds and probability of improvement, and cash (upfront,
  lowest cash, payback).
- `assumptionSensitive` is true for any plan containing a pricing, marketing or
  service-mix action. Its explanation must end with a sentence saying the result
  depends on illustrative price-sensitivity / marketing-response assumptions and
  that the change in ending customers (`deltaEndCustomers`) continues to matter after the horizon.
- `paybackDays`: on the seed-mean daily series of Δ(`cash − locBalance`), the
  first day from which the series stays ≥ 0 to the horizon; `null` if
  `upfrontCash = 0` or it never does.

## 8. Required tests (known answers)

1. **Capacity-bound, cash-rich**: demand far above one crew's capacity → top
   recommendation adds capacity; `crew-capacity` is the top bottleneck.
2. **Demand-bound**: idle crews → adding a crew is ranked with negative delta
   and not recommended; `weak-demand` is the top bottleneck.
3. **Cash-poor**: a purchase whose upfront cash exceeds cash + credit is in
   `infeasible` with a cash reason and absent from `candidates`.
4. **Missing equipment**: a demanded job type nobody can perform → acquiring
   that equipment is recommended; `equipment-availability` is flagged.
5. **Zero elasticity** (deterministic company, all price elasticities and shock
   0): Δ revenue of a +10% price change equals 10% of the revenue from orders created after day 0, computed independently in the test.
6. **Brute force**: on a small candidate set, the top-ranked single equals the
   argmax of independently simulated objective deltas; `bestPlan` is at least as good as the best single.
7. **Determinism**: same request ⇒ deep-equal result (excluding `elapsedMs`).
8. **Drivers** sum to mean Δ net profit for every candidate.
9. No recommended candidate or plan violates any constraint in §5 when re-simulated by the test.
10. **Customer-loss guard**: with high retention elasticity, a steep price rise that improves in-horizon profit but loses more than the allowed share of customers is in `infeasible`.
11. **Plan diversity**: when the ten best singles share one conflict key, `bestPlan` can still combine actions with different keys.

## 9. Limits to state honestly in the UI

- Results hold for the modelled horizon and the stated assumptions; elasticity,
  churn and breakdown rates are illustrative unless the user supplied them.
- The search is heuristic: it finds the best plan among the generated actions
  and beam, not a proven global optimum.
- `K` seeds give a range, not a confidence interval in the statistical sense.

## 10. Later (not v1)

Capacity-headroom probe (scale demand until service fails), dated multi-step
plans (hire in March, buy in June), per-crew seasonal staffing, asset
replacement, per-job-type price optimisation by line search, user-defined
objectives (owner hours, risk-adjusted profit).
