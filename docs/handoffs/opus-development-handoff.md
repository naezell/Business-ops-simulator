# Opus development handoff

You (Opus, `.claude/agents/lead-engineer.md`) are the primary implementation
coordinator from here on. This document plus the normative specs is everything
needed to continue without the architect. Current status of every item lives in
`docs/development-roadmap.md` — read it first, update it in every PR.

## 1. How the system fits together (five-minute version)

- `runSimulation(scenario)` is a pure function: a daily loop over individual
  jobs, crews, vehicles, equipment, customers and a ledger. Spec:
  `docs/simulation-engine.md` + `docs/financial-model.md`.
- Randomness is a hash of `(seed, stream, entity, day, index)`. Never introduce
  a sequential generator; never reuse a stream for a new purpose — add a stream.
- `optimize(request)` enumerates actions, simulates each against the baseline
  on paired seeds, filters by constraints, ranks, beam-searches combinations.
  Spec: `docs/optimization-engine.md`.
- Industries are data (`src/business/<id>/`). The engine never branches on industry.
- The UI holds a baseline and a draft (baseline + actions), simulates both with
  the same seed and shows differences. It formats; it does not calculate.

## 2. Working method

1. Pick the next task from §5 or the roadmap. Keep tasks to one PR-sized unit.
2. Delegate by ownership (CLAUDE.md table): UI → Sonnet backlog; data, fixtures,
   formula tests, doc upkeep → Haiku backlog. Give each delegated task: scope,
   files, dependencies, deliverables, acceptance criteria, tests. One owner per file at a time.
3. Subagents do not commit. You run `npm run typecheck && npm test && npm run build`, then commit focused changes.
4. Feature branch → PR with test results. Never merge or deploy without the owner's approval.
5. When behaviour changes, change the spec in the same PR. Breaking a `types.ts` contract or a spec rule needs an ADR.

## 3. Things that will bite you

- **The equity identity is the safety net.** Any new money flow must hit the
  income statement, the cash-flow statement and the balance sheet consistently,
  or `tests/simulation/invariants.ts` fails. Extend `assertInvariants` when you add a balance.
- **Common random numbers.** A new stochastic feature must key its draws by
  entity and day. Add a CRN test (unrelated draws unchanged when the scenario changes).
- **Hand-calculated benchmarks** in `tests/benchmarks/` encode the spec. If one
  fails after your change, either you broke the engine or you changed the spec:
  in the second case update the hand calculation and the spec together and say so in the commit.
- **Dispatch is the hot path.** Budget: a 365-day summary run of the sample
  company under ~30 ms. Re-measure (`tests/benchmarks/performance.test.ts`) after touching `dispatch.ts`.
- **The optimizer must never contain its own profit formulas.** If a
  recommendation needs a number, it comes from a simulation.
- **Calibration is not validation.** The sample company is tuned to look
  plausible; its parameters are synthetic. Never describe outputs as industry facts.

## 4. Spec clarifications adopted during implementation

These are the engine's actual behaviour where the spec was silent. Treat them
as part of the spec; fold them into `docs/simulation-engine.md` /
`financial-model.md` when you next edit those sections.

1. Float tolerances: visit accrual fires at `accrual ≥ 1 − 1e-9`; clock-fit comparisons allow 1e-9; a split needs `A ≥ 0.5 − 1e-9`.
2. The loan payment that takes `monthsRemaining` to 0 pays the whole remaining balance.
3. Loans created by an acquisition start paying on the first first-of-month strictly after the acquisition day.
4. Deployment check order: vehicle (→ `vehicle`), then members (→ `understaffed`). Crews that do not deploy do not borrow spares.
5. `crewDaysDeployed` counts crews that worked ≥ 1 order; `crewDaysNotDeployed` counts only `vehicle`/`understaffed` (not `no-work`/`weather`).
6. On a rainout every present member of a crew that did no work is paid `rainoutPaidHours`; employees with no crew are paid `minPaidHoursPerShift` even then.
7. Partial-day `weather` attribution applies only if some deployed crew was otherwise eligible and all such crews were past the start cutoff; otherwise later rules apply.
8. Price index with no plan customers = plain mean over offered recurring types. Price-shock δ = new/old − 1; a shock on a one-off type affects nobody.
9. Lead index `k` is shared by the conversion draw, the new-customer draws and the id `c-d{day}-{k}`; new customers start accruing the next day.
10. A one-off draw creates at most one order per customer, type and day.
11. A backfill fills on the first day ≥ quit day + `timeToFillDays`; it is dropped if its crew was removed. Id `{quitterId}~1`.
12. Turning a job type off withdraws pending and in-progress orders (`ops.jobsWithdrawn`).
13. Every kit item of a required type accrues the job's on-site hours.
14. `jobTypeStats.fuel` = equipment fuel + vehicle fuel of the inbound leg; labor uses on-site + inbound time at wage × (1 + burden).
15. Validation errors additionally cover: rates > 1 (absence, turnover, bad debt, jitter, down payment), assets without useful life, `mpg`/`avgSpeedMph` ≤ 0, `payPeriodDays` < 1, a customer plan that is not a recurring type, negative action days. Equipment-type ids cannot be validated because `CompanyConfig` carries no equipment-type list.
16. Additive contract fields: `OpsMetrics.jobsWithdrawn`, `CrewDayLog.equipmentIds`.
17. One-off price response (ADR-008, task E2): `oneOffDailyProbability(rate, seasonality, P, elasticity)`; the factor is exactly 1 (no multiplication) when the elasticity is missing/0, `P = 1`, or `P ≤ 0`/non-finite, so existing scenarios are bit-identical. Negative elasticities pass validation (as for the other `*Elasticity` fields) and simply raise arrivals with price.
18. Performance (E2, no behaviour change): the day-0 customers' one-off draws below `SCHEDULE_MAX_P = 0.02` and churn draws below `CHURN_SCHEDULE_MAX_U = 0.03` (≥ the clamped daily hazard 0.0228) are pre-computed into per-day tables (`src/simulation/schedule.ts`); a type whose p exceeds 0.02 on a day, and customers acquired during the run, are drawn directly. Additive contract: `SimulationOptions.drawCache` (`createDrawCache()`), which shares those tables between runs; the optimizer's `Evaluator` uses one per request. Results with and without the cache are bit-identical (tested).

Open modelling question for you (not urgent): employees with no crew are paid
the minimum shift every workday, including rainouts. Decide whether unassigned
staff should exist at all in the UI, or be flagged by validation.

## 5. Next tasks, in priority order

See the roadmap for status. Each is sized for one session.

| # | Task | Owner | Acceptance |
|---|---|---|---|
| N1 | Review and merge-ready the Optimize view (Sonnet S5) against the real optimizer | Opus review, Sonnet build | Applying a recommendation to the draft reproduces its Δ net profit (seed-0 value) in the scenario bar within rounding |
| N2 | Capacity-headroom probe: "how much more work can my crews take?" — scale the customer base (duplicate customers with deterministic offsets) and binary-search the largest multiplier keeping missed-job rate under the cap | Opus | Known-answer test on a one-crew deterministic company; result shown on the Optimize view |
| N3 | Dated plans: UI and optimizer support for actions on day > 0 (seasonal hiring, mid-year purchase). Engine already supports it | Opus + Sonnet | Optimizer candidate "hire for the season" (hire at day d₁, remove at day d₂) evaluated and explained |
| N4 | Asset replacement action (`replace-asset`): dispose at book value (gain/loss line), acquire new. Needs an ADR for the new income line | Opus | Equity identity holds; optimizer candidate for the oldest vehicle |
| N5 | Idle-worker floating between crews (roadmap "known simplifications") as a policy flag | Opus | Behaviour test: with one absence in crew A and an idle crew B member, completed jobs increase |
| N6 | Sensitivity panel: tornado of net profit to ±20% in each assumption (pure re-simulation) | Opus engine helper, Sonnet UI | Deterministic; flags which assumptions the recommendation depends on |
| N7 | Scenario import/export as JSON with schema version and validation | Opus | Round-trip test |
| N8 | Phase 5: second industry (pool service) as data only; list any engine mechanic it genuinely needs as generic, config-driven features (e.g. chemical consumables = materials; route-day commitments) | Opus spec → Haiku data | Landscaping results bit-identical before/after |
| N9 | Cloudflare Pages deployment config (`wrangler.toml` or Pages settings doc) — prepare only | Opus | Owner approval required before deploying |
| N10 | Longer-horizon check for customer-base-changing plans: re-evaluate recommended pricing / service-mix / marketing candidates at 2–3× the horizon and report the later-year Δ next to the in-horizon Δ (see ADR-008 "Related") | Opus, then Sonnet for display | Known-answer test where a price rise wins in year 1 and loses over 3 years is reported as such |

## 6. When to escalate to the architect (Fable)

Escalate only for decisions that change the foundations. Bring a written
question with options and evidence.

- A change that breaks a `types.ts` contract in a way that ripples across engine, optimizer and UI.
- Replacing the time model (sub-daily simulation) or the RNG scheme.
- A new optimization method (e.g. replacing beam search with a solver or adding stochastic programming), or evidence the optimizer ranks wrongly that tests cannot pin down.
- Introducing a backend, accounts, or real customer financial data (privacy, architecture and cost implications).
- Financial-model extensions with accounting judgement: taxes, inventory, accounts payable, asset disposal treatment, multi-entity.
- An accounting identity that cannot be made to hold after a serious attempt.
- Multi-industry mechanics that do not fit `JobTypeDef`/`CompanyConfig` without industry branches.

Do **not** escalate: bugs, performance tuning, UI decisions, new candidate
actions, calibration, tests, documentation, dependency upgrades, routine refactors.
