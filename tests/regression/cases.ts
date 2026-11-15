/**
 * Golden-master regression net (digital twin task E0, implementation-contracts §6).
 *
 * A fixed list of scenarios × seeds × horizons, each simulated in summary mode and
 * reduced to a SHA-256 of canonical JSON (object keys sorted, arrays in order).
 * The expected hashes in golden.json were generated from the engine at commit 25231bd
 * by scripts/generate-golden.sh and must never be regenerated just to make a test pass.
 *
 * `legacy` hashes are taken after removing LATER_FIELDS (keys introduced after the golden
 * was first generated). When a change legitimately adds required result fields, add the
 * keys to LATER_FIELDS, regenerate in the same commit, and the legacy hashes must not move:
 * that proves only the new fields differ.
 */
import { createHash } from 'node:crypto';
import { runSimulation, type Scenario } from '../../src/simulation';
import { landscaping } from '../../src/business/landscaping';
import {
  capacityBound,
  cashPoor,
  demandBound,
  emptyCompany,
  missingEquipment,
  soloOperator,
} from '../fixtures/scenarios';
import { allActions, financedAndLeased, tinyDeterministic } from '../simulation/scenarios';

/** Result keys added after the golden master was first recorded (none yet). */
export const LATER_FIELDS: ReadonlySet<string> = new Set<string>([]);

export const SEEDS = [1, 2, 3] as const;
export const HORIZONS = [30, 365] as const;

function sample(): Scenario {
  return { id: 'sample', name: 'Sample company', company: landscaping.createSampleCompany(), actions: [], horizonDays: 365, seed: 1 };
}

/** Builders are called fresh for every case. Never edit an existing entry; append new ones. */
export const BUILDERS: Record<string, () => Scenario> = {
  sample,
  'fixture-empty': emptyCompany,
  'fixture-solo': soloOperator,
  'fixture-capacity-bound': capacityBound,
  'fixture-demand-bound': demandBound,
  'fixture-cash-poor': cashPoor,
  'fixture-missing-equipment': missingEquipment,
  'sim-tiny-deterministic': tinyDeterministic,
  'sim-financed-and-leased': financedAndLeased,
  'sim-all-actions': allActions,
};

export interface GoldenCase {
  key: string;
  build: () => Scenario;
  seed: number;
  horizonDays: number;
  detail: 'summary' | 'full';
}

/** A few full-detail cases also guard crew logs and customer snapshots (playback reads them). */
export const FULL_DETAIL_CASES: readonly string[] = ['sample', 'sim-tiny-deterministic', 'sim-all-actions'];

export function goldenCases(): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const [name, build] of Object.entries(BUILDERS)) {
    for (const seed of SEEDS) {
      for (const horizonDays of HORIZONS) {
        out.push({ key: `${name}|seed=${seed}|h=${horizonDays}`, build, seed, horizonDays, detail: 'summary' });
      }
    }
  }
  for (const name of FULL_DETAIL_CASES) {
    out.push({ key: `${name}|seed=1|h=30|full`, build: BUILDERS[name], seed: 1, horizonDays: 30, detail: 'full' });
  }
  return out;
}

/** Canonical JSON: sorted object keys, `undefined` members dropped, optional key filter. */
export function canonicalJson(value: unknown, dropKeys: ReadonlySet<string> = new Set()): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        if (dropKeys.has(k)) continue;
        const child = (v as Record<string, unknown>)[k];
        if (child === undefined) continue;
        out[k] = walk(child);
      }
      return out;
    }
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    return v;
  };
  return JSON.stringify(walk(value));
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface GoldenEntry {
  full: string;
  legacy: string;
}

export function computeEntry(c: GoldenCase): GoldenEntry {
  const scenario = { ...c.build(), seed: c.seed, horizonDays: c.horizonDays };
  const result = runSimulation(scenario, { detail: c.detail });
  return { full: sha256(canonicalJson(result)), legacy: sha256(canonicalJson(result, LATER_FIELDS)) };
}
