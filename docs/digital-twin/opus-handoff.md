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
