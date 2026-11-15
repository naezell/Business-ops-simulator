# Requests from frontend

Raised by the frontend engineer while building S1 to S4. None blocks the UI; each has a workaround in place.

1. **Apply actions to a company (engine helper).** The Business view shows the roster, fleet and policies after adopted and draft
   actions. `src/services/derive.ts` (`projectCompany`) re-implements the engine's action rules and id scheme
   (`h-d{day}-{index}-{k}`, `crew-d{day}-{index}`, `a-d{day}-{index}-{k}`) for display only. A pure `applyActions(company, actions)`
   export from `src/simulation` returning the day-0 company would remove that duplication and the risk of drift.
2. **Stable ids for hires made by auto-backfill.** Events reference employees created by backfill (`employee-hired`) whose names are not
   in the company. The UI shows "New hire". A name or a role on the event (or in `crewLogs`) would let Operations show who was hired.
3. **Day-level hours per crew.** Crew cards derive on-site, travel, idle and overtime hours from stop clocks (`arrive`, `depart`,
   `endClock`). On-site time therefore includes the per-stop setup overhead. Explicit `onSiteHours` / `travelHours` on `CrewDayLog`
   would make the bar exact.
4. **Shift start.** Stops are timed in hours since shift start; there is no clock time of day, so the UI says "into shift".
5. **Company persistence.** The UI persists only decisions and edits, rebuilding the base company from the industry pack. Data import
   (Phase 5) will need a persisted `CompanyConfig`; the storage format is versioned (`STORAGE_VERSION`) for that change.
