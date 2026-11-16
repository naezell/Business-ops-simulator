# Digital Twin — Implementation Plan

Who builds what, in what order. Opus leads and integrates; Sonnet builds the
interface; Haiku supplies data, fixtures, formula tests and documentation.
Status is tracked in `docs/development-roadmap.md` (section "Digital twin").

Every task below is specified by: the design section it implements, the files it
owns, what it depends on, and its acceptance criteria (by reference to
`implementation-contracts.md`, abbreviated IC). **Nothing in this plan has been
implemented yet** except the two contract files and the documents.

## Dependency graph

```
E0 ─► E3 ─► E4 ─► E5 ─┐
            E6 ───────┼─► E8 ─► O4 ─► O5 ─► O6 ─► O7 ─► O8 ─► O9
            E7 ───────┘                                   ▲
H10 ─────────────────────────────► C2 (calibration) ──────┘
S7, S8 (no engine dependency) ─► S9 (after E3) ─► S10 (after O4; mock until O8) ─► S11 ─► S12
H11 after E0 · H12 alongside E3–E7 · H13 before O5 · H14 after E3 · H15 continuous
```

Tasks in different columns of the same row may run in parallel; file ownership never overlaps.

## Opus — engine

| Id | Task | Implements | Files | Depends | Acceptance |
|---|---|---|---|---|---|
| E0 | Golden-master regression net | IC §6 | `tests/regression/**`, generator script in `scripts/` | — | Test green on untouched engine; file committed before any engine edit |
| E3 | Wire `types-twin.ts`; shocks | sim §1–§2, IC §2 | `types.ts`, `types-twin.ts`, `conditions.ts`, `engine.ts`, `demand.ts`, `workforce.ts`, `assets.ts`, `dispatch.ts`, `validate.ts`, statements helpers | E0 | IC §3 common A–G + "Shocks" row; B8 |
| E4 | New actions, disposal, replacement, owner distribution | sim §6 | `actions.ts`, `assets.ts`, `finance/*`, `engine.ts`, `project.ts`, invariants | E3 | IC §3 rows "Disposal", "Owner distribution"; B5, B6, B12 |
| E5 | Decision rules | sim §9 | `rules.ts`, `engine.ts`, `validate.ts` | E4 | IC §3 row "Rules" |
| E6 | Workforce, customer and asset dynamics | sim §3–§5 | `dynamics.ts`, `workforce.ts`, `demand.ts`, `assets.ts`, `dispatch.ts` (rate only) | E3 | IC §3 rows "Fatigue", "Learning…", "Referrals…", "Aging"; B10, B11 |
| E7 | Floating idle workers | sim §7 | `dispatch.ts` | E3 | IC §3 row "Floating" |
| E8 | Outputs and helpers: `years`, `customerStats`, `scheduledHours`, `completedLaborHours`, `quits`, `scaleCustomerBase`, `theoreticalWeeklyCapacity` | sim §8, types-twin §5–§6 | `engine.ts`, `scale.ts`, `index.ts` | E3 | IC §3 row "Scaling helpers"; summaries equal sums of days |

E6 and E7 may run in parallel with E4–E5 only if done by one agent sequentially per file; `dispatch.ts` and `engine.ts` are shared, so the safe order is E3 → E4 → E5 → E6 → E7 → E8.

## Opus — study

| Id | Task | Implements | Files | Depends | Acceptance |
|---|---|---|---|---|---|
| O4 | Evaluation backend, digest, canonical keys, budget; worker pool | opt §2, §10; IC §5 | `study/backend.ts`, `study/budget.ts`, `services/studyWorker.ts`, `services/studyPool.ts` | E8 | IC §4 (digest, keys); opt §12 tests 9, 10 |
| O5 | Loss attribution and capacity experiment | opt §3–§4 | `study/attribution.ts`, `study/capacity.ts` | O4 | opt §12 tests 7, 8 |
| O6 | Extended candidate generation; timing and price refinement | opt §5–§6 | `study/generate.ts`, `study/refine.ts` | O4, E5 | opt §12 test 1; B7 |
| O7 | Pair screening and plan search | opt §7 | `study/interactions.ts`, `study/plans.ts` | O6 | opt §12 test 2 |
| O8 | Validation, verdicts, Pareto set, explanations, `runStudy` | opt §8–§9, §11 | `study/validate.ts`, `study/verdict.ts`, `study/explain.ts`, `study/runStudy.ts` | O7 | opt §12 tests 3–6, 11–13; IC §4 |
| O9 | Integration: Optimize view on `runStudy`; retire or wrap `optimize()`; browser performance run | IC §8 | `services/simClient.ts`, review of Sonnet's S10 | O8, S10 | IC §8 gates; applying a strategy reproduces its Δ for the store seed |
| C2 | Calibrate the demo scenario | IC §10 | `src/business/landscaping/demoTwin.ts` (numbers only) | H10, E8 | IC §10 plausibility checks, reported honestly |

## Sonnet — interface

| Id | Task | Files | Depends | Acceptance |
|---|---|---|---|---|
| S7 | Time-of-day playback on the Operations map: clock scrubber within the selected day, crews moving along their routes, working/travelling/idle states, a per-day event feed (breakdowns, absences, quits, hires, cancellations, rule firings, shocks) with the money effect where the engine reports one | `services/playback.ts` (+ unit test in `tests/unit/playback.test.ts`), `components/**`, `pages/OperationsPage.tsx` | — | IC §9 playback contract; smooth at 60 fps with six crews; no re-simulation while scrubbing |
| S8 | Plan timeline: every decision has a date; a lane-per-category timeline in the Business view to add, drag and remove dated decisions; chips show dates; store draft = actions + rules | `services/store.ts`, `services/derive.ts`, `components/business/**` | — | A hire dated day 30 appears in the roster from day 30 in Operations; persistence migrates old saved drafts |
| S9 | Conditions panel (stress testing by hand): add/remove shocks from presets and custom windows; shown on the timeline; applied to baseline and draft | `components/conditions/**`, store | E3 | Fuel +30% changes the fuel line by 30% in Financials; removing it restores the numbers |
| S10 | Study view (replaces the Optimize page body): phases with progress and partial results; loss attribution; capacity curve with achievable vs theoretical and the loss bridge; ranked strategies with verdict, caveats, long-run / stress / assumption badges, trade-off (Pareto) markers, "adopt into draft"; counts of strategies and simulations | `pages/OptimizePage.tsx`, `components/optimize/**`, store | O4 for types; build against a recorded `StudyResult` fixture until O8 | IC §9; nothing rendered that is not in `StudyResult` |
| S11 | Multi-year and capacity views in Financials: yearly table from `years`, cash and customers over the long run, owner distributions | `pages/FinancialsPage.tsx`, components | E8 | Totals match `years` |
| S12 | Demo scenario switcher, "Synthetic demonstration data" label, rule editor (simple form over `DecisionRule`), polish and responsive pass | header, business components | H10, E5 | Label present on every results view; rules round-trip through persistence |

## Haiku — support

| Id | Task | Files | Depends | Acceptance |
|---|---|---|---|---|
| H10 | Demo scenario data per IC §10 (structure and first-guess numbers; Opus calibrates) | `src/business/landscaping/demoTwin.ts`, `index.ts` (register), `tests/unit/demo-twin-data.test.ts` | — | Integrity test (ids resolve, counts 20/6/100, deterministic); validates |
| H11 | Extend fixtures for the regression net | `tests/fixtures/**` | E0 | Builders validate and simulate |
| H12 | Hand-calculated unit tests for every new formula (shock multipliers, learning, fatigue, hazards, referrals, saturation, aging upkeep, disposal proceeds and gain, distribution) | `tests/unit/twin-*.test.ts` | the exported functions of E3–E7 | Expected values by hand in comments; discrepancies reported, not patched |
| H13 | Benchmark fixtures B1–B12 | `tests/fixtures/benchmarks.ts` | E3–E6 as needed | Each builder documented with the hand answer |
| H14 | `ParamMeta` for all new parameters; integrity test | `src/business/landscaping/paramMeta.ts`, data test | E3 | Every new numeric parameter covered; wording rules hold |
| H15 | Documentation upkeep: README status, `docs/data-model.md` for new types, roadmap table | docs | continuous | Matches the type files |

## Order of delivery (milestones)

1. **M1 — Safe to change**: E0, H10, S7, S8. (No engine behaviour change yet; playback and dated decisions already improve the product.)
2. **M2 — The world and reactions**: E3, E4, E5, S9, H12, H14.
3. **M3 — Long-run behaviour**: E6, E7, E8, S11, H13.
4. **M4 — The study**: O4–O8, S10, C2.
5. **M5 — Milestone demo**: O9, S12, browser performance report, PR.

One pull request per milestone, each dependent on the previous, each with test
results. Do not merge without the owner's approval.

## Not in this plan (later)

Real-data import and calibration against actuals; additional industries;
autocorrelated weather; lease termination fees; taxes; a better daily dispatch
policy (routing heuristics beyond `zoned`); optional natural-language narration.
