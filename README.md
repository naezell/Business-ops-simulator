# Business Operations Simulator

An interactive simulator for field-service business owners. It lets an owner change
operational decisions (crews, people, vehicles, equipment, prices, policies, marketing)
and see the consequences over a simulated year, and it recommends which changes to
make first. Landscaping is the first industry; pool service, HVAC, plumbing, electrical,
commercial cleaning and pest control are planned.

All numbers come from a deterministic simulation engine. No language model computes
any figure. See [docs/product-vision.md](docs/product-vision.md).

## Status

**Pre-alpha.** The simulation engine, optimizer and user interface are under
construction. What exists today:

- Type contracts for the engine and industry packs (`src/simulation/types.ts`,
  `src/optimization/types.ts`, `src/business/types.ts`).
- The landscaping industry pack: job types, equipment and vehicle catalogs, hire
  templates and a synthetic sample company (`src/business/landscaping/`).
- Import-boundary and data-integrity tests.

Do not expect a working simulation, charts or recommendations yet.

## Running

Requires Node.js with npm.

```sh
npm install        # install dependencies
npm run dev        # Vite dev server
npm test           # Vitest, all suites
npm run typecheck  # tsc --noEmit
npm run build      # typecheck, then production build to dist/
```

## Repository layout

```
src/
  simulation/    Pure engine (planned). Depends on nothing else in the project.
  optimization/  Simulation-based search (planned). Depends on simulation only.
  business/      Industry packs: data plus a sample-company factory. Types only from simulation.
    landscaping/
  services/      Glue: web worker, persistence, store (planned).
  components/    React components (planned).
  pages/         Top-level views (planned).
tests/
  simulation/, optimization/, benchmarks/   Engine and optimizer tests (planned).
  unit/          Formula-level and data-integrity tests.
  architecture/  Import-boundary tests.
  fixtures/      Shared scenario builders (planned).
docs/            Architecture, specs, data model and product vision.
```

Dependencies point downward: `pages`/`components` → `services` → `optimization` →
`simulation`, with `business` depending only on simulation types.

## Documentation

- [docs/product-vision.md](docs/product-vision.md): who the product is for and what it must do.
- [docs/architecture.md](docs/architecture.md): module map, data flow and architecture rules.
- [docs/data-model.md](docs/data-model.md): the main entities and the provenance of numbers.
- [docs/simulation-engine.md](docs/simulation-engine.md) and [docs/financial-model.md](docs/financial-model.md): normative engine and financial specifications.
- [docs/optimization-engine.md](docs/optimization-engine.md): normative optimizer specification.
- [CLAUDE.md](CLAUDE.md): working rules for contributors and AI sessions.
