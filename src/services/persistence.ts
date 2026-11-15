/**
 * Versioned localStorage persistence. Tolerates missing, corrupt or outdated data by returning null;
 * the store then falls back to the freshly built sample company.
 *
 * Only decisions and edits are stored, never the company itself: the base company is rebuilt from
 * the industry pack, so improvements to the sample data are not hidden behind a stale copy.
 */
import type { PlannedAction } from '@/simulation';
import type { CompanyPatch } from './derive';

export const STORAGE_KEY = 'business-ops-simulator:state';
export const STORAGE_VERSION = 1;

export type ViewId = 'operations' | 'financials' | 'business' | 'optimize';
export const VIEW_IDS: ViewId[] = ['operations', 'financials', 'business', 'optimize'];

export interface PersistedState {
  version: typeof STORAGE_VERSION;
  industryId: string;
  seed: number;
  horizonMonths: number;
  /** Decisions already adopted into the baseline. */
  baselineActions: PlannedAction[];
  draftActions: PlannedAction[];
  /** Facts and assumptions the user edited, applied to baseline and draft alike. */
  patch: CompanyPatch;
  selectedDay: number;
  view: ViewId;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isPlannedAction(x: unknown): x is PlannedAction {
  return isObj(x) && isFiniteNum(x.day) && x.day >= 0 && isObj(x.action) && typeof x.action.type === 'string';
}

/** Returns validated state, or null when nothing usable is stored. */
export function loadPersisted(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isObj(data) || data.version !== STORAGE_VERSION) return null;
    if (typeof data.industryId !== 'string') return null;
    if (!isFiniteNum(data.seed) || !isFiniteNum(data.horizonMonths)) return null;
    if (!Array.isArray(data.baselineActions) || !data.baselineActions.every(isPlannedAction)) return null;
    if (!Array.isArray(data.draftActions) || !data.draftActions.every(isPlannedAction)) return null;
    if (!isObj(data.patch)) return null;
    const patch: CompanyPatch = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (!isFiniteNum(v)) return null;
      patch[k] = v;
    }
    const view = VIEW_IDS.includes(data.view as ViewId) ? (data.view as ViewId) : 'operations';
    return {
      version: STORAGE_VERSION,
      industryId: data.industryId,
      seed: data.seed,
      horizonMonths: data.horizonMonths,
      baselineActions: data.baselineActions,
      draftActions: data.draftActions,
      patch,
      selectedDay: isFiniteNum(data.selectedDay) ? Math.max(0, Math.floor(data.selectedDay)) : 0,
      view,
    };
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
