#!/usr/bin/env bash
# Regenerates tests/regression/golden.json from the current engine.
# Only allowed in the same commit as a change that legitimately alters results,
# with the reason in the commit message (implementation-contracts §6).
set -euo pipefail
cd "$(dirname "$0")/.."
GENERATE_GOLDEN=1 npx vitest run tests/regression/generate-golden.test.ts
