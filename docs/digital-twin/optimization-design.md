# Digital Twin — Optimization Design (the Study)

Status: **normative**. Supersedes `docs/optimization-engine.md` where they
differ; everything there not contradicted here still applies (evaluation by
paired seeds, constraints §5, drivers §7). Contract: `src/optimization/study-types.ts`.

## 1. Method and why

The optimizer stays **simulation-based**. It becomes a staged investigation — a
*study* — that an owner starts once and that reports findings as they arrive:

```
baseline → loss attribution → capacity experiment → single actions (screen, rank)
        → refine (timing, price line search) → interactions (pairs) → plans (beam)
        → validation of finalists (long horizon, stress cases, assumption probes)
```

Alternatives considered (details in ADR-015):

| Approach | Verdict |
|---|---|
| Mathematical programming (LP/MIP) on a model of the business | Rejected. It needs a second, simplified model of the business whose answers could disagree with the simulator the user is watching. The objective is a stochastic, non-linear, path-dependent black box. |
| Constraint programming for routing/scheduling | Rejected for now. It would optimise the *daily dispatch*, which deliberately models how a small company dispatches. Better dispatch belongs in the engine as a routing policy, where the simulator measures its real value. |
| Bayesian optimisation / evolutionary search | Rejected. The decision space is mostly discrete and small after pruning; these add tuning and opacity for little gain. |
| Experimental design (fractional factorials) | Partly adopted in the simplest useful form: exhaustive **pairwise** screening over a short list, which measures every two-way interaction directly and is easy to explain. |
| Staged simulation search with successive screening (chosen) | Deterministic, explainable, anytime, and every number is a simulation result. |

No stage may produce a number that is not a simulation output or simple
arithmetic on simulation outputs. No language model is involved anywhere.

## 2. Evaluation

- All simulator access goes through `EvaluateBatch(jobs)`. A job is `(variant, seed)`;
  a `Variant` is actions + rules + shocks + parameter patches + customer scale + optional horizon.
- **Pairing.** Every strategy is compared with a baseline that has the *same*
  shocks, patches, customer scale, horizon and seed, differing only in the
  strategy's actions and rules. A strategy under stress case `s` is compared with
  the baseline under `s`, never with the unstressed baseline.
- Seeds: `seed_k = scenario.seed + 7919·k`. Ranking uses `K = budget.seeds`;
  screening the first `screenSeeds`; validation the first `validationSeeds`.
- **Cost unit** = one run of the scenario horizon `H`. A run of `L` days costs `⌈L/H⌉`.
  The study never exceeds `budget.maxSimulations` units; phases run in order and
  later phases shrink first (§10).
- Results are a pure function of the request. Batching and worker count must not change them.

## 3. Loss attribution by relaxation (replaces dollar estimates on bottlenecks)

For each source, simulate the baseline with that source removed and report
`valueIfEliminated = objective(relaxed) − objective(baseline)` on `screenSeeds` seeds.

| Source | Relaxation |
|---|---|
| weather | weather forced `clear` for the whole horizon |
| absence | `absence × 0` |
| turnover | `turnover × 0` |
| breakdowns | `vehicle-breakdown × 0` and `equipment-breakdown × 0` |
| travel | `travel-time × 0` |
| churn | `churn × 0` |
| collection-delay | `collection-days × 0` |
| demand-shortfall | customer scale 1.25 (value of 25% more demand — not an elimination; labelled so) |

These are **upper bounds on what fixing a problem could be worth**, obtained by
experiment. They are not additive (removing two sources is not the sum) and not
achievable in full. Wording must say "at most about". The existing
`Bottleneck` list is kept for the *diagnosis* text; its `estimatedAnnualImpact`
is replaced by the matching relaxation value where one exists.

## 4. Capacity experiment

Purpose: operating capacity as it can actually be achieved, not a theoretical maximum.

1. Grid of customer-base scales `G = {0.6, 0.8, 1.0, 1.2, 1.4, 1.7, 2.0, 2.5}` via
   `scaleCustomerBase`, each on `screenSeeds` seeds → a `CapacityPoint` per scale.
2. **Service constraint**: seed-mean missed-job rate ≤ `maxMissedJobRate` and late-job rate ≤ 0.15.
3. `effectiveScale`: the last passing grid point before the first failing one,
   refined by three bisection steps inside that bracket. All pass → 2.5 (reported
   as "at least"); 0.6 fails → 0.6 ("below").
4. `headroomCustomers = ⌊(effectiveScale − 1) × active customers⌋`.
5. `saturationHoursPerWeek` = completed standard labor hours per week at scale 2.5.
6. **Loss bridge** at saturation, per week, exact by construction:
   `scheduledHours = absence + notWorked + idle + travel + productivityGap + completedLaborHours`, with
   `absence = absentShifts × shiftHours`, `notWorked = scheduledHours − absence − paidHours`
   (negative when overtime exceeds unpaid time; shown as "overtime"),
   `productivityGap = onSiteHours − completedLaborHours`.
7. `profitMaxScale` = grid scale with the highest mean net profit.
8. `bindingConstraint` = largest `unserved` reason at the first failing scale.

The result answers: how many more customers the current operation can take
while keeping service; what the practical ceiling is and how far below theory;
where the hours go; and whether growth or shrinkage would be more profitable.
It describes the simulated period only — a spring horizon measures spring capacity.

**Break-even demand for a resource.** For the best capacity-adding single (hire
or crew) that is *not* recommended at scale 1, bisect the scale in `[1, 2.5]`
(four steps, `screenSeeds`) for the point where its Δ objective crosses zero, and
report "pays for itself from about N customers". Skip if it is already
recommended or negative at 2.5.

## 5. Single actions

Generation as in optimization-engine §4, plus (all generated from data, none hard-coded to an industry):

| Category | New candidates | Conflict key |
|---|---|---|
| fleet / equipment | `replace-asset` for each asset past 60% of useful life or among the two highest baseline upkeep, with the catalog item of the same type, by `loan` and `lease` | `asset:{id}` |
| scheduling | `floatIdleWorkers: true` (if off) | `policy:floatIdleWorkers` |
| staffing | `move-employee` from the crew with the highest baseline idle share to the crew with the most unserved `capacity` hours; `set-wage` ×1.05 and ×1.10 for all (only if `wageQuitElasticity > 0`) | `crew:{id}:staff` / `wage:all` |
| service-mix | `drop-customers`: the customers with negative baseline contribution (from `customerStats` of one full-detail baseline run), as one candidate; and the worst 5% by contribution per on-site hour | `customers:drop` |
| rules | auto-replace rule (`asset-upkeep-365d` above the asset's annual straight-line depreciation → `replace-asset`, `forEach` vehicle); backlog-hire rule (`backlog-hours` > one crew-week ∧ `missed-rate-28d` > cap → hire into the most loaded crew, cooldown 60, max 2); slow-season marketing rule (months with `leadSeasonality < 0.8` → spend × 0.5, others restore) | `rule:{name}` |

Screening and ranking: unchanged (screen on `screenSeeds`, the best 15 plus all positive ones go to `K` seeds).

## 6. Refinement

**Timing.** Candidates: the six feasible singles with the largest `|mean Δ|` in
categories staffing, crew, fleet, equipment, marketing — *including
non-recommended ones* (a hire that loses on day 0 may win six weeks before the
peak). Start days: day 0 plus first-of-month days in the horizon, thinned to at
most six evenly spaced. Each variant is screened; the best day per candidate is
evaluated on `K` seeds and replaces the day-0 version if better by more than
`max($100, 2%)`. A **temporary variant** is also tried for hires and marketing
increases: start at the best day, reverse (remove the employee / restore spend)
on the first first-of-month after it whose baseline month had zero cancelled jobs.

**Price line search.** For the global multiplier and the two job types with the
largest `|mean Δ|`: bracket the best grid point, then at most four golden-section
evaluations within `[0.85, 1.30]` (stop at interval width 0.01). Every evaluation
is subject to the constraints, so the search stops at the customer-loss guard
rather than at a grid edge.

## 7. Interactions and plans

**Pair screening.** Short list `A`: the best feasible single per conflict key
(recommended or not), keep the eight with the largest `|mean Δ|`, then add the
best of each category among crew, staffing, marketing, pricing, fleet,
scheduling if missing (at most twelve). Evaluate every non-conflicting pair on
`screenSeeds` seeds. `interaction = Δ_ab − Δ_a − Δ_b`. A pair with
`Δ_ab > max(Δ_a, Δ_b, 0) + $100` is a **synergy pair**: re-evaluated on `K`
seeds and added to the plan pool as one unit. This finds combinations whose
parts fail alone (new crew + marketing).

**Beam search.** As optimization-engine §6 with pool = best recommended single
per conflict key + synergy pairs (ten best), `maxPlanSize` 4.

## 8. Validation of finalists

Finalists = the `budget.finalists` best recommended strategies by in-horizon mean
Δ objective, distinct by action set. Each gets three checks on `validationSeeds` seeds.

**Long run.** Horizon `L = longRunDays`. Because a longer run is identical to the
shorter one on its first `H` days (prefix identity), `Δ_beyond = Δ_L − Δ_H` per seed.

```
annualizedInHorizon     = mean Δ_H × 365 / H
annualizedBeyondHorizon = mean Δ_beyond × 365 / (L − H)
verdict = reverses  if mean Δ_L ≤ 0
          fades     if annualizedBeyondHorizon < 0.25 × annualizedInHorizon
          holds     otherwise
```

**Stress.** Default cases (all relative to `H`):

| Id | Shocks |
|---|---|
| demand-down | `demand × 0.8`, whole horizon |
| fuel-up | `fuel-price × 1.3`, whole horizon |
| key-people-out | the highest-skill member of each of the two largest crews absent for 14 days from day `⌊H/3⌋` |
| truck-out | outage of the vehicle of the crew with the highest baseline revenue, 21 days from day `⌊H/3⌋` |
| churn-up | `churn × 1.5`, whole horizon |
| rain-week | weather `rainout` for 5 consecutive days from day `⌊H/2⌋` |
| upkeep-up | `maintenance-cost × 1.5` and `repair-cost × 1.5`, whole horizon |

`delta_s` = mean paired Δ objective under case `s`; `feasible_s` = constraints
hold relative to the stressed baseline. `robustShare` = share of cases with
`delta_s > 0 ∧ feasible_s`; `worstCase = min delta_s`.

**Assumption probes.** Default paths, factors `{0.7, 1.3}`, one at a time:
`market.acquisitionPriceElasticity`, `market.retentionPriceElasticity`,
`market.oneOffPriceElasticity`, `market.priceIncreaseShockChurnPerPct`,
`market.baseMonthlyChurn`, `market.baseConversionRate`,
`market.serviceFailureChurnWeight`, `workforce.absenceRate`,
`workforce.annualTurnoverRate`, `reliability.vehicle.dailyProb`,
`reliability.equipment.dailyProb`. Probes whose path is missing or 0 are skipped.
Strategies that are not `assumptionSensitive` run only the workforce and
reliability probes. A probe **flips** the strategy if the paired Δ objective
under the patched assumption has the opposite sign.

## 9. Verdict, score, trade-offs

```
recommended      feasible ∧ mean Δ > 0 ∧ P(improve) ≥ min
                 ∧ (not validated ∨ (longRun ≠ reverses ∧ robustShare ≥ 2/3 ∧ no flips))
conditional      improves in the horizon but: longRun = fades, or robustShare < 2/3, or ≥ 1 flip
not-recommended  mean Δ ≤ 0, or P(improve) < min, or longRun = reverses
score            validated:   min(annualizedInHorizon, mean Δ_L × 365 / L)
                 otherwise:   annualizedInHorizon
```

Ordering of `strategies`: verdict tier, then score descending, then lower
`upfrontCash`, then id. Using the lower of the short- and long-horizon rates
means a strategy cannot rank well on a gain that exists only inside the window.

`caveats` are template sentences, one per failed check ("Gain fades after the
first N months: about $x a year inside the plan, $y a year after",
"Loses money if demand falls 20%", "Depends on the price-sensitivity assumption:
reverses if customers are 30% more price-sensitive than assumed").

**Pareto set.** Axes (direction): in-horizon mean Δ objective (↑), score (↑),
worst-seed Δ (↑), `minCash` (↑), `upfrontCash` (↓), after-missed-job rate (↓).
`paretoOptimal` = not dominated among feasible strategies. The UI uses it to
show real trade-offs ("more profit but needs $x up front and thinner cash").

## 10. Budget policy

Default 1500 units. Reservations, in order: baseline `K`; loss attribution ≤ 20;
capacity ≤ 60; singles as needed (≈ 150–250); refine ≤ 150; pairs ≤ 140; plans
≤ 200; validation = the remainder. If validation cannot afford all finalists it
validates as many as fit, best first; the long-run check is dropped before the
others for the remaining finalists (and their verdict says "not validated
long-run"). `budgetExhausted` is set when anything was cut. A study stopped by
`shouldStop` returns the partial result of the last completed phase.

## 11. Mathematically valid, still misleading — and the guard

| Situation | Why it misleads | Guard |
|---|---|---|
| Profit rises because customers leave and labor falls one-for-one | Labor is modelled as more variable than it is; the customer base is the long-term asset | Customer-loss constraint; long-run check; demo uses a realistic paid-hours guarantee; caveat when Δ end customers < 0 |
| Gain exists only inside the horizon | End-of-window effect | Score = lower of short- and long-horizon rate; `fades` / `reverses` |
| Longer hours look free | No workload feedback | Fatigue model must be on in the demo; Δ quits and Δ overtime reported |
| A purchase "pays back" because the horizon ends before the costs do | Financing and upkeep continue | Objective is profit (depreciation, interest), not cash; long-run check |
| Result driven by an illustrative elasticity | Parameter is not measured | Assumption probes; `flips`; assumption-sensitive tag |
| Ranking by mean hides a bad tail | Averages over seeds | Worst-seed Δ and min cash reported and on the Pareto axes; stress worst case |
| Winner of many comparisons looks better than it is | Selection bias over hundreds of candidates | Finalists re-evaluated: long-run and stress runs are fresh evidence; report in-horizon Δ from all `K` seeds, not the screening seeds |
| Bottleneck "worth $x" | Share-of-lost-revenue arithmetic | Replaced by relaxation values labelled as upper bounds |
| Capacity quoted from crew-hours arithmetic | Ignores travel, weather, absence, fragmentation | Capacity experiment; theoretical figure shown only next to the achievable one |
| Stress case makes everything negative, so nothing is "robust" | Comparing with the unstressed baseline | Paired stressed baselines (§2) |
| Synthetic company presented as a forecast | Data is invented | "Synthetic demonstration" label on every screen that shows results |

## 12. Required tests (known answers; expectations established independently)

1. **Timing**: seasonal company (demand only from day 45) with a ramp-up — hiring at day 0 loses, hiring shortly before day 45 wins; the study selects a start day in the stated window.
2. **Synergy**: company where a new crew is demand-bound and marketing is capacity-bound — neither single is recommended, the pair is found and recommended.
3. **Long-run reversal**: high retention elasticity — a price rise wins over `H` and loses over `L`; verdict `not-recommended`, and it ranks below a smaller durable gain.
4. **Fatigue**: with the fatigue model on, a 10-hour shift is not recommended where it was with it off; Δ quits > 0 is reported.
5. **Stress pairing**: under `demand-down` a cost-saving strategy has positive paired delta even though absolute profit is below the unstressed baseline.
6. **Assumption flip**: a strategy that wins only because an elasticity is low is flagged with that path in `flips`.
7. **Capacity**: deterministic one-crew company whose capacity can be computed by hand (hours per stop × stops per day): `effectiveScale` within one grid-bisection step of the hand value; the loss bridge sums exactly.
8. **Loss attribution**: a company with one loss source only (weather): its relaxation value equals the whole gap to the no-loss run; other sources ≈ 0.
9. **Budget**: with a tiny budget the study returns a valid partial result with `budgetExhausted` and never exceeds the cap.
10. **Determinism and backend independence**: in-process backend, batch size 1, and a shuffled-completion backend give deep-equal results.
11. **Pareto**: a hand-built set of strategy outcomes yields the expected non-dominated set.
12. **No rule violation**: every recommended strategy, re-simulated by the test, satisfies all constraints.
13. Existing `optimize()` tests continue to pass unchanged.

## 13. Performance requirements

Measured on the demo scenario (20 staff, 6 vehicles, 100 customers, 90 days), 4 worker threads:

| Item | Requirement |
|---|---|
| One summary run | ≤ 12 ms median in bundled Node |
| Baseline + bottlenecks + loss attribution shown | ≤ 3 s after start |
| Ranked single actions shown | ≤ 8 s |
| Full default study | ≤ 45 s; ≥ 100 distinct feasible strategies evaluated |
| Main thread | never blocked > 50 ms by the study |

If the full study exceeds the limit, reduce validation cost first (fewer
finalists, `L = 2 years`), never the pairing or the seeds used for ranking.
