/**
 * Decision rules (digital-twin simulation-design §9): stored, deterministic "if this, then that".
 *
 * Evaluated each day after dated actions. Observables come from state as of the end of the
 * previous day (day 0: the opening state, trailing metrics 0), except `day` and `month`, which are
 * today's (so a `month == m` rule fires on the first day of that month). Rules read no random
 * draw and no future state, so a rule-driven run is exactly as reproducible as a scripted one.
 */
import type { Action, DailyRecord, DecisionRule, Id, Observable, RuleCondition } from './types';
import type { AssetS, DayCtx, SimState } from './state';
import { applyAction } from './actions';
import { assetAgeOnDay, isDown } from './assets';

// ───────────── Pure helpers ─────────────

export const OBSERVABLES: readonly Observable[] = [
  'day',
  'month',
  'cash',
  'available-cash',
  'backlog-hours',
  'active-customers',
  'active-employees',
  'missed-rate-28d',
  'utilization-28d',
  'idle-share-28d',
  'overtime-hours-28d',
  'crew-size',
  'asset-age-years',
  'asset-down-days-90d',
  'asset-upkeep-365d',
];

export const SCOPED_OBSERVABLES: ReadonlySet<Observable> = new Set(['crew-size', 'asset-age-years', 'asset-down-days-90d', 'asset-upkeep-365d']);

export const EACH = '$each';

/** a op b. */
export function compare(a: number, op: RuleCondition['op'], b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
  }
}

/** num / den, 0 when den is 0 (simulation-design §9). */
export function safeRatio(num: number, den: number): number {
  return den !== 0 ? num / den : 0;
}

/** Trailing-window sums over the last `n` records before `day` (records [day − n, day − 1], clipped at 0). */
export function trailing(days: DailyRecord[], day: number, n: number, pick: (d: DailyRecord) => number): number {
  let s = 0;
  for (let t = Math.max(0, day - n); t < day; t++) s += pick(days[t]);
  return s;
}

/** Deep copy of a value with every string equal to '$each' replaced by `id`. */
export function substituteEach<T>(value: T, id: Id): T {
  const walk = (v: unknown): unknown => {
    if (v === EACH) return id;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** True if '$each' occurs anywhere in the value. */
export function mentionsEach(value: unknown): boolean {
  if (value === EACH) return true;
  if (Array.isArray(value)) return value.some(mentionsEach);
  if (value !== null && typeof value === 'object') return Object.values(value).some(mentionsEach);
  return false;
}

// ───────────── Engine state ─────────────

interface InstanceState {
  firings: number;
  lastDay: number;
}

export interface RulesState {
  rules: DecisionRule[];
  /** key `${ruleIndex}|${entityId}` (entityId '' without forEach). */
  instances: Map<string, InstanceState>;
  /** Per-asset tracking needed by asset observables. */
  trackAssets: boolean;
  /** Opening values for day-0 observables. */
  opening: { activeCustomers: number; activeEmployees: number };
}

export function initRules(rules: DecisionRule[] | undefined, opening: RulesState['opening']): RulesState | null {
  if (!rules || rules.length === 0) return null;
  const trackAssets = rules.some((r) => r.when.some((c) => c.observable === 'asset-down-days-90d' || c.observable === 'asset-upkeep-365d'));
  return { rules: structuredClone(rules), instances: new Map(), trackAssets, opening };
}

/** Routine maintenance or repair cost booked to an asset today (only kept when a rule needs it). */
export function bookUpkeep(st: SimState, a: AssetS, day: number, amount: number): void {
  if (!st.rules?.trackAssets || amount === 0) return;
  (a.upkeep ??= []).push([day, amount]);
}

/** Record today's availability of every asset (only when a rule needs it). Called after the asset step. */
export function recordAvailability(st: SimState, day: number): void {
  if (!st.rules?.trackAssets) return;
  for (const v of st.vehicles) if (isDown(v.a, day)) (v.a.downDays ??= []).push(day);
  for (const e of st.equipment) if (isDown(e.a, day)) (e.a.downDays ??= []).push(day);
}

function findAsset(st: SimState, id: Id | undefined): AssetS | null {
  if (id === undefined) return null;
  for (const v of st.vehicles) if (v.id === id) return v.a;
  for (const e of st.equipment) if (e.id === id) return e.a;
  return null;
}

/** Value of an observable, or null when a scoped entity no longer exists (the condition is then false). */
export function observe(st: SimState, ctx: DayCtx, days: DailyRecord[], c: RuleCondition): number | null {
  const day = ctx.day;
  const prev = day > 0 ? days[day - 1] : null;
  switch (c.observable) {
    case 'day':
      return day;
    case 'month':
      return ctx.month;
    case 'cash':
      return prev ? prev.balance.cash : st.company.finance.startingCash;
    case 'available-cash': {
      if (prev) return prev.balance.availableCash;
      const f = st.company.finance;
      return f.startingCash - f.minCashReserve + f.lineOfCredit.limit;
    }
    case 'backlog-hours':
      return prev ? prev.backlogLaborHours : 0;
    case 'active-customers':
      return prev ? prev.activeCustomers : (st.rules as RulesState).opening.activeCustomers;
    case 'active-employees':
      return prev ? prev.activeEmployees : (st.rules as RulesState).opening.activeEmployees;
    case 'missed-rate-28d': {
      const cancelled = trailing(days, day, 28, (d) => d.ops.jobsCancelled);
      const completed = trailing(days, day, 28, (d) => d.ops.jobsCompleted);
      return safeRatio(cancelled, completed + cancelled);
    }
    case 'utilization-28d':
      return safeRatio(trailing(days, day, 28, (d) => d.ops.onSiteHours), trailing(days, day, 28, (d) => d.ops.paidHours));
    case 'idle-share-28d':
      return safeRatio(trailing(days, day, 28, (d) => d.ops.idleHours), trailing(days, day, 28, (d) => d.ops.paidHours));
    case 'overtime-hours-28d':
      return trailing(days, day, 28, (d) => d.ops.overtimeHours);
    case 'crew-size': {
      const crew = st.crews.find((x) => x.id === c.scope?.crewId && x.active);
      if (!crew) return null;
      let n = 0;
      for (const e of st.employees) if (e.active && e.crewId === crew.id) n += 1;
      return n;
    }
    case 'asset-age-years': {
      const a = findAsset(st, c.scope?.assetId);
      return a ? assetAgeOnDay(a, day) : null;
    }
    case 'asset-down-days-90d': {
      const a = findAsset(st, c.scope?.assetId);
      if (!a) return null;
      let n = 0;
      for (const t of a.downDays ?? []) if (t >= day - 90 && t < day) n += 1;
      return n;
    }
    case 'asset-upkeep-365d': {
      const a = findAsset(st, c.scope?.assetId);
      if (!a) return null;
      let s = 0;
      for (const [t, x] of a.upkeep ?? []) if (t >= day - 365 && t < day) s += x;
      return s;
    }
  }
}

function entitiesFor(st: SimState, forEach: DecisionRule['forEach']): Id[] {
  switch (forEach) {
    case undefined:
      return [''];
    case 'vehicle':
      return st.vehicles.map((v) => v.id);
    case 'equipment':
      return st.equipment.map((e) => e.id);
    case 'crew':
      return st.crews.filter((c) => c.active).map((c) => c.id);
  }
}

/** Step 3 of the daily loop: evaluate every active rule and fire the instances whose conditions hold. */
export function rulesStep(st: SimState, ctx: DayCtx, days: DailyRecord[]): void {
  const rs = st.rules;
  if (!rs) return;
  const day = ctx.day;
  rs.rules.forEach((rule, ri) => {
    if (day < (rule.activeFromDay ?? 0) || day >= (rule.activeToDay ?? Infinity)) return;
    // Entities are listed before any instance of this rule fires (config order).
    for (const entity of entitiesFor(st, rule.forEach)) {
      const key = `${ri}|${entity}`;
      const inst = rs.instances.get(key) ?? { firings: 0, lastDay: -Infinity };
      if (inst.firings >= rule.maxFirings) continue;
      if (day - inst.lastDay < rule.cooldownDays) continue;
      const when = rule.forEach ? substituteEach(rule.when, entity) : rule.when;
      let ok = true;
      for (const c of when) {
        const v = observe(st, ctx, days, c);
        if (v === null || !compare(v, c.op, c.value)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      inst.firings += 1;
      inst.lastDay = day;
      rs.instances.set(key, inst);
      const ev: { day: number; type: 'rule-fired'; ruleId: Id; entityId?: Id } = { day, type: 'rule-fired', ruleId: rule.id };
      if (rule.forEach) ev.entityId = entity;
      st.events.push(ev);
      const then: Action[] = rule.forEach ? substituteEach(rule.then, entity) : structuredClone(rule.then);
      then.forEach((action, k) => {
        const tag = `rule:${rule.id}${rule.forEach ? `@${entity}` : ''}:${inst.firings}:${k}`;
        const reason = applyAction(st, ctx, action, tag);
        if (reason === null) st.events.push({ day, type: 'action-applied', action });
        else st.events.push({ day, type: 'action-rejected', action, reason });
      });
    }
  });
}
