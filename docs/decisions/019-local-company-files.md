# ADR-019 — Versioned company files and local imports

Status: accepted

**Context.** The app previously rebuilt every company from an industry pack. The import requirement calls for a full company config, CSV support for larger rosters, and visible provenance for fields supplied by the importer or filled from industry assumptions.

**Decision.** The services layer owns company file version 1. Its JSON envelope has `version`, `company` and optional `assumedPaths`. The company uses the existing `CompanyConfig` contract. The two optional CSV files replace the complete `customers` or `employees` list in that JSON. Shape validation runs before engine validation, and errors in either block acceptance. A valid candidate can be reviewed with any engine warnings before activation.

Require the company identity, starting month, core operating lists and opening cash. Fill omitted operating parameters with illustrative defaults for the selected industry, and track their paths. Financial commitments such as overhead, credit limit and marketing spend default to empty or zero. Optional dynamics with no supplied value keep their existing engine semantics. A recurring schedule may specify up to 100 visits per customer per day at ordinary demand, so malformed ratios cannot create an unbounded accrual loop.

Export the active starting company including edits to company facts. Simulation actions, rules and shocks belong to the scenario and are outside this file format. Built-in companies retain their synthetic provenance when selected in the app. Their exported values become user-supplied inputs if re-imported. Exports from imported companies preserve default markers in `assumedPaths`, using dot paths relative to `company` with numeric indexes for list entries. When replacing one of these defaults in an exported file, remove its marker. The editor removes markers for edited values when exporting.

**Consequences.** Persistence version 5 migrates sample and demo sessions from version 4 and adds one locally saved company. Switching sources clears the current plan and retains the saved import for later activation. The import writes to localStorage before replacing the active company and reports blocked or full storage. Files and company records stay in the browser. The simulation and optimization contracts are unchanged.
