# ADR-009 — Customer-base scaling ranks use a mixed hash
Status: accepted

**Context.** simulation-design §8 defined the scaling rank as `r(x) = hashString(x) / 2³²` (FNV-1a). For short ids that differ only in their last characters (`c001 … c100`), FNV-1a's high bits barely change, so ranks cluster: on the demo, scales 0.6 and 0.8 both kept the same 31 customers, and the capacity curve's low end was flat. The intent of the rule — each customer kept with probability `m`, nested in `m` — was not met.

**Decision.** `r(x) = fmix32(hashString(x)) / 2³²`, where `fmix32` is the murmur3 finalizer already used by `rand01`. Nesting, identity at `m = 1` and the clone rule are unchanged.

**Consequences.** Scaled customer sets and capacity-experiment results change; the simulation itself, the golden master and every scenario without scaling are untouched. A test checks that the kept share tracks `m` on the demo's ids.
