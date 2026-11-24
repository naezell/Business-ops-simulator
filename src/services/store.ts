/**
 * Application state (Zustand). Two scenarios are simulated with the same seed:
 *  - baseline: the business as it is (sample company + user edits to facts + adopted decisions)
 *  - draft:    baseline + the user's pending decisions
 * Decisions are PlannedActions; facts and assumptions patch the company for both scenarios.
 */
import { create } from 'zustand';
import { MONTH_LENGTHS, runSimulation, validateScenario } from '@/simulation';
import type { Action, CompanyConfig, PlannedAction, Scenario, Shock, SimulationResult, Provenance, ValidationIssue } from '@/simulation';
import { defaultIndustryId, getIndustry } from '@/business/registry';
import type { IndustryDefinition } from '@/business/types';
import { applyPatch, chipKey, type CompanyPatch } from './derive';
import type { Objective, StrategyEvaluation, StudyProgress, StudyResult } from '@/optimization';
import { catalogFromIndustry, runStudyInPool, type StudyHandle } from './simClient';
import { adoptPayload, mergeRules } from './studyAdopt';
import { STORAGE_VERSION, clearPersisted, loadPersisted, savePersisted, type CompanySource, type DraftPlan, type PersistedState, type ViewId } from './persistence';
import { clampDay } from './planTimeline';
import type { DecisionRule } from '@/simulation/types-twin';
import type { UserCompany } from './company-files';

export type { DraftPlan, ViewId } from './persistence';

export const HORIZON_OPTIONS = [3, 6, 12, 24, 36] as const;
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
  /** Id of the industry's demo scenario the company, start month, horizon and seed come from. */
  demoScenarioId: string | null;
  companySource: CompanySource;
  userCompany: UserCompany | null;
}

function coreOf(state: Core): Core {
  const { industryId, seed, horizonMonths, baselineActions, draft, patch, shocks, demoScenarioId, companySource, userCompany } = state;
  return { industryId, seed, horizonMonths, baselineActions, draft, patch, shocks, demoScenarioId, companySource, userCompany };
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

const demoCache = new Map<string, Scenario>();
/** The industry's demo scenario with this id (built once; never mutated), or null. */
export function demoScenarioOf(industry: IndustryDefinition, id: string | null): Scenario | null {
  if (!id) return null;
  const key = `${industry.id}/${id}`;
  let sc = demoCache.get(key);
  if (!sc) {
    const def = industry.demoScenarios?.find((d) => d.id === id);
    if (!def) return null;
    demoCache.set(key, (sc = def.create()));
  }
  return sc;
}

/** Company before user edits, from the active source. */
function baseCompany(industry: IndustryDefinition, core: Core): CompanyConfig {
  if (core.companySource === 'user' && core.userCompany) return core.userCompany.company;
  return demoScenarioOf(industry, core.demoScenarioId)?.company ?? sampleCompany(industry);
}

/** A demo scenario fixes its own horizon in days; otherwise the horizon is whole months from the start month. */
function horizonDaysOf(industry: IndustryDefinition, core: Core, company: CompanyConfig): number {
  return demoScenarioOf(industry, core.demoScenarioId)?.horizonDays ?? horizonDaysFor(company.startMonth, core.horizonMonths);
}

function buildScenarios(industry: IndustryDefinition, core: Core): { baseline: Scenario; draft: Scenario; company: CompanyConfig } {
  const demo = demoScenarioOf(industry, core.demoScenarioId);
  const company = applyPatch(baseCompany(industry, core), core.patch);
  const horizonDays = horizonDaysOf(industry, core, company);
  // The demo's own shocks, rules and actions are kept; whatever the user adds is appended.
  const shocks = [...(demo?.shocks ?? []), ...core.shocks];
  const demoRules = demo?.rules ?? [];
  const baseline: Scenario = {
    id: 'baseline',
    name: 'Baseline',
    company,
    actions: [...(demo?.actions ?? []), ...core.baselineActions],
    horizonDays,
    seed: core.seed,
    ...(shocks.length > 0 ? { shocks } : {}),
    ...(demoRules.length > 0 ? { rules: demoRules } : {}),
  };
  const rules = [...demoRules, ...core.draft.rules];
  const draft: Scenario = {
    ...baseline,
    id: 'draft',
    name: 'Draft',
    actions: [...baseline.actions, ...core.draft.actions],
    // User rules belong to the draft only; omitted when empty so results without rules are unchanged.
    ...(rules.length > 0 ? { rules } : {}),
  };
  return { baseline, draft, company };
}

/** Study state (optimizer v2). Lives in memory only. `result` is partial while running or after a cancel. */
export interface StudyState {
  status: 'idle' | 'running' | 'error';
  objective: Objective;
  /** Phase now running with its simulation counts (no partial payload). */
  progress: Omit<StudyProgress, 'partial'> | null;
  result: StudyResult | null;
  /** True while `result` is an intermediate or cancelled result rather than a finished study. */
  partial: boolean;
  resultKey: string | null;
  /** Strategy ids adopted into the draft from the current result. */
  appliedIds: string[];
  error: string | null;
}

const companyKeys = new WeakMap<CompanyConfig, number>();
let nextCompanyKey = 0;

/** Imported configs are immutable in the store. Avoid serializing their rosters during UI updates. */
function activeCompanyKey(s: Core): number | null {
  const company = s.companySource === 'user' ? s.userCompany?.company : undefined;
  if (!company) return null;
  const existing = companyKeys.get(company);
  if (existing !== undefined) return existing;
  const key = ++nextCompanyKey;
  companyKeys.set(company, key);
  return key;
}

/** Fingerprint of everything that changes what the optimizer would see. */
export function scenarioKey(s: Core): string {
  return JSON.stringify([s.industryId, s.demoScenarioId, activeCompanyKey(s), s.seed, s.horizonMonths, s.patch, s.shocks, s.baselineActions, s.draft]);
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
  study: StudyState;
  activeReviewId: string | null;

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
  applyGuidedDecision: (patch: CompanyPatch, action: Action) => void;
  startStudy: (objective: Objective) => void;
  cancelStudy: () => void;
  /** Applies a strategy's dated actions and rules to the draft (rules de-duplicated by id). */
  adoptStrategy: (strategy: StrategyEvaluation) => void;
  removeDraftAt: (index: number) => void;
  resetDraft: () => void;
  adoptDraft: () => void;
  setHorizonMonths: (m: number) => void;
  rerollSeed: () => void;
  setPatch: (path: string, value: number) => void;
  clearPatch: (path: string) => void;
  resetEverything: () => void;
  /**
   * Switches between the industry's sample company (null) and one of its demo scenarios. Takes the scenario's
   * company, start month, horizon and seed, and clears the draft, adopted decisions, edits, conditions and the
   * selected day (they refer to the previous company). Callers confirm first when something would be lost.
   */
  setDemoScenario: (id: string | null) => void;
  setUserCompany: (company: CompanyConfig, assumedPaths: string[]) => void;
  activateUserCompany: () => void;
  activateReview: (id: string, state: PersistedState) => void;
  setActiveReviewId: (id: string) => void;
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
  return { industryId, seed: DEFAULT_SEED, horizonMonths: 12, baselineActions: [], draft: { actions: [], rules: [] }, patch: {}, shocks: [], demoScenarioId: null, companySource: 'sample', userCompany: null };
}

/** Builds and simulates from a core; throws if the baseline cannot be simulated. */
function buildAll(core: Core): Built {
  const industry = getIndustry(core.industryId);
  const { baseline, draft, company } = buildScenarios(industry, core);
  const b = simulate(baseline);
  if (!b.result) throw new Error('Baseline could not be simulated: ' + b.issues.map((i) => i.message).join('; '));
  let d: Outcome;
  if (core.draft.actions.length === 0 && core.draft.rules.length === 0) d = { result: b.result, issues: b.issues };
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

function initial(): Built & { selectedDay: number; view: ViewId; activeReviewId?: string } {
  const stored = loadPersisted();
  if (stored) {
    try {
      const demoScenarioId = demoScenarioOf(getIndustry(stored.industryId), stored.demoScenarioId) ? stored.demoScenarioId : null;
      const core: Core = {
        industryId: stored.industryId,
        seed: stored.seed,
        horizonMonths: (HORIZON_OPTIONS as readonly number[]).includes(stored.horizonMonths) ? stored.horizonMonths : 12,
        baselineActions: stored.baselineActions,
        draft: stored.draft,
        patch: stored.patch,
        shocks: stored.shocks,
        // An id the industry no longer offers falls back to the sample company.
        demoScenarioId,
        companySource: stored.companySource === 'demo' && !demoScenarioId ? 'sample' : stored.companySource,
        userCompany: stored.userCompany,
      };
      const built = buildAll(core);
      // A draft that no longer simulates counts as unusable stored data.
      if (built.draftIssues.some((i) => i.severity === 'error')) throw new Error('stored draft invalid');
      return { ...built, selectedDay: stored.selectedDay, view: stored.view, activeReviewId: stored.activeReviewId };
    } catch {
      if (stored.userCompany) {
        try {
          const safeCore: Core = {
            ...freshCore(stored.userCompany.company.industryId), companySource: 'user', userCompany: stored.userCompany,
          };
          const built = buildAll(safeCore);
          savePersisted(persistenceSnapshot(safeCore, 0, stored.view));
          return { ...built, selectedDay: 0, view: stored.view };
        } catch {
          // Keep the saved import available for recovery even if this version cannot simulate it.
        }
      } else clearPersisted();
    }
  }
  const core = { ...freshCore(defaultIndustryId), userCompany: stored?.userCompany ?? null };
  return { ...buildAll(core), selectedDay: 0, view: 'operations' };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastBaselineKey = '';
let studyHandle: StudyHandle | null = null;

const baselineKeyOf = (c: Core) => JSON.stringify([c.industryId, c.demoScenarioId, activeCompanyKey(c), c.seed, c.horizonMonths, c.patch, c.shocks, c.baselineActions]);

export const useStore = create<AppState>()((set, get) => {
  const init = initial();
  lastBaselineKey = baselineKeyOf(init.core);

  /** Applies a core change immediately to the inputs and schedules the debounced re-simulation. */
  function commit(next: Partial<Core>, extra: Partial<AppState> = {}): void {
    const s = get();
    const core: Core = { ...coreOf(s), ...next };
    const industry = getIndustry(core.industryId);
    const company = applyPatch(baseCompany(industry, core), core.patch);
    const horizonDays = horizonDaysOf(industry, core, company);
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
    const core = coreOf(s);
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
    if (core.draft.actions.length === 0 && core.draft.rules.length === 0) {
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
    if (draftBroken && !baselineBroken && (core.draft.actions.length > 0 || core.draft.rules.length > 0) && (draftResult.seed !== core.seed || draftResult.horizonDays !== baselineResult.horizonDays)) {
      draftResult = baselineResult;
    }
    set({ baselineResult, draftResult, baselineIssues, draftIssues, pending: false });
  }

  function activateCompany(core: Core, requireStorage = false, review?: { id: string; selectedDay: number; view: ViewId }): void {
    const current = get();
    const built = buildAll(core);
    if (review && built.draftIssues.some((issue) => issue.severity === 'error')) {
      throw new Error('This review contains a plan that could not be simulated. Your current work is still open.');
    }
    const selectedDay = Math.min(review?.selectedDay ?? 0, built.baselineResult.horizonDays - 1);
    const view = review?.view ?? current.view;
    if (requireStorage && !savePersisted(persistenceSnapshot(core, selectedDay, view, review?.id))) {
      throw new Error(`This browser could not save the ${review ? 'working session' : 'company'}. Check that local storage is available and has room.`);
    }
    if (timer) clearTimeout(timer);
    timer = null;
    current.cancelStudy();
    lastBaselineKey = baselineKeyOf(core);
    set({
      ...core,
      industry: built.industry,
      company: built.company,
      horizonDays: built.baselineResult.horizonDays,
      draftActions: core.draft.actions,
      editedPaths: new Set(Object.keys(core.patch)),
      baselineResult: built.baselineResult,
      draftResult: built.draftResult,
      baselineIssues: built.baselineIssues,
      draftIssues: built.draftIssues,
      pending: false,
      selectedDay,
      view,
      activeReviewId: review?.id ?? null,
      study: { status: 'idle', objective: current.study.objective, progress: null, result: null, partial: false, resultKey: null, appliedIds: [], error: null },
    });
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
    activeReviewId: init.activeReviewId ?? null,
    study: { status: 'idle', objective: 'net-profit', progress: null, result: null, partial: false, resultKey: null, appliedIds: [], error: null },

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
      commit({ draft: { ...s0.draft, actions: list } }, candidateId ? { study: { ...s0.study, appliedIds: [...s0.study.appliedIds, candidateId] } } : {});
    },
    applyGuidedDecision: (patch, action) => {
      commit({ patch: { ...get().patch, ...patch }, draft: { actions: [{ day: 0, action }], rules: [] } });
    },
    startStudy: (objective) => {
      const s = get();
      if (s.study.status === 'running') return;
      const core = coreOf(s);
      const key = scenarioKey(core);
      // Same scenario the optimizer used: baseline plus pending decisions (and rules), with the store's shocks.
      const { draft } = buildScenarios(s.industry, core);
      let handle: StudyHandle;
      let lastPush = 0;
      const onProgress = (p: StudyProgress) => {
        if (studyHandle !== handle) return;
        const now = Date.now();
        const cur = get().study;
        // Partial results always arrive; plain counters are throttled.
        if (!p.partial && cur.progress && cur.progress.phase === p.phase && now - lastPush < 100) return;
        lastPush = now;
        const { partial, ...progress } = p;
        set({ study: { ...cur, progress, ...(partial ? { result: partial, partial: true, resultKey: key } : {}) } });
      };
      try {
        handle = runStudyInPool({ scenario: draft, catalog: catalogFromIndustry(s.industry), objective }, onProgress);
      } catch (e) {
        set({ study: { ...s.study, status: 'error', error: e instanceof Error ? e.message : String(e) } });
        return;
      }
      studyHandle = handle;
      set({ study: { status: 'running', objective, progress: { phase: 'baseline', completed: 0, total: 1 }, result: null, partial: false, resultKey: null, appliedIds: [], error: null } });
      handle.promise.then(
        (result) => {
          if (studyHandle !== handle) return;
          studyHandle = null;
          set({ study: { status: 'idle', objective, progress: null, result, partial: false, resultKey: key, appliedIds: [], error: null } });
        },
        (err: Error) => {
          if (studyHandle !== handle) return;
          studyHandle = null;
          const cancelled = err.name === 'AbortError';
          set({ study: { ...get().study, status: cancelled ? 'idle' : 'error', progress: null, error: cancelled ? null : err.message } });
        },
      );
    },
    cancelStudy: () => {
      const h = studyHandle;
      if (!h) return;
      studyHandle = null;
      h.cancel();
      // Keep whatever phases finished; the result stays marked partial.
      set({ study: { ...get().study, status: 'idle', progress: null, error: null } });
    },
    adoptStrategy: (strategy) => {
      const s0 = get();
      const { actions, rules } = adoptPayload(strategy);
      const list = s0.draft.actions.slice();
      for (const pa of actions) {
        const key = chipKey(pa.action);
        const at = key === null ? -1 : list.findIndex((p) => chipKey(p.action) === key);
        const day = clampDay(pa.day, s0.horizonDays);
        if (at >= 0) list[at] = { day, action: pa.action };
        else list.push({ day, action: pa.action });
      }
      commit({ draft: { actions: list, rules: mergeRules(s0.draft.rules, rules) } }, { study: { ...s0.study, appliedIds: [...s0.study.appliedIds, strategy.id] } });
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
      const s = get();
      activateCompany({ ...freshCore(s.industryId), userCompany: s.userCompany });
    },
    setDemoScenario: (id) => {
      const s = get();
      const demo = demoScenarioOf(s.industry, id);
      const target = demo ? id : null;
      if (target === s.demoScenarioId && s.companySource !== 'user') return;
      activateCompany({
        ...freshCore(s.industryId), companySource: demo ? 'demo' : 'sample', userCompany: s.userCompany,
        demoScenarioId: target, seed: demo?.seed ?? DEFAULT_SEED, horizonMonths: s.horizonMonths,
      });
    },
    setUserCompany: (company, assumedPaths) => {
      const userCompany = { company: structuredClone(company), assumedPaths: [...assumedPaths] };
      activateCompany({ ...freshCore(company.industryId), companySource: 'user', userCompany, horizonMonths: get().horizonMonths }, true);
    },
    activateUserCompany: () => {
      const s = get();
      if (!s.userCompany || s.companySource === 'user') return;
      activateCompany({
        ...freshCore(s.userCompany.company.industryId), companySource: 'user', userCompany: s.userCompany, horizonMonths: s.horizonMonths,
      });
    },
    activateReview: (id, state) => {
      const core = structuredClone(coreOf(state));
      if (core.companySource !== 'user') core.userCompany = get().userCompany;
      if (!HORIZON_OPTIONS.some((months) => months === core.horizonMonths) ||
          (core.companySource === 'demo' && !demoScenarioOf(getIndustry(core.industryId), core.demoScenarioId))) {
        throw new Error('This review’s company or time horizon is no longer available.');
      }
      activateCompany(core, true, { id, view: state.view, selectedDay: state.selectedDay });
    },
    setActiveReviewId: (id) => set({ activeReviewId: id }),
  };
});

function persistenceSnapshot(core: Core, selectedDay: number, view: ViewId, activeReviewId?: string | null): PersistedState {
  return { version: STORAGE_VERSION, ...coreOf(core), selectedDay, view, ...(activeReviewId ? { activeReviewId } : {}) };
}

/** Captures an independent copy of the current comparison, without simulation results. */
export function currentReviewSnapshot(s: AppState): PersistedState {
  const snapshot = persistenceSnapshot(s, s.selectedDay, s.view);
  if (snapshot.companySource !== 'user') snapshot.userCompany = null;
  return structuredClone(snapshot);
}

export function validateReviewSnapshot(s: AppState): void {
  const { baseline, draft } = buildScenarios(s.industry, coreOf(s));
  const issue = [...validateScenario(baseline), ...validateScenario(draft)].find((item) => item.severity === 'error');
  if (issue) throw new Error(`Fix the issue in this plan before saving the review. ${issue.message}`);
}

// Persist decisions and edits (debounced). An import also writes synchronously before activation.
useStore.subscribe((s) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => savePersisted(persistenceSnapshot(s, s.selectedDay, s.view, s.activeReviewId)), 250);
});

/** True when the draft differs from the baseline. */
export function selectHasDraft(s: AppState): boolean {
  return s.draft.actions.length > 0 || s.draft.rules.length > 0;
}

/** True when switching company sources would discard changes to the current scenario. */
export function selectHasUserWork(s: AppState): boolean {
  return selectHasDraft(s) || s.baselineActions.length > 0 || s.shocks.length > 0 || Object.keys(s.patch).length > 0;
}

/** Built-in company sources are demonstration data. */
export function selectIsSynthetic(s: Pick<AppState, 'companySource'>): boolean {
  return s.companySource !== 'user';
}

export function selectUneditedCompany(s: AppState): CompanyConfig {
  return baseCompany(s.industry, s);
}

export function selectCompanyProvenance(s: AppState, path: string, fallback: Provenance): Provenance {
  if (s.editedPaths.has(path)) return 'user-provided';
  if (s.companySource !== 'user') return fallback;
  return s.userCompany?.assumedPaths.includes(path) ? 'industry-assumption' : 'user-provided';
}

export function selectExportAssumedPaths(s: AppState): string[] {
  if (s.companySource !== 'user') return [];
  return s.userCompany?.assumedPaths.filter((path) => !s.editedPaths.has(path)) ?? [];
}

/**
 * Runs the engine's validator on the current scenario with `rules` as the draft's rules and returns only the
 * rule issues, with paths relative to `rules` (a demo scenario's own rules are not part of the list).
 */
export function validateRuleList(s: AppState, rules: DecisionRule[]): ValidationIssue[] {
  const core: Core = { ...coreOf(s), draft: { ...s.draft, rules } };
  const offset = demoScenarioOf(s.industry, s.demoScenarioId)?.rules?.length ?? 0;
  const out: ValidationIssue[] = [];
  for (const i of validateScenario(buildScenarios(s.industry, core).draft)) {
    const m = /^rules\[(\d+)\](.*)$/.exec(i.path);
    if (!m || Number(m[1]) < offset) continue;
    out.push({ ...i, path: `rules[${Number(m[1]) - offset}]${m[2]}` });
  }
  return out;
}
