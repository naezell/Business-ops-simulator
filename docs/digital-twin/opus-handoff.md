# Digital Twin — Opus Handoff

You (Opus) now lead this project. The architect's work for the digital twin is
finished and recorded in this folder; you should not need the architect again
for anything in the plan. Make ordinary engineering decisions yourself.

## 1. What exists and what does not

- **Exists and works** (PR #1, branch `claude/business-ops-simulator-arch-hxfhr1`,
  321 tests): daily engine, ledger, optimizer v1 (`optimize()`), four-view UI,
  one synthetic landscaping company.
- **Exists as design only**: everything in `docs/digital-twin/`, plus two
  contract files — `src/simulation/types-twin.ts` and
  `src/optimization/study-types.ts` — which compile but are not yet wired or implemented.
- Treat documentation as claims to verify, including these documents. If the
  code contradicts a document, find out which is right before building on it.

## 2. Read in this order

1. `architecture-assessment.md` — what is wrong today and why each change exists.
2. `simulation-design.md` — the mathematics to implement in the engine.
3. `optimization-design.md` — the study.
4. `implementation-contracts.md` — where code goes and the acceptance criteria.
5. `implementation-plan.md` — tasks, owners, order.
6. `architecture-decisions.md` — why alternatives were rejected (read when tempted to do otherwise).
7. Existing: `CLAUDE.md`, `docs/handoffs/opus-development-handoff.md` (clarifications 1–18 still apply).

## 3. How to run the work

- Work on a new branch based on `claude/business-ops-simulator-arch-hxfhr1`.
  One PR per milestone (M1–M5), each targeting the previous milestone's branch
  (the first targets `claude/business-ops-simulator-arch-hxfhr1`). Never merge,
  never deploy, never force-push.
- Delegate with the Agent tool: `frontend-engineer` (Sonnet) for every S task,
  `support-engineer` (Haiku) for every H task. Do the E, O and C tasks yourself
  or with a `lead-engineer` subagent. Run independent tasks in parallel when
  their files do not overlap (the plan's graph shows which).
- Each delegated task gets: scope, the design section, files owned, dependencies,
  deliverables, acceptance criteria, how to verify. Subagents do not commit; you
  verify (`npm run typecheck && npm test && npm run build`) and commit.
- Start with milestone M1: E0 yourself; H10, S7 and S8 in parallel.
- Keep `docs/development-roadmap.md` truthful: "done" means implemented, tested
  and committed. Never report a subagent's work as done without checking it.

## 4. Non-negotiable rules

1. **Off by default.** Every new mechanism is optional and leaves existing
   scenarios bit-identical. The golden master (E0) is created before the first engine edit.
2. **The equity identity** (amended in simulation-design §6) holds every day in every test scenario.
3. **Randomness**: scale thresholds or add streams; never reuse, reorder or shift a draw. Prefix identity is a test.
4. **The optimizer contains no business formulas.** Every reported number is a
   simulation output or arithmetic on simulation outputs. No LLM, no network call, anywhere in `src/`.
5. **Pairing**: a strategy is only ever compared with a baseline under identical shocks, patches, scale, horizon and seed.
6. **Tests assert independently derived expectations** — hand calculations or
   brute force inside the test — never snapshots of the code's own output
   (the golden master is the single, deliberate exception and guards compatibility only).
7. **Synthetic data is labelled synthetic**; assumptions are called illustrative; nothing is a forecast.
8. Do not weaken a failing test. If a test and a design document disagree, see §6.

## 5. Decisions you are expected to make without asking

Internal data structures and file splits; performance techniques; tolerance
constants; candidate lists and thresholds marked as defaults (keep them named
constants); explanation wording; UI layout; fixture details; test structure;
calibration numbers within IC §10; reordering tasks inside a milestone;
dropping to fewer finalists or a two-year long-run horizon to meet the
performance gates (record it in the roadmap).

Record every interpretation of an ambiguous sentence as a numbered
clarification at the end of this file (section 8), and fold it into the design
document when you next edit that section.

## 6. If a design document turns out to be wrong

Small errors (a formula that cannot satisfy an identity, a contradiction between
two sections, an impossible acceptance criterion): fix the document in the same
commit as the code, with a one-paragraph note in section 8 saying what was wrong
and what you chose. Prefer the reading that keeps the accounting identities,
determinism and pairing intact.

## 7. When to stop and ask for an architecture review

Only these. Bring a written question, the evidence, and the options you see.

- The daily time step or replay-branching proves inadequate for a required behaviour.
- An accounting identity cannot be made to hold after a serious attempt.
- The study gives rankings that the known-answer tests cannot pin down as right or wrong.
- A mechanism would need draws to be reused or reordered.
- A new optimization method beyond staged simulation search seems necessary.
- A change would break a contract in a way that ripples through engine, study and UI at once.
- A backend, accounts, or real customer financial data is about to be introduced.

Bugs, performance work, UI choices, calibration, new candidates, tests,
documentation and dependency updates are yours.

## 8. Clarifications adopted during implementation

(Opus: append here.)

1. **Golden master scope (E0).** Besides the sample company and the six fixtures,
   the net covers three `tests/simulation/scenarios.ts` scenarios (tiny deterministic,
   financed and leased, all actions) and three full-detail cases (crew logs are read
   by playback). The engine at `57b395c` is source-identical to `25231bd`.
2. **Playback travel legs (S7).** A leg is interpolated linearly over
   [previous `depart` (0 for the first leg), `arrive`]; the engine's `arrive` excludes
   stop overhead, so the on-site interval [`arrive`, `depart`) includes it.
3. **Day numbering in the UI (S8).** The timeline and scrubber show 1-based "Day N"
   (engine day N−1), consistent with the existing day scrubber.
4. **Demo dynamics before E3 (H10).** `demoTwin.ts` declares dynamics as typed
   constants spread into the company; its `ParamMeta` (`demoTwinParamMeta`) is kept
   separate from `landscapingParamMeta` because those paths do not exist on the
   sample company. H14 merges it.
5. **Shock monotonicity, "present in both runs" (E3).** Read as "eligible for the
   event in both runs that day": an active employee for quits and absences, an asset that
   is not already down for breakdowns. A breakdown makes an asset unavailable for days,
   so over a multi-day window a shocked run can skip a later base-run breakdown; the
   property is therefore tested on single-day windows for breakdowns and turnover, and
   over the whole horizon for absences (which have no upstream state).
6. **Shock edges and ids (E3).** `shock-started` is emitted on `fromDay`, `shock-ended`
   on `toDay` (when inside the horizon), ended before started on the same day. Outage
   and absence shocks must name assets/employees in the company config (validated);
   overlapping weather shocks: the last in array order wins. A `materials-cost` shock
   scales the materials booked on the day an order is first worked.
7. **Output fields computed at wiring time (E3).** `scheduledHours`,
   `completedLaborHours`, `quits` and `years` are required fields, so E3 computes them
   rather than leaving zeros for E8. `scheduledHours` counts active employees ×
   `shiftHours` on workdays before absence; `completedLaborHours` adds `o.remaining` on
   completion and `hours × rate` on a split.
8. **Performance (E3).** Sample benchmark median 27.2 ms → 28.2 ms with shocks
   absent (+4%, gate is 10%).
9. **Rules (E5).** `day` and `month` are today's values (so `month == m` fires on the
   first day of month m, as IC §3 requires); every other observable is end of previous
   day. `asset-age-years` is the age on the current day. Entities created by a firing get
   the tag `rule:{ruleId}[@{entity}]:{firingNumber}:{k}` (k = index in `then`, needed when
   a rule creates several entities) and the firing's random draws use `hash(tag)` as the
   draw index. Consequently "a rule-driven run equals the scripted run" holds exactly for
   actions that create no entities and draw nothing (tested with marketing spend); for
   hires and purchases the ids, and therefore the entities' draw keys, differ by design.
10. **Fatigue window (E6).** `n = min(28, day − max(hireDay, 0))` is not a whole number of
    weeks between days 7 and 27, so h̄ over-weights weekdays transiently (e.g. day 11 of an
    8-hour Mon–Fri schedule gives h̄ = 45.8). Implemented as written; from day 28 the
    window is four whole weeks. Tested by hand.
11. **Referral inputs (E6).** `N_active` and the mean failure score are measured at the
    start of the demand step (before today's failure decay and acquisitions). The
    new-customer churn boost applies to customers acquired during the run; day-0
    customers count as long-tenured even though their `acquiredDay` is 0.
12. **Workforce dynamics switch (E6).** Per-employee hazards, fatigue tracking and
    productivity multipliers run only when at least one of `fatigueThresholdHours`,
    `learningGain`, `wageQuitElasticity` or `earlyTenureQuitBoost` is set; otherwise the
    original single-hazard path is used (bit-identical). `annualRaiseRate` and
    `absenceFatigueWeight` act independently of that switch (the latter needs fatigue).
13. **B10 stationarity (H13).** "Year 2 equals year 3 on every flow line" holds exactly
    only for a setup that repeats every 364 days: 365-day years start on different
    weekdays, so with a 5-day week (or visit intervals that do not divide 7) travel and
    miles differ slightly between years, and with variable daily wages the 14-day pay
    cycle pays a different 364-day window. The benchmark uses 7 workdays, a 5-day visit
    interval and a guaranteed full shift; the measured differences of the other setups
    are recorded in `tests/fixtures/benchmarks.ts`.
14. **B7 hand value (H13).** "30 days of loaded pay" means the paid workdays in days
    0–29 (22 on a Mon–Fri week), i.e. 22 × 8 h × wage × (1 + burden).
15. **Study: one direct full-detail run (O6).** Candidate generation needs per-customer
    contribution (`drop-customers`), per-crew busy shares (`move-employee`, stress
    "truck-out") and per-month cancellations (temporary variants), which a `RunDigest`
    does not carry. The study runs one full-detail baseline in-process (charged 1 unit)
    instead of widening the digest contract.
16. **Study: replacement candidates (O6).** Only the age criterion (≥ 60% of useful life)
    is used; per-asset upkeep is not in the digest. The auto-replace rule's threshold is
    the catalog truck's annual straight-line depreciation (one value for all vehicles,
    since a `forEach` rule has one threshold). The move-employee candidate moves the
    weakest member of the least busy crew to the busiest crew (busy = (on site + travel) /
    paid from `crewStats`); unserved capacity is not attributed per crew.
17. **Study: loss bridge (O5).** Implements optimization-design §4.6 (scheduled → absence,
    not worked, idle, travel, productivity → completed), exact by construction; the
    theoretical figure is reported next to it, not bridged.
18. **Study: long-run check may be dropped (O8).** `StrategyEvaluation.validation.longRun`
    is `LongRunCheck | null` (additive widening of the contract; no consumer existed):
    null when the budget ran out before the multi-year check, with the caveat "Not
    validated long-run". Validation spends in two passes: stress + probes for finalists
    best-first, then long runs best-first. Singles reservation raised from ≈250 to 300.
19. **Study: synergy pairs** are screened on the screening seeds and re-evaluated on K
    seeds; the screening Δ of each member is recomputed on the same seeds, so
    `interaction` is Δab − Δa − Δb on identical seeds.
20. **C2 calibration of `twin-90` (numbers only, `demoTwin.ts`).** Changes from H10's first
    guesses: one-off arrival rates of the demo's job types × 1.3–2.5 (busier spring book),
    residential slot 4 weekly instead of biweekly (70/20/10 plan mix), wages × 1.25 (market
    reference wages likewise), overhead $10.7k → $23.2k/month (operations manager, full-time
    office, insurance, rent), starting cash $110k with a $30k reserve, overtime headroom
    0.5 h/day. Plausibility checks (mean of seeds 1–5): net margin 7.4% (3–10%),
    utilization 0.70 (0.60–0.78), missed-job rate 2.3% (2–6%) concentrated in weeks 9–12
    (late May), no shortfall day, cash below the reserve in 5 of 5 seeds — all met. Study
    (default request, in-process): 113 feasible strategies, recommendations in four
    categories (pricing, crew, staffing, equipment), a conditional finalist (mulch price
    rise, gain fades long-run) — met; **no recommended strategy starts after day 0** —
    not met. The study's best answer is to close one maintenance crew (with floating and the
    two floaters absorbing its work) plus a mulch price rise, which holds in the long-run
    and stress checks. Per IC §10 this is reported rather than tuned away.
21. **Scaling rank hash (ADR-018).** `r(x)` mixes FNV-1a through the murmur3 finalizer; plain
    FNV-1a clustered the demo's `c001…c100` ranks (0.6× and 0.8× kept the same 31 customers).
    On the calibrated demo the capacity curve is now monotone in customers (57/75/100/120 at
    0.6/0.8/1.0/1.2×), effective scale 1.15, profit-maximising grid scale 1.4×. Theoretical
    capacity counts crewed members' standard hours only, so scheduled person-hours (floaters
    included) can exceed it; the UI labels them separately. `tests/fixtures/study-result.json`
    stays the earlier recording (uncalibrated demo, old hash) — it is a UI test input, not a
    statement about the demo.
22. **O9 "retire or wrap `optimize()`".** Retired from the app: `simWorker.ts`, `runOptimization`
    and the store's `opt` state are removed; the Optimize view runs only `runStudyInPool`.
    `optimize()` stays exported from `src/optimization` with its known-answer tests, as a
    library function (the study does not call it). Browser performance (Playwright, production
    build, chromium, 4 cores, `twin-90`, default request): first ranked strategies 2.4 s,
    complete 4.9 s, no console errors (gates 8 s and 45 s).
