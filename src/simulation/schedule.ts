/**
 * Pre-drawn random draws (performance only; simulation-engine §5.2 and §5.4 semantics unchanged).
 *
 * §5.2 draws u = rand01(seed, ONEOFF_DEMAND, hash(customerId + ':' + jobTypeId), day, 0) for every
 * active customer, offered one-off type and day, and creates an order iff u < p. Because p is small,
 * almost every draw is wasted. A draw table lists, for the customers present at day 0, the days whose
 * draw is below a bound, with the exact draw value. For any p ≤ SCHEDULE_MAX_P, "u < p" holds exactly
 * on the listed entries whose stored u is below p, so the table gives bit-identical orders. A type
 * whose p exceeds SCHEDULE_MAX_P on a day, and customers acquired during the run, are drawn directly.
 * The churn table works the same way for the CHURN stream (§5.4), whose hazard is capped.
 *
 * Tables depend only on (seed, horizon, day-0 customer ids, one-off job types), not on any decision,
 * so a `DrawCache` shares them between runs (the optimizer simulates the same seeds many times).
 */
import type { DrawCache, Id } from './types';
import { STREAM, hashString, rand01FromPrefix, randPrefix } from './rng';

/** Highest daily one-off probability that may be served from a schedule. */
export const SCHEDULE_MAX_P = 0.02;

/** Implementation behind the opaque `DrawCache` contract type. */
export class DrawCacheImpl implements DrawCache {
  readonly kind = 'draw-cache' as const;
  readonly tables = new Map<string, DrawTable>();
  /** Tables kept before the cache is cleared (bounds memory for very long-lived caches). */
  static readonly MAX_TABLES = 64;
}

/**
 * Scheduled one-off draws of the customers present at day 0, for days [0, H), grouped by day:
 * entries start[d] … start[d+1]−1 belong to day d; entry k is customer index `cust[k]` (position in
 * the company's customer list) and job type index `jt[k]` with draw `us[k]` < SCHEDULE_MAX_P.
 */
export interface DrawTable {
  start: Int32Array;
  cust: Int32Array;
  jt: Int32Array;
  us: Float64Array;
}

/** One-off job types as (index, id) pairs, in job type order. */
export type OneOffTypeRef = { idx: number; id: Id };

/**
 * Every churn hazard is clamped to dailyHazardFromMonthly(0.5) ≈ 0.0228 (§5.4), so a churn draw at or
 * above this bound can never churn; the churn table keeps only draws below it.
 */
export const CHURN_SCHEDULE_MAX_U = 0.03;

/** Draws below `maxU` for the given (customer index, type index, prefix) streams over days [0, H), grouped by day. */
function buildTable(streams: { ci: number; ti: number; prefix: number }[], H: number, maxU: number): DrawTable {
  const day: number[] = [];
  const cust: number[] = [];
  const jt: number[] = [];
  const us: number[] = [];
  for (const { ci, ti, prefix } of streams) {
    for (let d = 0; d < H; d++) {
      const u = rand01FromPrefix(prefix, d, 0);
      if (u < maxU) {
        day.push(d);
        cust.push(ci);
        jt.push(ti);
        us.push(u);
      }
    }
  }
  // Counting sort by day (stable: within a day, entries keep stream order).
  const start = new Int32Array(H + 1);
  for (const d of day) start[d + 1] += 1;
  for (let d = 0; d < H; d++) start[d + 1] += start[d];
  const pos = start.slice(0, H);
  const n = day.length;
  const out: DrawTable = { start, cust: new Int32Array(n), jt: new Int32Array(n), us: new Float64Array(n) };
  for (let k = 0; k < n; k++) {
    const w = pos[day[k]]++;
    out.cust[w] = cust[k];
    out.jt[w] = jt[k];
    out.us[w] = us[k];
  }
  return out;
}

function cachedTable(cache: DrawCache | null | undefined, key: string, build: () => DrawTable): DrawTable {
  if (!(cache instanceof DrawCacheImpl)) return build();
  const hit = cache.tables.get(key);
  if (hit) return hit;
  const t = build();
  if (cache.tables.size >= DrawCacheImpl.MAX_TABLES) cache.tables.clear();
  cache.tables.set(key, t);
  return t;
}

/** The day-0 customers' one-off table (see DrawTable), shared through `cache` when given. */
export function initialOneOffTable(
  seed: number,
  customerIds: Id[],
  types: OneOffTypeRef[],
  H: number,
  cache: DrawCache | null | undefined,
): DrawTable {
  const horizon = Math.max(0, H);
  const key = ['oneoff', seed, horizon, types.map((t) => t.idx + ':' + t.id).join(','), customerIds.join('\u0000')].join('\u0001');
  return cachedTable(cache, key, () => {
    const streams: { ci: number; ti: number; prefix: number }[] = [];
    customerIds.forEach((id, ci) => {
      for (const t of types) streams.push({ ci, ti: t.idx, prefix: oneOffPrefix(seed, id, t.id) });
    });
    return buildTable(streams, horizon, SCHEDULE_MAX_P);
  });
}

/**
 * The day-0 customers' churn draws below CHURN_SCHEDULE_MAX_U (§5.4: CHURN stream, key hash(id),
 * index 0), grouped by day, in customer order within a day. `jt` is unused (0).
 */
export function initialChurnTable(seed: number, customerIds: Id[], H: number, cache: DrawCache | null | undefined): DrawTable {
  const horizon = Math.max(0, H);
  const key = ['churn', seed, horizon, customerIds.join('\u0000')].join('\u0001');
  return cachedTable(cache, key, () =>
    buildTable(
      customerIds.map((id, ci) => ({ ci, ti: 0, prefix: randPrefix(seed, STREAM.CHURN, hashString(id)) })),
      horizon,
      CHURN_SCHEDULE_MAX_U,
    ),
  );
}

/** Creates an empty cache to pass as `SimulationOptions.drawCache` to several runs. */
export function createDrawCache(): DrawCache {
  return new DrawCacheImpl();
}

/** The one-off draw prefix of (seed, customer, job type), §5.2. */
export function oneOffPrefix(seed: number, customerId: Id, jobTypeId: Id): number {
  return randPrefix(seed, STREAM.ONEOFF_DEMAND, hashString(customerId + ':' + jobTypeId));
}
