# Architecture

## Decision summary

| Topic | Decision | Why |
|---|---|---|
| Runtime | Client-only SPA: TypeScript, React 19, Vite | The whole product is a simulation the browser can run in milliseconds. A server would add cost and latency and no value yet (ADR-001). |
| Backend / DB | None in v1. Scenarios persist in `localStorage` behind `src/services/persistence.ts` | No accounts, no shared data yet. The persistence interface is the seam where a Cloudflare Worker + D1/Postgres goes later. |
| Deployment | Static build → Cloudflare Pages (free tier) | Owner already uses GitHub + Cloudflare. Not deployed without approval. |
| Engine | Pure TS, job-level daily discrete simulation (ADR-002) | Realistic interactions come from simulating individual jobs, crews and assets, not from formulas on averages. |
| Randomness | Counter-based hash RNG keyed by seed/stream/entity/day (ADR-003) | Reproducible, and comparisons between scenarios share random events, so differences are caused by the decision, not by luck. |
| Optimization | Simulation-based search: enumerate actions → paired multi-seed evaluation → beam search over combinations (ADR-004) | Works with every interaction the engine models; deterministic and testable; no solver dependency. |
| Money | JS floats in dollars, identities checked to 1e-6 (ADR-005) | Rates and stochastic draws make integer cents pointless; the balance-sheet identity catches drift. |
| Explanations | Deterministic templates over engine output. No LLM in the numeric path | "Mathematically verifiable" is a product requirement. An LLM may later narrate results but never produce them. |

## Module map

```
src/
  simulation/      Pure engine. Depends on nothing.
    types.ts         CONTRACT (architect-owned)
    rng.ts           rand01, hash, poisson
    calendar.ts      day → month / dayOfWeek / firstOfMonth
    finance/         one pure function per formula + ledger
    demand.ts        visits, one-offs, leads, churn
    workforce.ts     absences, quits, hiring, ramp
    assets.ts        breakdowns, depreciation, loans, acquisitions
    dispatch.ts      deployment, routing policies, clock
    actions.ts       apply Action to state
    validate.ts
    engine.ts        daily loop, records, summaries
    index.ts         public API: runSimulation, validateScenario
  optimization/    Depends on simulation only.
    types.ts         CONTRACT
    evaluate.ts      multi-seed paired runs, distributions
    bottlenecks.ts   diagnose from baseline results
    candidates.ts    action generators (take an IndustryDefinition-shaped catalog as data)
    constraints.ts   static + simulated feasibility
    search.ts        ranking + beam search
    explain.ts       drivers and template text
    optimize.ts      entry point
  business/        Industry packs: data + sample-company factory. Types only from simulation.
    types.ts         CONTRACT (IndustryDefinition)
    registry.ts      id → IndustryDefinition
    landscaping/
  services/        Glue; the only place that knows about workers and storage.
    studyWorker.ts   Web Worker pool member: simulates study batches     (Opus)
    studyPool.ts     Worker pool used by simClient.runStudyInPool          (Opus)
    simClient.ts     promise API over the worker                          (Opus)
    persistence.ts   load/save scenarios (localStorage)                   (Sonnet)
    store.ts         Zustand store: baseline, draft, results              (Sonnet)
  components/      Reusable React pieces (charts, map, controls, KPI tiles)
  pages/           Top-level views
tests/
  simulation/      engine behaviour + invariants
  benchmarks/      hand-calculated end-to-end expectations
  optimization/    known-answer scenarios
  unit/            formula-level tests
  architecture/    import-boundary tests
  fixtures/        scenario builders shared by tests
```

Dependency direction is strictly downward in this list:
`pages/components → services → optimization → simulation`, with `business`
depending only on simulation types. A test enforces it.

## Data flow

```
IndustryDefinition.createSampleCompany()
        │
        ▼
  Scenario (company + planned actions + seed + horizon)   ◄── user edits (store)
        │ runSimulation                       │ optimize
        ▼                                     ▼
  SimulationResult                    OptimizationResult
        │                                     │
        └────────── store ──► pages/components (format only)
```

The store holds two scenarios: **baseline** (the business as it is) and
**draft** (baseline + the user's changes). Both are simulated with the same
seed; the UI's before/after view is the difference of the two results.

## Industries

An industry is an `IndustryDefinition` (`src/business/types.ts`): job types,
equipment types, purchase catalog, hire templates, parameter metadata with
provenance, and a deterministic sample-company factory. The engine consumes only
`CompanyConfig`, into which the factory copies the job types, so users can edit
them. Adding pool service or HVAC means adding a folder under `src/business/`
and one registry line. Engine features an industry needs but landscaping does
not (e.g. emergency call-outs, parts inventory) are added as generic,
config-driven mechanics — see roadmap Phase 5.

## UI

Four views plus a persistent scenario bar. Detailed requirements are in
`docs/handoffs/sonnet-task-backlog.md`.

1. **Operations** — the business in motion: service-area map with customers and
   each crew's route for the selected day, a day scrubber with play, crew cards
   (hours, jobs, idle, blocked reasons), backlog and weather.
2. **Financials** — P&L, cash flow, cash balance vs. available cash, monthly table.
3. **Business** — edit crews, people, vehicles, equipment, pricing, policies, assumptions.
4. **Optimize** — bottlenecks, ranked recommendations with impact ranges, "apply to draft".

Scenario bar (always visible): baseline vs. draft KPIs with deltas, list of the
draft's changes, reset, and "make draft the new baseline".

## Performance budget

One 365-day run of the sample company: < 30 ms in summary mode. A default
optimization (≈ 40 candidates × 5 seeds + beam search): < 10 s, in a worker,
with progress. If budgets are exceeded, profile `dispatch.ts` first.

## Evolution path (not built)

- Real business data: import adapters produce a `CompanyConfig`; provenance flips to `user-provided`.
- Accounts/sync: Cloudflare Worker + D1 behind `persistence.ts`.
- LLM narration: reads `OptimizationResult`, writes prose, cannot alter numbers.
