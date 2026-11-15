# ADR-007 — Model delegation and file ownership
Status: accepted

**Context.** Architect-model capacity is scarce. Parallel agents editing the same files cause conflicts and silent overwrites.

**Decision.** Directory-level ownership: Opus — `src/simulation`, `src/optimization`, `src/services`, engine/optimizer tests; Sonnet — `src/components`, `src/pages`, app shell; Haiku — `src/business` data, fixtures, formula-level unit tests, non-normative docs. The architect owns the three `types.ts` contracts, the normative specs and ADRs. Agents are defined in `.claude/agents/` with explicit models. Cross-boundary needs go through the handoff documents, not through editing another owner's files. Agents do not commit; the coordinating session commits after running the full test suite.

**Consequences.** Work can proceed in parallel against stable contracts. The architect is needed only for contract or spec changes (see the escalation list in `docs/handoffs/opus-development-handoff.md`).
