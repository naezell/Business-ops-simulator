import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeEntry, goldenCases, type GoldenEntry } from './cases';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden.json', import.meta.url)), 'utf8'),
) as { generatedFrom: string; cases: Record<string, GoldenEntry> };

describe('golden master (IC §6): existing scenarios are bit-identical to the recorded engine', () => {
  const cases = goldenCases();

  it('golden.json covers exactly the case list', () => {
    expect(Object.keys(golden.cases).sort()).toEqual(cases.map((c) => c.key).sort());
  });

  for (const c of cases) {
    it(c.key, () => {
      const entry = computeEntry(c);
      // Old fields first: if this fails, existing behaviour changed.
      expect(entry.legacy, 'legacy projection changed').toBe(golden.cases[c.key].legacy);
      expect(entry.full, 'full result changed').toBe(golden.cases[c.key].full);
    });
  }
});
