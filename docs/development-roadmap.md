# Development roadmap and status

Single source of truth for what exists. Update the tables in the same PR as the work.
Status values: **done** (implemented, tested, committed) · **in progress** · **planned** · **not started**.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, specs, contracts, ADRs, agents, project scaffold | done |
| 2 | First working landscaping simulation with editable variables and before/after comparison | done |
| 3 | Optimization: bottlenecks, candidates, constraints, ranking, plan search, explanations | done (engine and Optimize view) |
| 4 | Advanced operations | partly done — see below |
| 5 | Multi-industry | not started (architecture ready, one industry pack) |

Phase 4 detail: seasonal demand, weather, equipment and vehicle failures,
absenteeism, turnover with backfill, customer churn and acquisition, and
12-month planning are **done in the engine**. Not built: dated decisions in the
UI and optimizer (engine supports them), growth-strategy comparison, seasonal staffing plans.

## Digital twin (next programme of work)

Design complete; implementation **not started**. Documents: `docs/digital-twin/`.
Plan and task ids: `docs/digital-twin/implementation-plan.md`.

| Milestone | Tasks | Status |
|---|---|---|
| Design: assessment, simulation and optimization design, contracts, ADR-009…017, plan, handoff; contract files `types-twin.ts`, `study-types.ts` | — | done |
| M1 Safe to change | E0, H10, S7, S8 | not started |
| M2 The world and reactions | E3, E4, E5, S9, H12, H14 | not started |
| M3 Long-run behaviour | E6, E7, E8, S11, H13 | not started |
| M4 The study | O4–O8, S10, C2 | not started |
| M5 Milestone demo | O9, S12 | not started |

## Completed features

| Area | Feature | Tests |
|---|---|---|
| Engine | Daily job-level simulation: demand, dispatch (fifo / nearest / zoned), workforce, assets, actions, ledger | `tests/simulation`, `tests/benchmarks` |
| Engine | Accounting identities checked every simulated day | `tests/simulation/invariants*.ts` |
| Engine | Counter-based RNG, determinism, common random numbers | `tests/simulation/determinism.test.ts`, `rng-prefix.test.ts` |
| Engine | Hand-calculated end-to-end benchmarks (overtime week; loan + AR delay + split job) | `tests/benchmarks/deterministic-company.test.ts` |
| Engine | Edge cases: empty company, no crews/employees/vehicle, missing equipment, excess demand, unprofitable pricing, cash shortfall, forced breakdowns, total absence, total rainout, churn collapse, 1-day and mid-week horizons | `tests/simulation/edge-cases.test.ts` |
| Finance | Every formula as a pure function with hand-calculated tests | `tests/unit/finance-*.test.ts` |
| Optimizer | Paired multi-seed evaluation, screening, bottlenecks, candidates, constraints, ranking, beam search, drivers, template explanations | `tests/optimization` |
| Engine | One-off demand responds to price (ADR-008); sample company elasticity 1.5 (illustrative assumption) | `tests/simulation/oneoff-price.test.ts`, `tests/unit/finance-demand.test.ts` |
| Engine | Cross-run draw tables (`drawCache`) — about 20% faster default optimization (≈ 9 s in bundled Node on the E2 container), results unchanged | `tests/simulation/draw-cache.test.ts` |
| Data | Landscaping industry pack and calibrated synthetic sample company; parameter metadata with provenance | `tests/unit/landscaping-data.test.ts` |
| UI | App shell, scenario bar (baseline vs draft), Operations (map, routes, scrubber, crew cards, timeline), Financials (P&L, cash, bridge, job-type profitability), Business (decisions + assumptions with provenance) | browser-verified by Playwright script during development; no automated UI tests in the repo |
| Infra | Import-boundary test, Web Worker bridge for optimization | `tests/architecture`, `tests/optimization/worker-bridge.test.ts` |

## Active work

See the final section of the latest PR description and `docs/handoffs/*` for
the tasks in flight at hand-over time.

## Known issues and limitations

- Sample-company parameters are synthetic; elasticities, churn, breakdown and weather rates are illustrative assumptions. Outputs are scenarios, not forecasts.
- Finite horizon: actions that change the customer base have effects beyond the simulated year. The optimizer guards with `maxCustomerLossFraction` and flags `assumptionSensitive` results; it does not value the customer base explicitly.
- Optimizer search is heuristic (grid on prices, beam on combinations).
- Engine simplifications listed in `simulation-engine.md` §13 (no worker floating between crews, one depot, no PTO, no AP/inventory/tax, no asset disposal).
- Employees without a crew are paid the minimum shift every workday.
- UI: light theme only; no automated UI tests; single ~780 kB bundle (code-split Recharts later); Business view is long on phones.
- `src/services/derive.ts` mirrors engine action rules for display; replace with the engine's projection helper.
- Not deployed. No CI workflow yet.

## Outstanding tests

- Automated browser tests (Playwright) for the four views — currently verified manually by the frontend agent.
- Property-style test: random valid scenarios (generated from a seed) all satisfy the invariants.
- Statistical check of the RNG streams (uniformity, independence across entity keys).
- Optimizer regression snapshot on the sample company (top-N stability under refactors).
- Performance test for the optimizer in CI.

## Next recommended tasks

Engine/optimizer/integration: `docs/handoffs/opus-development-handoff.md` §5 (N1–N9).
Frontend: `docs/handoffs/sonnet-task-backlog.md` (S6 and "Later").
Support: `docs/handoffs/haiku-task-backlog.md` (H8, H9).
Additional: GitHub Actions workflow running typecheck, tests and build on every PR (Opus, small).
