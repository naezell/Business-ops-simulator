/**
 * Writes tests/regression/golden.json. Skipped unless GENERATE_GOLDEN=1.
 * Run through scripts/generate-golden.sh only. Never regenerate to make a failing test pass
 * (implementation-contracts §6).
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { computeEntry, goldenCases, type GoldenEntry } from './cases';

it.skipIf(process.env.GENERATE_GOLDEN !== '1')('generate golden.json', () => {
  const cases: Record<string, GoldenEntry> = {};
  for (const c of goldenCases()) cases[c.key] = computeEntry(c);
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    /* not a git checkout */
  }
  const out = { generatedFrom: commit, cases };
  writeFileSync(fileURLToPath(new URL('./golden.json', import.meta.url)), JSON.stringify(out, null, 2) + '\n');
});
