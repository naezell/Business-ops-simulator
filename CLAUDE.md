# Business Operations Simulator — instructions for Claude sessions

Interactive simulator that lets a field-service business owner (landscaping
first) change operational decisions and see the consequences, and that
recommends what to change first. Client-only SPA; all numbers come from a
deterministic engine, never from an LLM.

## Read before you change anything

| If you touch… | Read first |
|---|---|
| anything | `docs/architecture.md`, `docs/development-roadmap.md` (current status) |
| `src/simulation/` | `docs/simulation-engine.md`, `docs/financial-model.md` |
| `src/optimization/` | `docs/optimization-engine.md` |
| `src/business/` | `docs/data-model.md` |
| UI | `docs/handoffs/sonnet-task-backlog.md` |
| digital-twin work (shocks, rules, dynamics, the study, playback) | `docs/digital-twin/opus-handoff.md` and the documents it lists |

The spec documents are **normative**: code follows the docs. If a spec is wrong
or incomplete, change the doc in the same PR and add an ADR in `docs/decisions/`.

## Architecture rules (enforced by tests/architecture)

- `src/simulation/` — pure TypeScript engine. Imports nothing outside itself.
- `src/optimization/` — imports only from `src/simulation/`.
- `src/business/` — industry data and factories. Imports only types from `src/simulation/`.
- `src/services/` — glue (Web Worker, persistence, store). May import everything above.
- `src/components/`, `src/pages/` — React. Never compute business numbers here; call the engine and format the result.
- No `Math.random`, `Date.now`, or `new Date()` in simulation/optimization/business. All randomness goes through `rand01(seed, stream, key, day, index)`.
- `src/simulation/types.ts`, `src/simulation/types-twin.ts`, `src/optimization/types.ts`, `src/optimization/study-types.ts`, `src/business/types.ts` are contracts. Additive changes are fine; breaking changes need an ADR.
- Industry-specific behavior lives in `src/business/<industry>/` as data. Never write `if (industry === 'landscaping')` in the engine.

## Commands

```
npm run dev         # Vite dev server
npm test            # Vitest, all suites (must pass before every commit)
npm run typecheck   # tsc --noEmit (must pass before every commit)
npm run build       # typecheck + production build to dist/
```

## Testing requirements

- Every formula in `docs/financial-model.md` has a unit test whose expected values are computed by hand or by an independent formula in the test — never by calling the function under test or copying its body.
- Every engine change must keep `tests/simulation/invariants.test.ts` green (accounting identities + conservation, checked every simulated day).
- New stochastic behavior needs a determinism test and a common-random-numbers test.
- Every new engine mechanism is optional and off by default; `tests/regression/golden-master.test.ts` must stay green with it absent.
- Optimizer changes need a test with a scenario whose correct answer is known in advance.
- Do not weaken, skip or delete a failing test to get green. If a test is wrong, fix it and say why in the commit message.

## Number provenance

Four classes, never mixed up in the UI: verified calculation (engine output),
user-provided, industry assumption, synthetic demo data. Default parameter
values are illustrative assumptions — never describe them as benchmarks.

## Who does what

| Model | Agent file | Owns |
|---|---|---|
| Opus | `.claude/agents/lead-engineer.md` | `src/simulation`, `src/optimization`, `src/services/simWorker.ts` + `simClient.ts`, integration, calibration |
| Sonnet | `.claude/agents/frontend-engineer.md` | `src/components`, `src/pages`, `src/App.tsx`, styling, `src/services/store.ts` + `persistence.ts` + `format.ts` |
| Haiku | `.claude/agents/support-engineer.md` | `src/business/*` data, `tests/fixtures`, simple unit tests, docs upkeep |
| Fable (architect) | — | contracts, specs, ADRs; consulted only per `docs/digital-twin/opus-handoff.md` §7 |

One agent per file at a time. Backlogs: `docs/handoffs/`; current programme of work: `docs/digital-twin/implementation-plan.md`.
Opus leads: it delegates S tasks to `frontend-engineer`, H tasks to `support-engineer`, verifies their work and commits.

The application must run with no language model and no network call: simulation, optimization and explanations are deterministic code.

## Git workflow

- `main` stays stable; work on feature branches; open a PR with test results.
- Focused commits. Never force-push. Never merge or deploy without the owner's explicit approval.
- Update `docs/development-roadmap.md` (status table) in the same PR as the work.
