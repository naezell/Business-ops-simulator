/**
 * Versioned localStorage persistence. Tolerates missing, corrupt or outdated data by returning null;
 * the store then falls back to the freshly built sample company.
 *
 * Only decisions and edits are stored, never the company itself: the base company is rebuilt from
 * the industry pack, so improvements to the sample data are not hidden behind a stale copy.
 */
import type { PlannedAction, Shock } from '@/simulation';
import type { DecisionRule } from '@/simulation/types-twin';
import type { CompanyPatch } from './derive';

export const STORAGE_KEY = 'business-ops-simulator:state';
export const STORAGE_VERSION = 4;

export type ViewId = 'operations' | 'financials' | 'business' | 'optimize';
export const VIEW_IDS: ViewId[] = ['operations', 'financials', 'business', 'optimize'];

/** Pending decisions: dated actions plus decision rules (rules are stored but not yet simulated). */
export interface DraftPlan {
  actions: PlannedAction[];
  rules: DecisionRule[];
}

export interface PersistedState {
  version: typeof STORAGE_VERSION;
  industryId: string;
  seed: number;
  horizonMonths: number;
  /** Decisions already adopted into the baseline (dated). */
  baselineActions: PlannedAction[];
  draft: DraftPlan;
  /** Facts and assumptions the user edited, applied to baseline and draft alike. */
  patch: CompanyPatch;
  /** Hypothetical conditions (shocks) applied to baseline and draft alike. Engine days are 0-based. */
  shocks: Shock[];
  /** Id of the industry's demo scenario in use, or null for the sample company. */
  demoScenarioId: string | null;
  selectedDay: number;
  view: ViewId;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isPlannedAction(x: unknown): x is PlannedAction {
  return isObj(x) && isFiniteNum(x.day) && x.day >= 0 && isObj(x.action) && typeof x.action.type === 'string';
}

function isRule(x: unknown): x is DecisionRule {
  return isObj(x) && typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.when) && Array.isArray(x.then);
}

const WEATHER = ['clear', 'partial', 'rainout'];
const isWindow = (x: Record<string, unknown>) => Number.isInteger(x.fromDay) && (x.fromDay as number) >= 0 && Number.isInteger(x.toDay) && (x.toDay as number) > (x.fromDay as number);

/** Structural check of a stored shock (ids are checked by the engine's validation when it is simulated). */
export function isShock(x: unknown): x is Shock {
  if (!isObj(x) || !isWindow(x)) return false;
  switch (x.type) {
    case 'multiplier':
      return typeof x.target === 'string' && isFiniteNum(x.factor) && x.factor >= 0;
    case 'outage':
      return typeof x.assetId === 'string';
    case 'absence':
      return Array.isArray(x.employeeIds) && x.employeeIds.every((i) => typeof i === 'string');
    case 'weather':
      return typeof x.state === 'string' && WEATHER.includes(x.state);
    default:
      return false;
  }
}

/**
 * Validates parsed storage data and upgrades older schema versions.
 *  - v1: `draftActions: PlannedAction[]`           -> v2: `draft: { actions, rules: [] }`
 *  - v2: no shocks                                  -> v3: `shocks: []`
 *  - v3: no demo scenario                           -> v4: `demoScenarioId: null`
 * Returns null for anything unusable (corrupt, unknown version).
 */
export function migratePersisted(data: unknown): PersistedState | null {
  if (!isObj(data)) return null;
  if (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== STORAGE_VERSION) return null;
  if (typeof data.industryId !== 'string') return null;
  if (!isFiniteNum(data.seed) || !isFiniteNum(data.horizonMonths)) return null;
  if (!Array.isArray(data.baselineActions) || !data.baselineActions.every(isPlannedAction)) return null;

  let draft: DraftPlan;
  if (data.version === 1) {
    if (!Array.isArray(data.draftActions) || !data.draftActions.every(isPlannedAction)) return null;
    draft = { actions: data.draftActions, rules: [] };
  } else {
    const d = data.draft;
    if (!isObj(d) || !Array.isArray(d.actions) || !d.actions.every(isPlannedAction)) return null;
    if (!Array.isArray(d.rules) || !d.rules.every(isRule)) return null;
    draft = { actions: d.actions, rules: d.rules };
  }

  if (!isObj(data.patch)) return null;
  const patch: CompanyPatch = {};
  for (const [k, v] of Object.entries(data.patch)) {
    if (!isFiniteNum(v)) return null;
    patch[k] = v;
  }
  let shocks: Shock[] = [];
  if (data.version === 3 || data.version === STORAGE_VERSION) {
    if (!Array.isArray(data.shocks) || !data.shocks.every(isShock)) return null;
    shocks = data.shocks;
  }
  const view = VIEW_IDS.includes(data.view as ViewId) ? (data.view as ViewId) : 'operations';
  return {
    version: STORAGE_VERSION,
    industryId: data.industryId,
    seed: data.seed,
    horizonMonths: data.horizonMonths,
    baselineActions: data.baselineActions,
    draft,
    patch,
    shocks,
    demoScenarioId: typeof data.demoScenarioId === 'string' && data.demoScenarioId !== '' ? data.demoScenarioId : null,
    selectedDay: isFiniteNum(data.selectedDay) ? Math.max(0, Math.floor(data.selectedDay)) : 0,
    view,
  };
}

/** Returns validated state, or null when nothing usable is stored. */
export function loadPersisted(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migratePersisted(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function savePersisted(state: PersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be full or blocked; the app keeps working without persistence.
  }
}

export function clearPersisted(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
