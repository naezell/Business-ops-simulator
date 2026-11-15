# Sonnet task backlog — frontend

Assigned model: **Sonnet** (`.claude/agents/frontend-engineer.md`).
Status of each task is tracked in `docs/development-roadmap.md`.

## Ground rules for every task

- Files you own: `src/components/**`, `src/pages/**`, `src/App.tsx`, `src/main.tsx`,
  `src/index.css`, `src/services/store.ts`, `src/services/persistence.ts`, `src/services/format.ts`.
- You consume, never edit: `src/simulation`, `src/optimization`, `src/business`, `src/services/simClient.ts`, `src/services/simWorker.ts`.
- No business arithmetic in the UI beyond differences and percentages of engine outputs.
- Testing: `npm run typecheck && npm run build` pass; open the app in a browser
  (Playwright + Chromium are preinstalled) at 1440×900 and 390×844, exercise the
  feature, check the console is clean, and say exactly what you verified.
- Design language: calm, dense, professional — think a well-made operations tool,
  not a marketing page. One accent colour, semantic green/red only for
  better/worse, tabular numerals for money, no emoji, no gamification, no
  toasts for routine edits.

## State model (S1 builds it; everything else uses it)

`src/services/store.ts` (Zustand):

```
industry            IndustryDefinition
baseline            Scenario            // the business "as it is"
draftActions        PlannedAction[]     // user's changes, all at day 0 unless dated
draftCompanyPatch   edits to assumptions/parameters (applied to a copy of baseline.company)
baselineResult      SimulationResult    // detail 'full'
draftResult         SimulationResult    // detail 'full', same seed
selectedDay         number
editedPaths         Set<string>         // ParamMeta paths the user changed → provenance 'user-provided'
```

Two kinds of edits, do not mix them up:

- **Decisions** (hire, add crew, buy/lease, price, policies, marketing, service
  mix) are `Action`s appended to `draftActions`. This is what "before vs after" compares.
- **Facts/assumptions** (wage of an existing employee, churn rate, fuel price,
  starting cash, job durations) edit the company itself and apply to **both**
  baseline and draft, because they describe reality, not a decision.

Re-simulate (debounced ~150 ms) on any change: `runSimulation` from
`src/simulation` directly on the main thread (a run takes tens of ms).
Persist baseline company, draft actions and edited paths via `persistence.ts`
(localStorage, versioned key, tolerate corrupt/missing data).

---

## S1 — App shell, store, scenario bar  (P0)

Scope: store as above; app frame with four views (Operations, Financials,
Business, Optimize — Optimize may be a placeholder until S5); persistent
**scenario bar**.

Scenario bar: for Net profit, Revenue, Ending cash, Lowest cash, Jobs completed,
Missed-job rate, Utilization — baseline value, draft value, delta (colour by
better/worse, where "worse" for missed-job rate is higher). List of draft
changes as removable chips with human labels ("Hire crew member → Maintenance A",
"Prices +5%"). Buttons: Reset draft; Adopt draft as baseline (confirm). Horizon
selector (3 / 6 / 12 months) and seed control ("Re-roll conditions" + show seed).
Label profit "before income tax".

Dependencies: engine (`runSimulation`), landscaping pack.
Acceptance: app loads with the sample company already simulated — no setup
screens; adding/removing a chip updates all numbers; reload restores state.

## S2 — Operations view  (P0)

The "watch the business run" screen.

- **Service-area map** (SVG): depot at centre, customers as dots (colour by
  plan; faded if churned by the selected day; ring if acquired during the run),
  each deployed crew's route for the selected day as a coloured polyline in stop
  order from `crewLogs[day]`, incomplete (split) stops distinguishable. Hover/tap
  a stop: job type, revenue, arrive/depart.
- **Day scrubber** with play/pause (≈4 days/s), weekday + month label, weather
  icon/state, non-workdays visibly greyed.
- **Crew cards** for the selected day: deployed or reason not, members present /
  absent, vehicle, stops, hours bar (on-site / travel / idle against the shift,
  overtime marked), revenue.
- **Day strip**: jobs completed, backlog (jobs and hours), cancelled today, cash.
- **Timeline chart** over the horizon (weekly): jobs completed vs backlog hours,
  with event markers (breakdowns, quits, hires, cash shortfall) from `events`; clicking jumps the scrubber.
- Toggle baseline / draft; when draft differs, show the draft and mention the delta in the day strip.

Acceptance: scrubbing is smooth (no re-simulation on scrub); a day with a
vehicle breakdown visibly shows the affected crew not deployed with the reason.

## S3 — Financials view  (P0)

- KPI row: revenue, gross margin, operating profit, net profit, ending cash,
  **available cash** (with a one-line explanation of the difference between
  profit, cash and available cash — users confuse these).
- Monthly P&L chart (stacked costs vs revenue, profit line) and monthly table
  with the full `IncomeStatement` lines; baseline vs draft columns with deltas.
- Cash chart (daily): cash, available cash, line-of-credit balance; shade
  shortfall days; mark payroll days.
- Cash-flow bridge for the horizon: collections → payroll → operating costs →
  interest → capex → principal → LOC → net change.
- Job-type profitability table from `jobTypeStats` (revenue, labor, materials,
  fuel, contribution, margin, per on-site hour), sortable.

Acceptance: every number shown equals an engine field or a difference/ratio of
two; totals in the table match `totals`.

## S4 — Business view (edit the company)  (P0)

- **Crews & people**: crews with members (wage, skill, productivity, tenure),
  vehicle, kit. Decisions: hire from `hireTemplates` into a crew, remove
  employee, add standard crew (choose loan/lease), remove crew.
- **Fleet & equipment**: list with age, book value context, financing; acquire
  from catalog (cash / loan / lease, assign to crew or keep as spare).
- **Pricing & services**: global price slider (−20%…+30%), per-job-type
  multipliers, offered toggle.
- **Scheduling**: routing policy, shift hours, workdays, overtime cap.
- **Marketing**: monthly spend.
- **Assumptions** (collapsed by default): every `ParamMeta` entry grouped by
  section, with label, description, unit-aware input, bounds, **provenance
  badge** (Illustrative assumption / Synthetic demo data / Your data), and
  per-field reset. A short banner states that default values are illustrative and not verified industry figures.

Each decision control creates/updates exactly one chip in the scenario bar
(changing the price twice yields one price action, not two).

Acceptance: every `Action` type in the contract can be produced from this view;
no control requires more than two clicks from the view; works at 390 px.

## S5 — Optimize view  (P1, after the optimizer lands)

Uses `src/services/simClient.ts` (`runOptimization(request, onProgress)` →
Promise, cancellable).

- Run button, objective toggle (net profit / ending cash), progress bar by phase.
- **Bottlenecks**: ranked cards with headline, detail, severity bar, estimated
  annual impact labelled "estimate".
- **Recommendations**: ranked list — label, mean Δ objective, min–max range
  across seeds as a small range bar, probability of improvement, confidence,
  upfront cash, payback. Expand: explanation sentences, driver waterfall
  (`drivers`), utilization and missed-rate before/after. "Apply to draft" adds
  the candidate's actions as chips.
- **Best plan** card on top when `bestPlan` exists.
- **Not feasible** (collapsed): candidates with their reasons.
- A footer with the three honesty statements from optimization-engine §9.
- Results are marked stale when the baseline/draft changes after a run.

## S6 — Polish  (P2)

Responsive pass, keyboard access for scrubber and controls, empty states (no
crews, no customers), loading skeleton for optimization, print-friendly
financials, light/dark.

## Later

Industry switcher (Phase 5), dated actions UI (timeline of planned decisions),
scenario library (save/compare more than two), data import.
