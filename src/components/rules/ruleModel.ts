/**
 * Rule editor model: the form state for a DecisionRule and the conversions between what the person edits
 * (1-based day numbers, percentages) and what the engine stores (0-based days, fractions).
 * Conversions only; every number a rule reads or computes comes from the engine.
 */
import type { Action, DecisionRule, Observable, RuleCondition } from '@/simulation';
import type { ParamMeta } from '@/simulation';
import { formatParam } from '@/services/format';

export type Op = RuleCondition['op'];
export type ForEach = NonNullable<DecisionRule['forEach']>;
export const EACH = '$each';

export const OPS: { id: Op; label: string }[] = [
  { id: '<', label: 'is below' },
  { id: '<=', label: 'is at most' },
  { id: '>', label: 'is above' },
  { id: '>=', label: 'is at least' },
  { id: '==', label: 'equals' },
  { id: '!=', label: 'differs from' },
];

export const FOR_EACH: { id: ForEach | ''; label: string }[] = [
  { id: '', label: 'Once, for the whole business' },
  { id: 'vehicle', label: 'For each vehicle' },
  { id: 'equipment', label: 'For each piece of equipment' },
  { id: 'crew', label: 'For each crew' },
];

export interface ObservableInfo {
  id: Observable;
  label: string;
  /** Unit shown in the number field. */
  unit: ParamMeta['unit'];
  /** Display value = engine value + offset. */
  offset: number;
  min: number;
  max: number;
  step: number;
  /** Which entity a scoped observable needs. */
  scope?: 'crew' | 'asset';
  /** Short unit hint appended to the label when the field has no unit text of its own. */
  note?: string;
}

export const OBSERVABLE_INFO: ObservableInfo[] = [
  { id: 'day', label: 'Day of the run', unit: 'count', offset: 1, min: 1, max: 3650, step: 1, note: 'day number, 1 = first day' },
  { id: 'month', label: 'Calendar month', unit: 'count', offset: 1, min: 1, max: 12, step: 1, note: '1 = January' },
  { id: 'cash', label: 'Cash in the bank', unit: 'usd', offset: 0, min: -1e9, max: 1e9, step: 100 },
  { id: 'available-cash', label: 'Available cash', unit: 'usd', offset: 0, min: -1e9, max: 1e9, step: 100 },
  { id: 'backlog-hours', label: 'Backlog of work', unit: 'hours', offset: 0, min: 0, max: 1e7, step: 1 },
  { id: 'active-customers', label: 'Active customers', unit: 'count', offset: 0, min: 0, max: 1e6, step: 1 },
  { id: 'active-employees', label: 'Active employees', unit: 'count', offset: 0, min: 0, max: 1e5, step: 1 },
  { id: 'missed-rate-28d', label: 'Missed-job rate, last 28 days', unit: 'fraction', offset: 0, min: 0, max: 1, step: 0.01 },
  { id: 'utilization-28d', label: 'Utilization, last 28 days', unit: 'fraction', offset: 0, min: 0, max: 1, step: 0.01 },
  { id: 'idle-share-28d', label: 'Idle share of paid hours, last 28 days', unit: 'fraction', offset: 0, min: 0, max: 1, step: 0.01 },
  { id: 'overtime-hours-28d', label: 'Overtime hours, last 28 days', unit: 'hours', offset: 0, min: 0, max: 1e6, step: 1 },
  { id: 'crew-size', label: 'Crew size', unit: 'count', offset: 0, min: 0, max: 1000, step: 1, scope: 'crew' },
  { id: 'asset-age-years', label: 'Asset age', unit: 'count', offset: 0, min: 0, max: 100, step: 0.5, scope: 'asset', note: 'years' },
  { id: 'asset-down-days-90d', label: 'Days out of service, last 90 days', unit: 'days', offset: 0, min: 0, max: 90, step: 1, scope: 'asset' },
  { id: 'asset-upkeep-365d', label: 'Upkeep cost, last 365 days', unit: 'usd', offset: 0, min: 0, max: 1e9, step: 100, scope: 'asset' },
];

export const infoOf = (o: Observable): ObservableInfo => OBSERVABLE_INFO.find((x) => x.id === o) ?? OBSERVABLE_INFO[0];

/** Engine value to the number shown in the field (fractions are converted by the field itself). */
export const toShown = (info: ObservableInfo, value: number): number => value + info.offset;
export const fromShown = (info: ObservableInfo, shown: number): number => shown - info.offset;

export interface Condition {
  observable: Observable;
  op: Op;
  value: number;
  /** crewId for crew-size; assetId for asset observables; '$each' allowed when the rule has a matching forEach. */
  scopeId: string;
}

export interface RuleForm {
  /** Id of the rule being edited, or null for a new rule. */
  id: string | null;
  name: string;
  forEach: ForEach | '';
  when: Condition[];
  then: Action[];
  cooldownDays: number;
  maxFirings: number;
  /** Day numbers, 1-based; the rule is active on days [from, to]. `to` null = until the end. */
  fromDay: number;
  toDay: number | null;
}

export function emptyForm(): RuleForm {
  return { id: null, name: '', forEach: '', when: [defaultCondition()], then: [], cooldownDays: 14, maxFirings: 3, fromDay: 1, toDay: null };
}

export function defaultCondition(): Condition {
  return { observable: 'available-cash', op: '<', value: 0, scopeId: '' };
}

/** Next unused id of the form `rule-N`. */
export function nextRuleId(rules: readonly DecisionRule[]): string {
  const used = new Set(rules.map((r) => r.id));
  let n = 1;
  while (used.has(`rule-${n}`)) n++;
  return `rule-${n}`;
}

/** Form state for an existing rule. */
export function formOf(rule: DecisionRule): RuleForm {
  return {
    id: rule.id,
    name: rule.name,
    forEach: rule.forEach ?? '',
    when: rule.when.map((c) => ({
      observable: c.observable,
      op: c.op,
      value: c.value,
      scopeId: c.scope?.crewId ?? c.scope?.assetId ?? '',
    })),
    then: rule.then,
    cooldownDays: rule.cooldownDays,
    maxFirings: rule.maxFirings,
    fromDay: (rule.activeFromDay ?? 0) + 1,
    toDay: rule.activeToDay === undefined ? null : rule.activeToDay,
  };
}

/** The rule the form describes. `existing` supplies ids of other rules so a new rule gets a unique id. */
export function ruleOf(form: RuleForm, existing: readonly DecisionRule[]): DecisionRule {
  const rule: DecisionRule = {
    id: form.id ?? nextRuleId(existing),
    name: form.name.trim() || 'Untitled rule',
    ...(form.forEach ? { forEach: form.forEach } : {}),
    when: form.when.map<RuleCondition>((c) => {
      const info = infoOf(c.observable);
      return {
        observable: c.observable,
        op: c.op,
        value: c.value,
        ...(info.scope === 'crew' ? { scope: { crewId: c.scopeId } } : info.scope === 'asset' ? { scope: { assetId: c.scopeId } } : {}),
      };
    }),
    then: form.then,
    cooldownDays: form.cooldownDays,
    maxFirings: form.maxFirings,
  };
  if (form.fromDay > 1) rule.activeFromDay = form.fromDay - 1;
  // Days are shown 1-based and inclusive; the engine's end is exclusive, so day number N maps to N.
  if (form.toDay !== null) rule.activeToDay = form.toDay;
  return rule;
}

/** What scoped conditions may point at for a given forEach. */
export function eachMatches(info: ObservableInfo, forEach: ForEach | ''): boolean {
  if (info.scope === 'crew') return forEach === 'crew';
  if (info.scope === 'asset') return forEach === 'vehicle' || forEach === 'equipment';
  return false;
}

/** One-line description of a condition, e.g. "Utilization, last 28 days is below 60%". */
export function describeCondition(c: RuleCondition, nameOf: (id: string) => string): string {
  const info = infoOf(c.observable);
  const op = OPS.find((o) => o.id === c.op)?.label ?? c.op;
  const scopeId = c.scope?.crewId ?? c.scope?.assetId;
  const who = scopeId === undefined ? '' : scopeId === EACH ? ' (each one)' : ` (${nameOf(scopeId)})`;
  const value = formatParam(toShown(info, c.value), { unit: info.unit, step: info.step });
  const note = info.note && info.unit === 'count' && info.id !== 'month' && info.id !== 'day' ? ` ${info.note}` : '';
  const prefix = c.observable === 'day' ? 'day ' : c.observable === 'month' ? 'month ' : '';
  return `${info.label}${who} ${op} ${prefix}${value}${note}`;
}
