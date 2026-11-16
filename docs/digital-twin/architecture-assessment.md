# Digital Twin — Architecture Assessment

Status: architect's assessment of the code on `claude/business-ops-simulator-arch-hxfhr1`
(PR #1, 321 tests passing). Findings marked **[verified]** were checked against the
code or by running it, not taken from the earlier documentation.

## 1. Verdict

The existing architecture can carry the digital twin **without restructuring**.
The daily job-level engine, the counter-based random numbers, the action
mechanism and the simulation-based optimizer are the right foundations. What is
missing is behaviour, not structure: exogenous conditions, reactive decisions,
long-run dynamics, capacity experiments, and an optimizer that searches timing
and validates its own findings. Everything proposed is additive and is switched
off for existing scenarios, so current results stay bit-identical.

Two structural changes are justified, both in the optimizer, none in the engine:

1. The optimizer's simulator access becomes an asynchronous batch interface
   (`EvaluateBatch`) so a pool of Web Workers can run evaluations in parallel.
2. The optimizer becomes a staged, budgeted **study** that emits partial results
   and validates finalists (long horizon, stress, assumption sensitivity).

## 2. Question-by-question evaluation

| Question | Finding | Decision |
|---|---|---|
| Daily vs sub-daily time | Within a day the dispatch loop already sequences each crew's stops on a clock and logs `arrive`/`depart` **[verified: `CrewDayLog.stops`]**. Time-of-day playback can be reconstructed from the logs. No current mechanic needs events between days to interact within a day (breakdowns and absences are known at day start). | Keep the daily step (ADR-009). Sub-daily *arrivals* (emergency calls for HVAC/plumbing) are a future dispatch-loop extension, not a new time model. |
| Interactions between systems | Present: capacity ↔ demand ↔ service failures ↔ churn ↔ cash. Missing feedback loops: workload → fatigue → quits/absence; service quality → referrals; asset age → upkeep cost; customer base → market saturation. Without them several decisions are "free" (see §4). | Add the loops as optional dynamics (simulation-design §3–§5). |
| State transitions and event order | Fixed daily order of operations; state is one private mutable object; all transitions go through `applyAction` or the step functions **[verified: `engine.ts`, `actions.ts`]**. | Keep. Rules and shocks slot into the existing order at defined points. |
| Deterministic reproducibility | Draws are a hash of (seed, stream, entity, day, index); pre-computed draw tables are bit-identical **[verified by tests]**. | Keep. New mechanics may only scale thresholds or add streams; never reuse or shift draws. |
| Scalability | Measured on the sample company (8 staff, 190 customers), summary mode: 90 days 16 ms, 1 year 42 ms, 3 years 93 ms, 5 years 162 ms; full-detail output 2.2 MB per year **[verified]**. Cost is linear in days. | Multi-year and thousands of runs are affordable in a worker pool. Long runs must use summary mode; full detail only for the run being displayed. |
| Scenario branching | A branch is the same scenario with different dated actions, re-run from day 0. Because unrelated draws are identical, the branch equals the baseline on every day before the first differing action. Snapshot/restore of engine state would save < 100 ms per run and add a large invariant surface. | Branch by replay (ADR-009). Add a prefix-identity test. No state snapshots. |
| Multi-year | Runs correctly for 5 years **[verified]**, but the business is stationary: no wage growth, learning, replacement or owner distributions; depreciation runs out (year 4 depreciation falls from 12k to 5k while upkeep rises 26k → 37k) and cash piles up to 276k. | Add long-run dynamics, asset replacement and owner distributions before trusting multi-year numbers. |
| Real-world data | `CompanyConfig` is plain data with provenance labels; nothing in the engine assumes synthetic input. Missing: import, and calibration against actuals. | Out of scope now; the seams are `persistence.ts` and `ParamMeta`. Noted in the plan as a later phase. |
| More industries | Engine has no industry branches **[verified by boundary test]**. Needs for other trades (appointment windows, emergency calls, parts stock, multi-day projects) are generic mechanics. | Do not add industries yet. Extension points are listed in simulation-design §10. |

## 3. What already satisfies the brief

| Brief item | Status |
|---|---|
| Decisions at a point in time | Engine: done (`PlannedAction.day`, tested). UI and optimizer: day 0 only. |
| Bottleneck detection | Done, but dollar figures are accounting estimates (§4.9). |
| Candidate generation, constraints, ranking, plan search, explanations | Done for single day-0 actions and small combinations. |
| Uncertainty | Paired seeds, range, probability of improvement: done. Assumption sensitivity: only a flag. |
| Weather, breakdowns, absence, turnover, churn, seasonality | Done. |
| Visual operations | Map, daily routes, day scrubber, crew cards, timeline: done. Time-of-day playback: not built, but the data exists. |
| No LLM dependency | Holds: no model calls anywhere **[verified: no network code in `src/`]**. |

## 4. Where the current model is simplistic or can mislead

Each item states the consequence and the remedy (section numbers refer to
`simulation-design.md` / `optimization-design.md`).

1. **Overtime and long shifts are free.** Longer shifts are recommended (+$2–3k)
   because workload has no effect on quitting, absence or productivity. → fatigue model (sim §3).
2. **A one-year window overstates customer-shedding actions.** A three-year probe
   showed a price rise's gain fading to about zero while the smaller customer
   base persisted. → long-run validation of finalists (opt §7).
3. **Labor is almost fully variable.** `minPaidHoursPerShift` is 4 of 8 hours, so
   losing work removes cost nearly one-for-one. This inflates the benefit of
   shedding customers and understates the cost of idle capacity. → demo company
   uses a realistic guarantee; weekly guarantee documented as a parameter choice (sim §3.5).
4. **Idle people cannot help another crew.** A crew without a truck sends everyone
   home. → float policy (sim §7).
5. **Customers have no lifetime dynamics.** Churn ignores tenure; service quality
   does not generate referrals; the market is infinite. → customer dynamics (sim §4).
6. **Assets never wear out economically.** Breakdown probability grows with age but
   routine upkeep does not, and nothing is ever replaced. → aging upkeep, disposal
   and replacement with correct accounting (sim §5–§6).
7. **People never change.** Productivity is fixed after the ramp; wages never move;
   quitting ignores pay. → learning curve, raises, pay-sensitive turnover (sim §3).
8. **Cash accumulates forever.** No owner distributions, so multi-year cash
   constraints disappear. → distribution policy with an amended equity identity (sim §6).
9. **Bottleneck dollar values are shares of lost revenue**, and unserved hours are
   counted once per day they stay pending. They indicate where to look, not what
   fixing it is worth. → loss attribution by simulated relaxation, and a capacity
   experiment (opt §3–§4).
10. **Weather is independent day to day**; multi-day disruptions never occur by
    themselves. → forced-weather shocks for stress tests (sim §2). Autocorrelated
    weather is left as a later refinement.
11. **The optimizer only considers day-0 actions and combines only actions that are
    individually good.** It cannot find "hire six weeks before the peak" or
    "a new crew pays only with more marketing". → timing search and pairwise
    interaction screening (opt §5–§6).
12. **Recommendations are tested under one set of assumptions.** → assumption
    probes and stress cases for finalists (opt §8–§9).

## 5. Things deliberately not changed

- No backend, database or accounts. No LLM calls.
- No sub-daily time step, no state snapshots, no new dependencies.
- No mathematical-programming solver (reasons in ADR-015).
- No new industries.
- Inflation: the model stays in constant dollars; `annualRaiseRate` is a real raise.

## 6. Risks carried forward

- More mechanisms mean more illustrative parameters. Every new parameter defaults
  to "off", has `ParamMeta` with provenance, and is covered by the assumption probes.
- A richer model is easier to mis-calibrate. The demo company must pass the
  plausibility checks in implementation-contracts §7 before it is shown.
- The study multiplies simulation counts. The budget, the worker pool and the
  performance gates in implementation-contracts §8 bound this.
