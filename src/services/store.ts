/**
 * Application state (Zustand). Two scenarios are simulated with the same seed:
 *  - baseline: the business as it is (sample company + user edits to facts + adopted decisions)
 *  - draft:    baseline + the user's pending decisions
 * Decisions are PlannedActions; facts and assumptions patch the company for both scenarios.
 */
import { create } from 'zustand';
import { MONTH_LENGTHS, runSimulation, validateScenario } from '@/simulation';
import type { Action, CompanyConfig, PlannedAction, Scenario, Shock, SimulationResult, ValidationIssue } from '@/simulation';
import { defaultIndustryId, getIndustry } from '@/business/registry';
import type { IndustryDefinition } from '@/business/types';
import { applyPatch, chipKey, type CompanyPatch } from './derive';
import type { Objective, OptimizationProgress, OptimizationResult } from '@/optimization';
import { catalogFromIndustry, runOptimization, type OptimizationHandle } from './simClient';
import { STORAGE_VERSION, clearPersisted, loadPersisted, savePersisted, type DraftPlan, type PersistedState, type ViewId } from './persistence';
import { clampDay } from './planTimeline';
import type { DecisionRule } from '@/simulation/types-twin';

export type { DraftPlan, ViewId } from './persistence';

export const HORIZON_OPTIONS = [3, 6, 12] as const;
export const DEFAULT_SEED = 20240101;
const DEBOUNCE_MS = 150;

export function horizonDaysFor(startMonth: number, months: number): number {
  let days = 0;
  for (let i = 0; i < months; i++) days += MONTH_LENGTHS[(startMonth + i) % 12];
  return days;
}

interface Core {
  industryId: string;
  seed: number;
  horizonMonths: number;
  baselineActions: PlannedAction[];
  /** Pending decisions: dated actions plus decision rules (rules are not simulated yet). */
  draft: DraftPlan;
  patch: CompanyPatch;
  /** Hypothetical conditions: describe the world, so they apply to baseline and draft alike. */
  shocks: Shock[];
}

interface Outcome {
  result: SimulationResult | null;
  issues: ValidationIssue[];
}

function simulate(scenario: Scenario): Outcome {
  try {
    const issues = validateScenario(scenario);
    if (issues.some((i) => i.severity === 'error')) return { result: null, issues };
    return { result: runSimulation(scenario, { detail: 'full' }), issues };
  } catch (e) {
    return { result: null, issues: [{ severity: 'error', path: 'simulation', message: e instanceof Error ? e.message : String(e) }] };
  }
}

const sampleCache = new Map<string, CompanyConfig>();
function sampleCompany(industry: IndustryDefinition): CompanyConfig {
  let c = sampleCache.get(industry.id);
  if (!c) sampleCache.set(industry.id, (c = industry.createSampleCompany()));
  return c;
}

function buildScenarios(industry: IndustryDefinition, core: Core): { baseline: Scenario; draft: Scenario; company: CompanyConfig } {
  const company = applyPatch(sampleCompany(industry), core.patch);
  const horizonDays = horizonDaysFor(company.startMonth, core.horizonMonths);
  const baseline: Scenario = {
    id: 'baseline',
    name: 'Baseline',
    company,
    actions: core.baselineActions,
    horizonDays,
    seed: core.seed,
    ...(core.shocks.length > 0 ? { shocks: core.shocks } : {}),
  };
  const draft: Scenario = { ...baseline, id: 'draft', name: 'Draft', actions: [...core.baselineActions, ...core.draft.actions] };
  return { baseline, draft, company };
}

/** Optimizer state. Lives in memory only (never persisted). */
export interface OptState {
  status: 'idle' | 'running' | 'error';
  /** Objective of the run in progress or the last run requested. */
  objective: Objective;
  progress: OptimizationProgress | null;
  result: OptimizationResult | null;
  /** Fingerprint of the scenario the result was computed for; compare with scenarioKey(state). */
  resultKey: string | null;
  /** Candidate ids the user applied from the current result. */
  appliedIds: string[];
  error: string | null;
}

/** Fingerprint of everything that changes what the optimizer would see. */
export function scenarioKey(s: Core): string {
  return JSON.stringify([s.industryId, s.seed, s.horizonMonths, s.patch, s.shocks, s.baselineActions, s.draft]);
}

export interface AppState extends Core {
  industry: IndustryDefinition;
  /** Company with user edits applied (before any actions). */
  company: CompanyConfig;
  horizonDays: number;
  /** Mirror of `draft.actions` for components that only need the dated actions. */
  draftActions: PlannedAction[];
  editedPaths: Set<string>;
  baselineResult: SimulationResult;
  draftResult: SimulationResult;
  baselineIssues: ValidationIssue[];
  draftIssues: ValidationIssue[];
  /** True between an edit and the debounced re-simulation finishing. */
  pending: boolean;
  selectedDay: number;
  view: ViewId;
  opt: OptState;

  setView: (v: ViewId) => void;
  setSelectedDay: (d: number) => void;
  /**
   * Adds a dated action as a chip, or replaces the chip with the same key (keeping its day unless `day` is given).
   * `day` is a simulation day, 0 = immediately; it is clamped to the horizon.
   */
  setDraftAction: (action: Action, day?: number) => void;
  /** Changes the day of the draft decision at `index` (clamped to the horizon). */
  moveDraftAction: (index: number, day: number) => void;
  /** Replaces the draft's decision rules (stored and persisted; not simulated yet). */
  setDraftRules: (rules: DecisionRule[]) => void;
  /** Adds a hypothetical condition (engine days, 0-based, window [fromDay, toDay)). */
  addShock: (shock: Shock) => void;
  updateShock: (index: number, shock: Shock) => void;
  removeShock: (index: number) => void;
  /** Removes the chip with the given key (no-op if absent). */
  removeDraftByKey: (key: string) => void;
  /** Appends several planned actions through the same de-duplication as chips. Used by the optimizer. */
  applyPlannedActions: (actions: PlannedAction[], candidateId?: string) => void;
  startOptimization: (objective: Objective) => void;
  cancelOptimization: () => void;
  removeDraftAt: (index: number) => void;
  resetDraft: () => void;
  adoptDraft: () => void;
  setHorizonMonths: (m: number) => void;
  rerollSeed: () => void;
  setPatch: (path: string, value: number) => void;
  clearPatch: (path: string) => void;
  resetEverything: () => void;
}

interface Built {
  industry: IndustryDefinition;
  core: Core;
  company: CompanyConfig;
  baselineResult: SimulationResult;
  draftResult: SimulationResult;
  baselineIssues: ValidationIssue[];
  draftIssues: ValidationIssue[];
}

function freshCore(industryId: string): Core {
  return { industryId, seed: DEFAULT_SEED, horizonMonths: 12, baselineActions: [], draft: { actions: [], rules: [] }, patch: {}, shocks: [] };
}

/** Builds and simulates from a core; throws if the baseline cannot be simulated. */
function buildAll(core: Core): Built {
  const industry = getIndustry(core.industryId);
  const { baseline, draft, company } = buildScenarios(industry, core);
  const b = simulate(baseline);
  if (!b.result) throw new Error('Baseline could not be simulated: ' + b.issues.map((i) => i.message).join('; '));
  let d: Outcome;
  if (core.draft.actions.length === 0) d = { result: b.result, issues: b.issues };
  else d = simulate(draft);
  return {
    industry,
    core,
    company,
    baselineResult: b.result,
    draftResult: d.result ?? b.result,
    baselineIssues: b.issues,
    draftIssues: d.issues,
  };
}

function initial(): Built & { selectedDay: number; view: ViewId } {
  const stored = loadPersisted();
  if (stored) {
    try {
      const core: Core = {
        industryId: stored.industryId,
        seed: stored.seed,
        horizonMonths: (HORIZON_OPTIONS as readonly number[]).includes(stored.horizonMonths) ? stored.horizonMonths : 12,
        baselineActions: stored.baselineActions,
        draft: stored.draft,
        patch: stored.patch,
        shocks: stored.shocks,
      };
      const built = buildAll(core);
      // A draft that no longer simulates counts as unusable stored data.
      if (built.draftIssues.some((i) => i.severity === 'error')) throw new Error('stored draft invalid');
      return { ...built, selectedDay: stored.selectedDay, view: stored.view };
    } catch {
      clearPersisted();
    }
  }
  return { ...buildAll(freshCore(defaultIndustryId)), selectedDay: 0, view: 'operations' };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastBaselineKey = '';
let optHandle: OptimizationHandle | null = null;

const baselineKeyOf = (c: Core) => JSON.stringify([c.industryId, c.seed, c.horizonMonths, c.patch, c.shocks, c.baselineActions]);

export const useStore = create<AppState>()((set, get) => {
  const init = initial();
  lastBaselineKey = baselineKeyOf(init.core);

  /** Applies a core change immediately to the inputs and schedules the debounced re-simulation. */
  function commit(next: Partial<Core>, extra: Partial<AppState> = {}): void {
    const s = get();
    const core: Core = {
      industryId: s.industryId,
      seed: s.seed,
      horizonMonths: s.horizonMonths,
      baselineActions: s.baselineActions,
      draft: s.draft,
      patch: s.patch,
      shocks: s.shocks,
      ...next,
    };
    const industry = getIndustry(core.industryId);
    const company = applyPatch(sampleCompany(industry), core.patch);
    const horizonDays = horizonDaysFor(company.startMonth, core.horizonMonths);
    // A shorter horizon pulls later decisions back to its last day so they stay valid.
    if (horizonDays !== s.horizonDays) {
      const fit = (list: PlannedAction[]) => (list.some((p) => p.day >= horizonDays) ? list.map((p) => ({ ...p, day: clampDay(p.day, horizonDays) })) : list);
      core.baselineActions = fit(core.baselineActions);
      core.draft = { ...core.draft, actions: fit(core.draft.actions) };
    }
    set({
      ...core,
      draftActions: core.draft.actions,
      company,
      horizonDays,
      editedPaths: new Set(Object.keys(core.patch)),
      selectedDay: Math.min(extra.selectedDay ?? s.selectedDay, horizonDays - 1),
      pending: true,
      ...extra,
    });
    if (timer) clearTimeout(timer);
    timer = setTimeout(runNow, DEBOUNCE_MS);
  }

  function runNow(): void {
    timer = null;
    const s = get();
    const core: Core = {
      industryId: s.industryId,
      seed: s.seed,
      horizonMonths: s.horizonMonths,
      baselineActions: s.baselineActions,
      draft: s.draft,
      patch: s.patch,
      shocks: s.shocks,
    };
    const industry = getIndustry(core.industryId);
    const { baseline, draft } = buildScenarios(industry, core);
    const key = baselineKeyOf(core);
    let baselineResult = s.baselineResult;
    let baselineIssues = s.baselineIssues;
    if (key !== lastBaselineKey || baselineIssues.some((i) => i.severity === 'error')) {
      const b = simulate(baseline);
      baselineIssues = b.issues;
      if (b.result) {
        baselineResult = b.result;
        lastBaselineKey = key;
      }
    }
    let draftResult = s.draftResult;
    let draftIssues: ValidationIssue[];
    if (core.draft.actions.length === 0) {
      draftResult = baselineResult;
      draftIssues = baselineIssues;
    } else {
      const d = simulate(draft);
      draftIssues = d.issues;
      if (d.result) draftResult = d.result;
    }
    const baselineBroken = baselineIssues.some((i) => i.severity === 'error');
    const draftBroken = draftIssues.some((i) => i.severity === 'error');
    // Never show a draft result computed from an older baseline than the one on screen.
    if (draftBroken && !baselineBroken && core.draft.actions.length > 0 && (draftResult.seed !== core.seed || draftResult.horizonDays !== baselineResult.horizonDays)) {
      draftResult = baselineResult;
    }
    set({ baselineResult, draftResult, baselineIssues, draftIssues, pending: false });
  }

  return {
    ...init.core,
    industry: init.industry,
    company: init.company,
    horizonDays: init.baselineResult.horizonDays,
    draftActions: init.core.draft.actions,
    editedPaths: new Set(Object.keys(init.core.patch)),
    baselineResult: init.baselineResult,
    draftResult: init.draftResult,
    baselineIssues: init.baselineIssues,
    draftIssues: init.draftIssues,
    pending: false,
    selectedDay: Math.min(init.selectedDay, init.baselineResult.horizonDays - 1),
    view: init.view,
    opt: { status: 'idle', objective: 'net-profit', progress: null, result: null, resultKey: null, appliedIds: [], error: null },

    setView: (view) => set({ view }),
    setSelectedDay: (d) => set((s) => ({ selectedDay: Math.max(0, Math.min(s.horizonDays - 1, Math.round(d))) })),

    setDraftAction: (action, day) => {
      const s0 = get();
      const key = chipKey(action);
      const list = s0.draft.actions.slice();
      const at = key === null ? -1 : list.findIndex((p) => chipKey(p.action) === key);
      const when = clampDay(day ?? (at >= 0 ? list[at].day : 0), s0.horizonDays);
      if (at >= 0) list[at] = { day: when, action };
      else list.push({ day: when, action });
      commit({ draft: { ...s0.draft, actions: list } });
    },
    moveDraftAction: (index, day) => {
      const s0 = get();
      const cur = s0.draft.actions[index];
      if (!cur) return;
      const when = clampDay(day, s0.horizonDays);
      if (when === cur.day) return;
      const list = s0.draft.actions.slice();
      list[index] = { ...cur, day: when };
      commit({ draft: { ...s0.draft, actions: list } });
    },
    setDraftRules: (rules) => commit({ draft: { ...get().draft, rules } }),
    addShock: (shock) => commit({ shocks: [...get().shocks, shock] }),
    updateShock: (index, shock) => {
      const list = get().shocks;
      if (!list[index]) return;
      commit({ shocks: list.map((x, i) => (i === index ? shock : x)) });
    },
    removeShock: (index) => commit({ shocks: get().shocks.filter((_, i) => i !== index) }),
    applyPlannedActions: (actions, candidateId) => {
      const s0 = get();
      const list = s0.draft.actions.slice();
      for (const pa of actions) {
        const key = chipKey(pa.action);
        const at = key === null ? -1 : list.findIndex((p) => chipKey(p.action) === key);
        const day = clampDay(pa.day, s0.horizonDays);
        if (at >= 0) list[at] = { day, action: pa.action };
        else list.push({ day, action: pa.action });
      }
      const opt = s0.opt;
      commit({ draft: { ...s0.draft, actions: list } }, candidateId ? { opt: { ...opt, appliedIds: [...opt.appliedIds, candidateId] } } : {});
    },
    startOptimization: (objective) => {
      const s = get();
      if (s.opt.status === 'running') return;
      const core: Core = {
        industryId: s.industryId,
        seed: s.seed,
        horizonMonths: s.horizonMonths,
        baselineActions: s.baselineActions,
        draft: s.draft,
        patch: s.patch,
        shocks: s.shocks,
      };
      const key = scenarioKey(core);
      // The optimizer improves the current draft: baseline plus pending decisions is the scenario it starts from.
      const { draft } = buildScenarios(s.industry, core);
      let handle: OptimizationHandle;
      let lastPush = 0;
      try {
        handle = runOptimization({ scenario: draft, catalog: catalogFromIndustry(s.industry), objective }, (p) => {
          const now = Date.now();
          const cur = get().opt.progress;
          if (cur && cur.phase === p.phase && now - lastPush < 100) return;
          lastPush = now;
          set({ opt: { ...get().opt, progress: p } });
        });
      } catch (e) {
        set({ opt: { ...s.opt, status: 'error', error: e instanceof Error ? e.message : String(e) } });
        return;
      }
      optHandle = handle;
      set({ opt: { ...s.opt, status: 'running', objective, progress: { phase: 'baseline', completed: 0, total: 1 }, error: null } });
      handle.promise.then(
        (result) => {
          if (optHandle !== handle) return;
          optHandle = null;
          set({ opt: { status: 'idle', objective, progress: null, result, resultKey: key, appliedIds: [], error: null } });
        },
        (err: Error) => {
          if (optHandle !== handle) return;
          optHandle = null;
          const cancelled = err.name === 'AbortError';
          set({ opt: { ...get().opt, status: cancelled ? 'idle' : 'error', progress: null, error: cancelled ? null : err.message } });
        },
      );
    },
    cancelOptimization: () => {
      const h = optHandle;
      if (!h) return;
      h.cancel();
    },
    removeDraftByKey: (key) => {
      const d = get().draft;
      const list = d.actions.filter((p) => chipKey(p.action) !== key);
      if (list.length !== d.actions.length) commit({ draft: { ...d, actions: list } });
    },
    removeDraftAt: (index) => commit({ draft: { ...get().draft, actions: get().draft.actions.filter((_, i) => i !== index) } }),
    resetDraft: () => commit({ draft: { actions: [], rules: [] } }),
    adoptDraft: () => {
      const s = get();
      if (s.draft.actions.length === 0) return;
      // Adopted decisions keep their dates.
      commit({ baselineActions: [...s.baselineActions, ...s.draft.actions], draft: { ...s.draft, actions: [] } });
    },
    setHorizonMonths: (m) => commit({ horizonMonths: m }),
    rerollSeed: () => commit({ seed: 1 + Math.floor(Math.random() * 999_999) }),
    setPatch: (path, value) => commit({ patch: { ...get().patch, [path]: value } }),
    clearPatch: (path) => {
      const patch = { ...get().patch };
      delete patch[path];
      commit({ patch });
    },
    resetEverything: () => {
      const c = freshCore(get().industryId);
      commit(c, { selectedDay: 0 });
    },
  };
});

// Persist decisions and edits (debounced).
useStore.subscribe((s) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const state: PersistedState = {
      version: STORAGE_VERSION,
      industryId: s.industryId,
      seed: s.seed,
      horizonMonths: s.horizonMonths,
      baselineActions: s.baselineActions,
      draft: s.draft,
      patch: s.patch,
      shocks: s.shocks,
      selectedDay: s.selectedDay,
      view: s.view,
    };
    savePersisted(state);
  }, 250);
});

/** True when the draft differs from the baseline. */
export function selectHasDraft(s: AppState): boolean {
  return s.draftActions.length > 0;
}
