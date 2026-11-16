# ADR-008 — One-off job demand responds to price
Status: accepted

**Context.** In the first optimizer run on the sample company, the best plan was "+20% on cleanup, mulch and installation" with zero customer loss, and every one-off price rise was pure profit up to the edge of the search grid. Cause: price affected only recurring demand (acquisition, churn, price shock). One-off job arrivals ignored price entirely — a modelling gap, not an insight.

**Decision.** Add `market.oneOffPriceElasticity` (optional, missing = 0). A one-off job type's daily arrival probability is multiplied by `P_j^(−elasticity)`, where `P_j` is its price multiplier. The random draw is unchanged, so a higher price removes a subset of the orders that would otherwise have occurred (monotone under common random numbers). The sample company uses an illustrative value, labelled `industry-assumption`.

**Consequences.** Price rises on one-off work now trade volume for margin, and the optimum depends on the elasticity — which is why such results are flagged `assumptionSensitive`. Existing scenarios without the field behave exactly as before. Still not modelled: a customer's recurring-plan churn reacting to one-off prices, and competitors' prices.

**Related, not decided here.** A three-year probe showed that the year-1 profit gain from a general price rise largely disappears in years 2–3 while the smaller customer base persists. A one-year horizon therefore overstates the durable benefit of customer-shedding actions. Mitigations in place: the `maxCustomerLossFraction` constraint and the `assumptionSensitive` flag. Proper fix (handoff task N10): evaluate customer-base-changing candidates over a longer horizon and report the later-year effect.
