# Haiku task backlog — development support

Assigned model: **Haiku** (`.claude/agents/support-engineer.md`).
Status of each task is tracked in `docs/development-roadmap.md`.
Do the tasks in order unless told otherwise. Each task lists the only files you may create or change.

Done so far: H1 landscaping pack, H2 boundary test, H3 data-integrity test, H4 README / product vision / data-model guide.

---

## H5 — Formula-level unit tests  (P0, needs the engine's exported finance functions)

Files: `tests/unit/finance-*.test.ts` (new).
Dependencies: `src/simulation/index.ts` exports the pure functions (read it to see the exact names and signatures; do not edit it).

For each formula in `docs/financial-model.md` §1–§7 write at least three cases
with expected values worked out by hand in a comment (show the arithmetic) or
by an independent formula written inside the test:

- loan payment: e.g. 20,000 at 6%/yr over 48 months → 469.70 (2 dp); zero rate → principal / n; one month remaining.
- interest/principal split of the first two payments of that loan.
- opening book value: new asset; mid-life; older than useful life (= salvage).
- daily depreciation, and that it stops at salvage.
- weekly overtime premium: 38 h → 0; 40 h → 0; 46 h at $20 and multiplier 1.5 → 60.
- payroll burden.
- collection delay at jitter 0 and at the two extremes of `u`.
- line-of-credit step: draw when cash is negative, capped by the limit; repay when positive; shortfall beyond the limit.
- daily overhead / marketing / lease accrual: `monthly × 12 / 365`, and that 365 days sum to 12 months.
- lead rate with and without marketing; `spendScale = 0`.
- churn daily hazard: 30 days compound back to the monthly rate; clamp at 0.5.
- price index weighting.
- crew rate with coordination loss and ramp; travel time.

Acceptance: `npm run typecheck && npm test` pass. If a test fails and you
believe your hand calculation is right, do **not** change engine code or the
expected value — list it in your report with expected vs actual.

## H6 — Shared scenario fixtures  (P1)

Files: `tests/fixtures/*.ts` (new), `tests/unit/fixtures.test.ts` (new).

Builders returning valid `Scenario` objects (deterministic literals):
`emptyCompany()`, `soloOperator()` (one person, one truck, 10 customers),
`capacityBound()` (demand ≈ 2× one crew's capacity, cash-rich),
`demandBound()` (3 crews, 20 customers), `cashPoor()` (starting cash 500, no
credit line), `missingEquipment()` (customers demand a job type whose equipment
nobody owns), `allRatesZero(base)` (returns a copy with every stochastic rate
set to 0 — list in simulation-engine §3). Test: each passes `validateScenario`
with no errors and simulates 30 days without throwing.

## H7 — Parameter metadata for reliability  (P1)

Files: `src/business/landscaping/paramMeta.ts`, `tests/unit/landscaping-data.test.ts`.
Add `ParamMeta` entries for every numeric field under `reliability.vehicle` and
`reliability.equipment` (provenance `industry-assumption`, wording
"illustrative assumption"). Extend the integrity test to cover them.

## H8 — Second industry data pack: pool service  (P2, Phase 5 — only after Opus confirms the engine needs no change)

Files: `src/business/pool-service/**`, one line in `src/business/registry.ts`,
`tests/unit/pool-service-data.test.ts`.
Same structure as landscaping. Opus will supply the parameter table; do not invent engine features.

## H9 — Recurring upkeep  (ongoing)

- Keep `README.md` status and `docs/data-model.md` in line with the type files after each merged PR.
- Keep the status table in `docs/development-roadmap.md` current when asked.
- When a new `ParamMeta` path is added to the types, add its metadata and extend the integrity test.

## Rules that apply to every task

- Synthetic data only; never call a value a benchmark or an industry average.
- No `Math.random`, no dates.
- Never weaken a failing test; report it.
- Do not use git; the coordinating session commits.
