# ADR-003 — Counter-based random numbers
Status: accepted

**Context.** Comparing "before" and "after" with a sequential PRNG is noisy: one extra draw (a new employee's absence roll) shifts every later draw, so the two runs see different weather and breakdowns and the difference is mostly luck.

**Decision.** Every random draw is a pure hash of `(seed, stream, entity, day, index)`. No generator state exists.

**Consequences.** Identical inputs give identical outputs regardless of evaluation order. Scenarios sharing a seed share all unrelated random events (common random numbers), so paired differences are low-variance and the optimizer needs few seeds. Requires stable entity ids, including deterministic ids for entities created mid-run. Statistical quality is that of a 32-bit mixing hash — adequate for this model, not for cryptography or very long streams.
