# ADR-001 — Client-only SPA, no backend in v1
Status: accepted

**Context.** The product is an interactive simulation. A year of the sample company simulates in milliseconds in a browser. There are no accounts, shared data or integrations yet, and infrastructure cost must stay near zero.

**Decision.** TypeScript + React + Vite, built to static files for Cloudflare Pages. No server, no database. Scenarios persist in `localStorage` behind `src/services/persistence.ts`. Heavy work (optimization) runs in a Web Worker.

**Consequences.** Zero hosting cost; instant feedback; works offline. No cross-device sync or multi-user until a backend is added — the persistence interface is the seam (Cloudflare Worker + D1, or Postgres if relational reporting is needed). Importing real business data will need either client-side file import or that backend.
