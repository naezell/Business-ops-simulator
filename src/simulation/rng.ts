/**
 * Counter-based randomness (ADR-003, simulation-engine §3).
 * Every draw is a pure function of (seed, stream, entityKey, day, index).
 */

export const STREAM = {
  WEATHER: 1,
  ABSENCE: 2,
  QUIT: 3,
  VEHICLE_BREAKDOWN: 4,
  EQUIPMENT_BREAKDOWN: 5,
  REPAIR: 6,
  ONEOFF_DEMAND: 7,
  LEADS: 8,
  CONVERSION: 9,
  NEW_CUSTOMER: 10,
  CHURN: 11,
  PRICE_SHOCK: 12,
  COLLECTION: 13,
  BAD_DEBT: 14,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/** 32-bit FNV-1a hash of a string (unsigned). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

/** murmur3 32-bit block mix. */
function mix(h: number, k: number): number {
  k = Math.imul(k | 0, 0xcc9e2d51);
  k = rotl(k, 15);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = rotl(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** murmur3 finalizer; returns an unsigned 32-bit integer. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform draw in [0, 1). */
export function rand01(seed: number, stream: number, key: number, day: number, index = 0): number {
  return rand01FromPrefix(randPrefix(seed, stream, key), day, index);
}

/**
 * Hash state after mixing (seed, stream, key). Performance helper for hot loops:
 * `rand01FromPrefix(randPrefix(s, st, k), d, i) === rand01(s, st, k, d, i)` bit for bit.
 */
export function randPrefix(seed: number, stream: number, key: number): number {
  let h = 0x9747b28c;
  h = mix(h, seed);
  h = mix(h, stream);
  return mix(h, key);
}

/** Completes a draw from a cached `randPrefix`. */
export function rand01FromPrefix(prefix: number, day: number, index = 0): number {
  let h = mix(prefix, day);
  h = mix(h, index);
  h ^= 20;
  return fmix(h) / 4294967296;
}

/** Poisson(lambda) by inverse transform from a single uniform. */
export function poissonInverse(lambda: number, u: number): number {
  if (!(lambda > 0)) return 0;
  let k = 0;
  let p = Math.exp(-lambda);
  let cdf = p;
  while (u >= cdf && k < 10000) {
    k += 1;
    p *= lambda / k;
    cdf += p;
    if (p === 0 && cdf < u) break; // underflow guard
  }
  return k;
}

/** Integer uniform in [min, max] (inclusive) from u ∈ [0,1). */
export function uniformInt(min: number, max: number, u: number): number {
  if (max <= min) return Math.round(min);
  const lo = Math.round(min);
  const hi = Math.round(max);
  return Math.min(hi, lo + Math.floor(u * (hi - lo + 1)));
}

/** Continuous uniform in [min, max) from u ∈ [0,1). */
export function uniformRange(min: number, max: number, u: number): number {
  return min + (max - min) * u;
}
