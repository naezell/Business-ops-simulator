# Architecture Decision Records

One file per decision: `NNN-title.md` with Status, Context, Decision, Consequences.
Add a new ADR for any breaking change to a `types.ts` contract or a normative spec.

| # | Decision |
|---|---|
| 001 | Client-only SPA, no backend in v1 |
| 002 | Job-level daily discrete simulation |
| 003 | Counter-based random numbers |
| 004 | Simulation-based optimization with beam search |
| 005 | Floating-point dollars with accounting identities |
| 006 | Pre-tax model; taxes out of scope |
| 007 | Model delegation and file ownership |
| 008 | One-off job demand responds to price |

ADR-009 to ADR-017 (digital twin) are in [`../digital-twin/architecture-decisions.md`](../digital-twin/architecture-decisions.md):
daily step and replay branching (009), shocks (010), decision rules (011), workforce feedback (012),
simulated long-term customer value (013), disposal and owner distributions (014), staged study (015),
worker pool (016), capacity and loss by experiment (017).
