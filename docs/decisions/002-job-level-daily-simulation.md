# ADR-002 — Job-level daily discrete simulation
Status: accepted

**Context.** The owner must see realistic interactions: a crew adds cost immediately but revenue only if there is work, equipment and demand; a breakdown ripples into schedule, backlog, churn and cash. Formula models on averages (revenue = crews × jobs/day × price) cannot produce these effects and are the "simplistic formulas" the product must avoid. Minute-level discrete-event simulation would be more detailed but harder to explain, test and maintain.

**Decision.** Simulate every day; within a day, dispatch individual jobs to individual crews with travel, equipment, skill, weather and hours constraints. All aggregates are sums of those events.

**Consequences.** Bottlenecks and interactions emerge instead of being scripted. The same data drives the visual operations view. Cost: dispatch is the performance hot spot (budget in architecture.md) and the routing heuristics are simple by design — they model a small company's dispatching, not an optimal VRP solver.
