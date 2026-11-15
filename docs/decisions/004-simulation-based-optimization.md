# ADR-004 — Simulation-based optimization with beam search
Status: accepted

**Context.** Decisions interact non-linearly (capacity × demand × cash × reliability). A closed-form or LP/MIP model would need its own simplified physics, which could disagree with the simulator the user is looking at. Recommendations must be verifiable and must never violate resource or cash constraints.

**Decision.** The optimizer enumerates concrete actions, evaluates each by running the real simulator on paired seeds, filters by explicit constraints, ranks by mean objective gain, and combines actions with a small beam search. Explanations are templates over simulated P&L differences.

**Consequences.** One source of truth; every recommendation can be reproduced by applying its actions and pressing "simulate". Works automatically with any new engine mechanic. Costs: runtime grows with candidates × seeds (mitigated by screening and a worker); the result is the best of the generated actions, not a proven optimum; continuous variables (price) are searched on a grid.
