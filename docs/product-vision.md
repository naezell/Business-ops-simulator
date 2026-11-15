# Product vision

## The user

The owner of a small field-service business. The first industry is landscaping:
a company with a few crews, a few trucks and a few hundred customers, most on
recurring weekly or biweekly plans. Later industries, in order: pool service, HVAC,
plumbing, electrical, commercial cleaning and pest control. The owner runs the
business day to day and decides, often without numbers, whether to add a crew, buy
a truck, raise prices or spend more on marketing.

## The central question

**What changes can I make to operate my business more efficiently and profitably?**

Every screen answers some part of this question. The product does not replace the
owner's books or dispatch board. It shows what would happen if a decision were made.

## Principles

1. **See the business operate.** Show jobs, crews, routes, backlog, cash and
   customers moving through time, not only a summary table.
2. **Clear cause and effect.** Every change the owner makes is traceable to the
   outcomes it produces. A difference between two scenarios is explained by the
   decision, not hidden in noise.
3. **Mathematically defensible numbers.** A deterministic engine produces every
   figure. The same inputs and seed always give the same outputs. Randomness is
   controlled so that comparisons between scenarios share the same random events.
4. **AI may explain, never calculate.** Language models, if used, may narrate
   results. They never produce, change or round a number.
5. **Honest labelling of assumptions.** Every number is one of four kinds:
   verified calculation (engine output), user-provided (entered by the owner),
   industry assumption (an illustrative default, not a verified benchmark), or
   synthetic demo (fabricated sample data). The interface never mixes them.
6. **No gamification.** No scores, badges, streaks or celebration. The goal is a
   correct picture of the business.
7. **Few screens, ready-made company.** The owner starts with a complete sample
   company and can change it, instead of building one from a blank form.

## Non-goals for v1

- An accounting system. The simulator reads and writes no ledgers; it models
  income, costs and cash to show how decisions change them.
- Dispatch software. Routes are simulated, not assigned to real people.
- Real-time GPS or live vehicle tracking.
- Tax advice. Income tax is out of scope; profit figures are pre-tax.
- Multi-user accounts, sync or a server. v1 runs in the browser.
