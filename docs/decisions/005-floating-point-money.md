# ADR-005 — Floating-point dollars with accounting identities
Status: accepted

**Context.** Integer cents avoid rounding drift but most amounts here are products of rates, hours and probabilities, so they are not integral anyway.

**Decision.** Use JS numbers in dollars. Never round inside the engine. Guard correctness with identities checked on every simulated day in tests (balance-sheet identity `Δequity = netProfit` to 1e-6 relative). Round only when formatting in the UI.

**Consequences.** Simple code; drift or double counting is caught by the identity tests rather than hidden by rounding.
