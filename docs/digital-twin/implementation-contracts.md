# Digital Twin — Implementation Contracts

Status: **normative**. Interfaces, integration boundaries, invariants and
acceptance criteria. Mathematical semantics live in `simulation-design.md` and
`optimization-design.md`; this document says where things go and how to know
they are right.

## 1. Module map (additions only)

```
src/simulation/
  types-twin.ts        CONTRACT (architect-owned) — merged into types.ts by task E3
  conditions.ts        shock multipliers, outages, forced absences/weather      (sim §2)
  rules.ts             observables, trailing windows, rule evaluation           (sim §9)
  dynamics.ts          learning, fatigue, pay/tenure hazards, referrals, aging  (sim §3–§5)
  scale.ts             scaleCustomerBase, theoreticalWeeklyCapacity             (sim §8)
  actions.ts           + dispose/replace/move/set-wage/drop-customers           (sim §6)
  dispatch.ts          + floating                                               (sim §7)
src/optimization/
  study-types.ts       CONTRACT (architect-owned)
  study/
    backend.ts         variant → scenario, canonical keys, in-process EvaluateBatch, digest
    budget.ts          cost accounting and phase reservations
    attribution.ts     loss attribution                                          (opt §3)
    capacity.ts        capacity experiment, break-even demand                    (opt §4)
    generate.ts        candidate generation (wraps candidates.ts + new families) (opt §5)
    refine.ts          timing search, price line search                          (opt §6)
    interactions.ts    pair screening                                            (opt §7)
    plans.ts           beam search over the pool                                 (opt §7)
    validate.ts        long-run, stress, assumption probes                       (opt §8)
    verdict.ts         verdict, score, caveats, Pareto set                       (opt §9)
    explain.ts         success/failure explanations (extends ../explain.ts)
    runStudy.ts        orchestration, progress, partial results
src/services/
  studyWorker.ts       worker: receives EvalJob[], returns RunDigest[]
  studyPool.ts         pool of N workers implementing EvaluateBatch; runStudy runs on the main
                       thread as an async orchestrator (it only awaits batches)
  playback.ts          pure reconstruction of intra-day positions from CrewDayLog (§9)   (Sonnet)
```

Dependency rules are unchanged (`tests/architecture`). `study/` imports only
from `src/simulation` and `src/optimization`. `studyPool.ts` is the only new
file that touches `Worker`.

## 2. Wiring `types-twin.ts` into `types.ts` (task E3, first engine step)

| Block in `types-twin.ts` | Merge into |
|---|---|
| `TwinOnlyAction` | add members to `Action` |
| `rules`, `shocks` | optional fields on `Scenario` |
| `WorkforceDynamics` | optional fields on `WorkforceParams` |
| `CustomerDynamics` | optional fields on `MarketParams` |
| `AssetAging` | optional field on `BreakdownParams` |
| `FloatPolicy` | optional field on `Policies` |
| `FinanceDynamics` | optional fields on `FinanceParams` |
| `IncomeStatementAdditions`, `CashFlowAdditions`, `OpsMetricsAdditions` | required fields (always present, 0 when unused) |
| `TwinSimEvent` | add members to `SimEvent` |
| `SimulationResultAdditions` | `years` required; `customerStats` optional |
| `CustomerStats`, `Shock`, `DecisionRule`, … | exported from `types.ts` |

After wiring, `types-twin.ts` re-exports from `types.ts` (so `study-types.ts`
keeps compiling) and `TwinScenario`/`TwinAction` become aliases of
`Scenario`/`Action`. New required statement fields change the JSON shape of
results: update every exhaustive consumer (`statements.ts` zero/sum helpers,
`DRIVER_LINES`, the UI's income table, `derive.ts` labels for new actions).

## 3. Engine acceptance criteria (each mechanism)

Common to all:
- **A. Off-by-default**: golden-master test (§6) unchanged with the fields absent.
- **B. Invariants**: `assertInvariants` (extended with the amended identities of
  sim §6, floating members never on two crews, disposed assets never used) passes
  on a scenario exercising the mechanism, every day, several seeds.
- **C. Determinism + CRN**: same scenario twice ⇒ deep-equal; unrelated draws unchanged.
- **D. Prefix identity**: two scenarios that differ only by an action, rule
  firing or shock starting on day `d` have deep-equal `DailyRecord`s for all days `< d`.
- **E. Formula tests**: every formula as an exported pure function with hand-calculated tests (`tests/unit`).
- **F. Validation**: `validateScenario` rejects dangling ids in rules/shocks, `toDay ≤ fromDay`, negative factors, unknown observables, `forEach` placeholders without `forEach`.
- **G. Performance**: benchmark in §8 not regressed by more than 10% with the mechanism off.

Specific:

| Mechanism | Must be demonstrated by a behaviour test |
|---|---|
| Shocks | Monotonicity property (sim §2); `fuel-price × 1.3` raises `fuel` by exactly 30% on a deterministic company; an outage of the only truck stops that crew for exactly the window; forced rainout days show `weather: 'rainout'` |
| Rules | A rule on `month` fires on the first day of that month only and respects `cooldownDays`/`maxFirings`; a `forEach: 'vehicle'` upkeep rule replaces only the vehicle that crosses the threshold; a rule-driven run equals the scripted run with the same actions on the firing days |
| Disposal / replacement | Hand-calculated proceeds, gain/loss, loan payoff; equity identity holds on the disposal day; replacing the crew's truck keeps the crew deployed next day |
| Owner distribution | Hand-calculated amount; identity 7 amended holds; none while the credit line is drawn |
| Fatigue | On a deterministic overloaded company, measured `h̄` and the resulting hazard multipliers match a hand calculation; 10-hour shifts raise quits versus 8-hour shifts over a year (several seeds) |
| Learning, raises, pay, tenure | Hand-calculated productivity and wage at given tenures; higher wage ⇒ fewer quits (CRN: quit set at high wage ⊆ quit set at low wage for day-0 employees while both are employed) |
| Referrals / saturation / tenure churn | Lead rate formula by hand; better service ⇒ more leads; `marketSize` reached ⇒ zero leads |
| Aging upkeep | Maintenance per mile at age 0 vs age 5 by hand |
| Floating | With one crew missing its truck and another short a member, completed jobs rise versus floating off; no employee appears in two crews' `memberIds` on one day |
| Scaling helpers | Nesting property; `m = 1` identity; clone ids/positions deterministic; theoretical capacity by hand on a small company |

## 4. Study acceptance criteria

- The thirteen known-answer tests of optimization-design §12.
- `runStudy` with the in-process backend is deterministic and independent of batch size.
- Each phase is independently testable: phase functions take `(context, evaluate)` and return plain data.
- `RunDigest` is produced by one function from a `SimulationResult` and is structured-cloneable (tested with `structuredClone`).
- The canonical variant key is stable under key order and array order where order is not semantic (shocks, patches) and sensitive where it is (actions, rules).
- Every `StrategyEvaluation` in `strategies` satisfies: drivers sum to mean Δ net profit; `feasible`; no rejected actions beyond the baseline's; `variant` re-simulated reproduces `deltaNetProfit` exactly.
- The old `optimize()` and its tests remain until task O9 removes or wraps it.

## 5. Worker pool contract

- `createStudyPool(size?)` → `{ evaluate: EvaluateBatch, terminate() }`; default size `min(4, max(1, hardwareConcurrency − 1))`.
- The base scenario and catalog are sent to each worker once (`init`), jobs afterwards carry only `key`, `variant`, `seed`.
- Each worker keeps its own draw cache and result cache; the pool keeps a key→digest cache so identical jobs are never sent twice.
- Jobs are distributed round-robin by index; results are returned in job order regardless of completion order.
- Cancelling: `terminate()` kills workers; pending promises reject with `AbortError`.
- No `SharedArrayBuffer`, no transferables required, no dependency.

## 6. Regression safety net (task E0 — before any engine change)

`tests/regression/golden-master.test.ts`: for the existing sample company and
the fixtures in `tests/fixtures/scenarios.ts`, seeds {1, 2, 3}, horizons {30, 365},
summary mode — a SHA-256 of the canonical JSON of the result is compared with
`tests/regression/golden.json`. The file is generated once from the current
engine (commit `25231bd`) by a script kept in the repo and must not be
regenerated to make a test pass. A change that legitimately alters results
(required statement fields) regenerates it in the *same commit* that makes the
change, with the reason in the commit message, and must show that only the new
fields differ (the test also compares a projection of the old fields).

## 7. Independent benchmark scenarios (validation of the model, not just the code)

Built as fixtures by Haiku (`tests/fixtures/benchmarks.ts`), asserted by Opus.
Each has an answer known without running the engine.

| Id | Scenario | Expected |
|---|---|---|
| B1 | Deterministic company; price +10%, all elasticities 0 | Revenue +10% on orders created after the change; costs unchanged; profit Δ = revenue Δ − bad debt Δ |
| B2 | Same; unit price elasticity for one-offs only | One-off revenue unchanged to first order (within the tolerance implied by integer order counts) |
| B3 | Crew at exactly full hand-computed capacity; add 10% customers | Missed jobs appear; revenue rises by less than 10% |
| B4 | Idle company; add a crew | Revenue unchanged; cost up by the crew's guaranteed pay, burden, lease/depreciation — hand-calculated |
| B5 | Buy an asset by cash vs loan vs lease | Same operations; profit differs by exactly depreciation+interest vs lease cost; cash differs by the schedules — hand-calculated |
| B6 | Dispose an asset at book value > salvage | Proceeds, loss, loan payoff by hand; equity change equals the loss |
| B7 | Hire at day 0 vs day 30 in a company with demand from day 45 and a 45-day ramp | Later hire has lower cost and equal revenue ⇒ strictly better; difference = 30 days of loaded pay (hand-calculated) |
| B8 | Shock `demand × 0.8` on the deterministic company | Recurring visits created fall by exactly the hand-computed count |
| B9 | Two identical scenarios, different seeds | Different draws, identical opening balances, identities hold |
| B10 | Scenario with every stochastic rate at 0 run for 3 years | Year 2 equals year 3 on every flow line when dynamics are off (stationarity) |
| B11 | Fatigue-only company, constant 50-hour weeks | `h̄`, fatigue index and hazard multiplier equal the hand values from day 28 |
| B12 | Owner distribution above X with constant positive cash flow | Month-end cash equals X after each distribution; cumulative distributions = cumulative net cash generated above X |

**Economic sanity properties** (property tests over several seeds, tolerance for stochastic noise stated in the test):
higher price ⇒ not more customers; more absence ⇒ not more completed jobs;
more breakdowns ⇒ not lower maintenance; higher fuel price ⇒ profit not higher;
an added idle resource ⇒ revenue not lower and cost not lower; an action applied
later ⇒ identical history before it.

## 8. Performance gates (`tests/benchmarks/performance.test.ts`, extended)

| Case | Gate (assert generously, report the real median) |
|---|---|
| Sample company, 365 days, summary, dynamics off | ≤ 30 ms median (unchanged) |
| Demo scenario, 90 days, summary, dynamics on | ≤ 12 ms median |
| Demo scenario, 3 years, summary | ≤ 150 ms median |
| Default study on the demo, in-process backend, single thread | report; target ≤ 120 s |
| Same in the browser with the pool (Playwright, reported in the PR) | ≤ 45 s; first ranked singles ≤ 8 s |

## 9. UI contracts (Sonnet)

- **Playback** (`src/services/playback.ts`, pure, unit-tested): given a
  `CrewDayLog` and a clock `t` (hours since shift start) return the crew's
  position and state. Between stops the crew moves in a straight line from the
  previous stop (or the depot) to the next, arriving at `stop.arrive`; it is on
  site until `stop.depart`; after the last stop it returns to the depot by
  `endClock`. States: `traveling | working | returning | idle | off`. Display
  time of day = configurable shift start (default 07:00) + `t`. This is a
  visual reconstruction of recorded results, not a simulation.
- **Plan timeline**: draft decisions carry a day. The store's draft becomes
  `{ actions: PlannedAction[]; rules: DecisionRule[] }`; chips show the date.
  Adopted baseline keeps its dated actions.
- **Conditions**: the store holds `shocks: Shock[]` applied to **both** baseline
  and draft (they describe the world, not a decision) — same rule as assumptions.
- **Study view**: consumes `StudyResult`/`StudyProgress` only; renders partial
  results per phase; "adopt" applies `strategy.variant.actions` and `.rules` to the draft.
- **Synthetic label**: any view showing results displays "Synthetic demonstration data" while the company is a built-in demo.
- No business arithmetic in the UI beyond differences, ratios and unit conversion of engine/study outputs.

## 10. Demo scenario contract (`src/business/landscaping/demoTwin.ts`)

`IndustryDefinition` gains optional `demoScenarios: { id; name; description; create(): Scenario }[]`.
The milestone demo, id `twin-90`:

- Start month March (`startMonth: 2`), 90 days, seed fixed.
- 20 employees: four maintenance crews of 3, one enhancement crew of 3, one
  installation crew of 3, two unassigned floaters; six vehicles, one per crew, no spare.
- 100 customers: 60 residential (`sizeFactor` 0.8–1.8), 30 commercial (3–8),
  10 large sites (10–18); positions by the existing deterministic cluster formula.
- Dynamics on: fatigue, learning, raises, pay- and tenure-sensitive turnover,
  referrals, market size, aging upkeep, floating; `minPaidHoursPerShift ≥ 6`.
- All new parameters have `ParamMeta` with provenance.

**Plausibility checks (calibration acceptance, mean of seeds 1–5):** net margin
3–10% over the 90 days; utilization 0.60–0.78; missed-job rate 2–6% with a
visible late-spring crunch; no shortfall day; lowest cash below the reserve at
least once; the study recommends strategies from at least three categories, at
least one with a start day > 0, and at least one finalist gets a `conditional`
verdict. If the last three cannot be met without contrived numbers, report what
the study finds instead of tuning further.
