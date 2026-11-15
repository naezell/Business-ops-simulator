/** The prefix-cached draw used in demand's hot loop must equal rand01 bit for bit. */
import { describe, expect, it } from 'vitest';
import { STREAM, hashString, rand01 } from '../../src/simulation';
import { rand01FromPrefix, randPrefix } from '../../src/simulation/rng';

describe('randPrefix / rand01FromPrefix', () => {
  it('reproduces rand01 exactly across seeds, streams, keys, days and indices', () => {
    const keys = [0, hashString('c001'), hashString('c190:mulch'), 0xffffffff | 0];
    for (const seed of [1, 7920, -3, 2 ** 31 - 1]) {
      for (const stream of [STREAM.ONEOFF_DEMAND, STREAM.CHURN, STREAM.WEATHER]) {
        for (const key of keys) {
          const p = randPrefix(seed, stream, key);
          for (const day of [0, 1, 180, 364, 1000]) {
            for (const index of [0, 1, 7]) {
              expect(rand01FromPrefix(p, day, index)).toBe(rand01(seed, stream, key, day, index));
            }
          }
        }
      }
    }
  });
});
