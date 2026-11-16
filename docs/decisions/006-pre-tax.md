# ADR-006 — Pre-tax model; taxes out of scope
Status: accepted

**Context.** Income tax depends on entity type, jurisdiction and owner circumstances; sales tax is a pass-through. Modelling them badly would undermine "mathematically defensible".

**Decision.** `netProfit` is pre-tax. Payroll taxes are included via `payrollBurdenRate`. Sales tax is ignored. The UI labels profit as "before income tax".

**Consequences.** Cash projections overstate what the owner keeps. Revisit when real-business data import is built.
