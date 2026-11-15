import { useMemo, useState } from 'react';
import type { Action, DecisionRule } from '@/simulation';
import { useStore, validateRuleList } from '@/services/store';
import { describeAction } from '@/services/derive';
import { LANES, type LaneId } from '@/services/planTimeline';
import { Button, Card, Icon, Notice, NumberField, cx } from '../ui';
import { useProjections } from '../hooks';
import { useAddOptions, type AddOption } from '../business/PlanTimeline';
import {
  EACH,
  FOR_EACH,
  OBSERVABLE_INFO,
  OPS,
  defaultCondition,
  describeCondition,
  eachMatches,
  emptyForm,
  formOf,
  fromShown,
  infoOf,
  ruleOf,
  toShown,
  type Condition,
  type ForEach,
  type Op,
  type RuleForm,
} from './ruleModel';
import type { Observable } from '@/simulation';

const selectCls = 'mt-0.5 block h-8 min-w-0 max-w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink';
const labelCls = 'min-w-0 text-[12.5px] text-muted';

/** Shows '$each' as words. */
const plain = (text: string) => text.split(EACH).join('the entity');

function useRuleNames() {
  const { full, ctx, nameOf } = useProjections();
  const name = (id: string) => (id === EACH ? 'each one' : nameOf(id));
  return { full, ctx, nameOf: name };
}

// ───────────────────────── Conditions ─────────────────────────

function ConditionRow({
  cond,
  forEach,
  onChange,
  onRemove,
  canRemove,
}: {
  cond: Condition;
  forEach: ForEach | '';
  onChange: (c: Condition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { full } = useRuleNames();
  const info = infoOf(cond.observable);
  const crews = full.crews.filter((c) => !c.removed);
  const assets = [...full.vehicles.map((v) => ({ id: v.id, name: v.name })), ...full.equipment.map((q) => ({ id: q.id, name: q.name }))];
  const entities = info.scope === 'crew' ? crews.map((c) => ({ id: c.id, name: c.name })) : assets;
  const hasEach = eachMatches(info, forEach);
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border border-line bg-sunken/40 p-2" data-condition>
      <label className={cx(labelCls, 'basis-full sm:basis-auto')}>
        When
        <select
          className={cx(selectCls, 'w-full sm:w-64')}
          aria-label="Observable"
          value={cond.observable}
          onChange={(e) => onChange({ ...cond, observable: e.target.value as Observable, value: 0, scopeId: '' })}
        >
          {OBSERVABLE_INFO.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {info.scope && (
        <label className={labelCls}>
          {info.scope === 'crew' ? 'Crew' : 'Asset'}
          <select className={cx(selectCls, 'w-44')} aria-label="Scope" value={cond.scopeId} onChange={(e) => onChange({ ...cond, scopeId: e.target.value })}>
            <option value="">Choose…</option>
            {hasEach && <option value={EACH}>{info.scope === 'crew' ? 'Each crew' : forEach === 'vehicle' ? 'Each vehicle' : 'Each piece of equipment'}</option>}
            {entities.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={labelCls}>
        <span className="sr-only">Operator</span>
        <select className={cx(selectCls, 'mt-0 w-32')} aria-label="Operator" value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as Op })}>
          {OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className={labelCls}>
        <span className="sr-only">Value</span>
        <NumberField
          ariaLabel="Value"
          value={toShown(info, cond.value)}
          unit={info.unit}
          min={info.min}
          max={info.max}
          step={info.step}
          onCommit={(v) => onChange({ ...cond, value: fromShown(info, v) })}
          className="w-32"
        />
        {info.note && <div className="mt-0.5 text-[11.5px] text-faint">{info.note}</div>}
      </div>
      {canRemove && (
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove condition" title="Remove condition">
          <Icon.Close className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ───────────────────────── Actions ─────────────────────────

/** Actions that only make sense for the entity a rule is instantiated for. */
function eachOptions(forEach: ForEach | ''): AddOption[] {
  if (forEach === 'vehicle' || forEach === 'equipment')
    return [{ id: 'each-dispose', label: forEach === 'vehicle' ? 'Dispose of this vehicle' : 'Dispose of this equipment', make: () => ({ type: 'dispose-asset', assetId: EACH }) }];
  if (forEach === 'crew') return [{ id: 'each-remove-crew', label: 'Remove this crew', make: () => ({ type: 'remove-crew', crewId: EACH }) }];
  return [];
}

function ThenEditor({ forEach, actions, onChange }: { forEach: ForEach | ''; actions: Action[]; onChange: (a: Action[]) => void }) {
  const options = useAddOptions();
  const { full, ctx } = useRuleNames();
  const [lane, setLane] = useState<LaneId | 'each'>('pricing');
  const [optId, setOptId] = useState('');
  const [crewId, setCrewId] = useState('');
  const each = eachOptions(forEach);
  const laneNow: LaneId | 'each' = lane === 'each' && each.length === 0 ? 'pricing' : lane;
  const list = laneNow === 'each' ? each : options[laneNow];
  const opt = list.find((o) => o.id === optId) ?? list[0];
  const crews = full.crews.filter((c) => !c.removed);
  const crew = crewId || (forEach === 'crew' ? EACH : (crews[0]?.id ?? ''));
  return (
    <div className="space-y-2">
      <div className="text-[12.5px] font-medium text-ink">Then do</div>
      {actions.length === 0 ? (
        <p className="text-[12.5px] text-faint">No actions yet. A rule needs at least one.</p>
      ) : (
        <ol className="space-y-1">
          {actions.map((a, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-line bg-surface py-1 pl-2.5 pr-1 text-[13px]" data-then>
              <span className="min-w-0 flex-1 break-words">{plain(describeAction(a, ctx))}</span>
              <button
                type="button"
                aria-label={`Remove action: ${plain(describeAction(a, ctx))}`}
                onClick={() => onChange(actions.filter((_, k) => k !== i))}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken"
              >
                <Icon.Close className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className={labelCls}>
          Type of action
          <select
            className={cx(selectCls, 'w-36')}
            value={laneNow}
            aria-label="Action type"
            onChange={(e) => {
              setLane(e.target.value as LaneId | 'each');
              setOptId('');
            }}
          >
            {LANES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
            {each.length > 0 && <option value="each">This {forEach}</option>}
          </select>
        </label>
        <label className={cx(labelCls, 'basis-full sm:basis-auto')}>
          Action
          <select className={cx(selectCls, 'w-full sm:w-64')} aria-label="Action" value={opt?.id ?? ''} onChange={(e) => setOptId(e.target.value)}>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {opt?.needsCrew && (
          <label className={labelCls}>
            Into crew
            <select className={cx(selectCls, 'w-40')} aria-label="Into crew" value={crew} onChange={(e) => setCrewId(e.target.value)}>
              {forEach === 'crew' && <option value={EACH}>Each crew</option>}
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button size="sm" disabled={!opt || (opt.needsCrew && !crew)} onClick={() => opt && onChange([...actions, opt.make(opt.needsCrew ? crew : null)])}>
          <Icon.Plus /> Add action
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Form ─────────────────────────

function RuleFormView({ initial, others, onSave, onCancel }: { initial: RuleForm; others: DecisionRule[]; onSave: (r: DecisionRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<RuleForm>(initial);
  const company = useStore((s) => s.company);
  const baselineActions = useStore((s) => s.baselineActions);
  const patchKey = useStore((s) => s.patch);
  const horizonDays = useStore((s) => s.horizonDays);
  const set = (p: Partial<RuleForm>) => setForm((f) => ({ ...f, ...p }));
  const rule = useMemo(() => ruleOf(form, others), [form, others]);
  // The engine's own validator decides what is valid; the form only lists its findings.
  const issues = useMemo(
    () => validateRuleList(useStore.getState(), [...others, rule]).filter((i) => i.path.startsWith(`rules[${others.length}]`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rule, others, company, baselineActions, patchKey],
  );
  const errors = issues.filter((i) => i.severity === 'error');
  const clean = (path: string) => path.replace(/^rules\[\d+\]\.?/, '').replace(/\[(\d+)\]/g, (_, n: string) => ` ${Number(n) + 1}`) || 'rule';
  const intField = (label: string, value: number, key: 'cooldownDays' | 'maxFirings', unit: 'days' | 'count') => (
    <div className={labelCls}>
      {label}
      <NumberField ariaLabel={label} value={value} unit={unit} min={0} max={100000} onCommit={(v) => set({ [key]: Math.round(v) } as Partial<RuleForm>)} className="mt-0.5 w-28" />
    </div>
  );
  return (
    <div className="space-y-3 border-t border-line px-4 py-3" role="group" aria-label={form.id ? 'Edit rule' : 'New rule'} data-rule-form>
      <div className="flex flex-wrap items-end gap-3">
        <label className={cx(labelCls, 'basis-full sm:basis-72')}>
          Name
          <input
            aria-label="Rule name"
            className={cx(selectCls, 'w-full')}
            value={form.name}
            placeholder="For example: replace a truck that keeps breaking down"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className={cx(labelCls, 'basis-full sm:basis-auto')}>
          Applies
          <select
            className={cx(selectCls, 'w-full sm:w-64')}
            aria-label="Applies to"
            value={form.forEach}
            onChange={(e) => {
              const forEach = e.target.value as ForEach | '';
              // Scopes and actions that pointed at '$each' no longer make sense when the binding changes.
              set({ forEach, when: form.when.map((c) => (c.scopeId === EACH ? { ...c, scopeId: '' } : c)), then: form.then.filter((a) => !JSON.stringify(a).includes(EACH)) });
            }}
          >
            {FOR_EACH.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-[12.5px] font-medium text-ink">Conditions (all must hold)</div>
        {form.when.map((c, i) => (
          <ConditionRow
            key={i}
            cond={c}
            forEach={form.forEach}
            canRemove={form.when.length > 1}
            onChange={(next) => set({ when: form.when.map((x, k) => (k === i ? next : x)) })}
            onRemove={() => set({ when: form.when.filter((_, k) => k !== i) })}
          />
        ))}
        <Button size="sm" onClick={() => set({ when: [...form.when, defaultCondition()] })}>
          <Icon.Plus /> Add condition
        </Button>
      </div>

      <ThenEditor forEach={form.forEach} actions={form.then} onChange={(then) => set({ then })} />

      <div className="flex flex-wrap items-end gap-3">
        {intField('Wait between firings (days)', form.cooldownDays, 'cooldownDays', 'days')}
        {intField('Fire at most (times)', form.maxFirings, 'maxFirings', 'count')}
        <div className={labelCls}>
          Active from day
          <NumberField ariaLabel="Active from day" value={form.fromDay} unit="count" min={1} max={horizonDays} onCommit={(v) => set({ fromDay: Math.round(v) })} className="mt-0.5 w-24" />
        </div>
        <div className={labelCls}>
          Until day (blank = end)
          <span className="mt-0.5 flex items-center gap-1">
            {form.toDay === null ? (
              <Button size="sm" onClick={() => set({ toDay: horizonDays })}>
                Set an end day
              </Button>
            ) : (
              <>
                <NumberField ariaLabel="Active until day" value={form.toDay} unit="count" min={1} max={horizonDays} onCommit={(v) => set({ toDay: Math.round(v) })} className="w-24" />
                <Button size="sm" variant="ghost" onClick={() => set({ toDay: null })} aria-label="No end day" title="No end day">
                  <Icon.Close className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </span>
        </div>
      </div>

      {issues.length > 0 && (
        <Notice tone={errors.length > 0 ? 'error' : 'warn'}>
          <ul className="list-disc pl-4" data-rule-issues>
            {issues.map((i) => (
              <li key={i.path + i.message}>
                <span className="capitalize">{clean(i.path)}</span>: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={errors.length > 0} onClick={() => onSave(rule)}>
          {form.id ? 'Save rule' : 'Add rule'}
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Section ─────────────────────────

export function RulesSection() {
  const rules = useStore((s) => s.draft.rules);
  const setDraftRules = useStore((s) => s.setDraftRules);
  const { ctx, nameOf } = useRuleNames();
  // `null` = closed; a form = adding or editing.
  const [editing, setEditing] = useState<RuleForm | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const others = useMemo(() => (editing?.id ? rules.filter((r) => r.id !== editing.id) : rules), [rules, editing?.id]);

  const save = (rule: DecisionRule) => {
    const at = rules.findIndex((r) => r.id === rule.id);
    setDraftRules(at >= 0 ? rules.map((r, i) => (i === at ? rule : r)) : [...rules, rule]);
    setEditing(null);
  };

  return (
    <Card
      title="Decision rules"
      subtitle="Standing instructions the simulated business follows on its own when a condition is met, for example replacing a truck that keeps breaking down. Rules are part of the draft."
      actions={
        <Button size="sm" disabled={editing !== null} onClick={() => setEditing(emptyForm())}>
          <Icon.Plus /> Add a rule
        </Button>
      }
      bodyClassName="p-0"
    >
      {rules.length === 0 && editing === null && <p className="px-4 py-3 text-[13px] text-muted">No rules yet. Without rules, the business only does what you schedule on the plan timeline.</p>}
      {rules.length > 0 && (
        <ul className="divide-y divide-line" data-rule-list>
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3" data-rule>
              <div className="min-w-0 flex-1 basis-60">
                <div className="text-[13.5px] font-medium text-ink">{r.name}</div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
                  {r.forEach ? `For each ${r.forEach}. ` : ''}
                  When {r.when.map((c) => describeCondition(c, nameOf)).join(' and ')}, then {r.then.map((a) => plain(describeAction(a, ctx))).join('; ')}.
                </div>
                <div className="mt-0.5 text-[12px] text-faint">
                  At most {r.maxFirings} {r.maxFirings === 1 ? 'time' : 'times'}, {r.cooldownDays} days apart
                  {r.activeFromDay || r.activeToDay !== undefined ? `, active ${r.activeFromDay ? `from day ${r.activeFromDay + 1}` : 'from the start'}${r.activeToDay !== undefined ? ` until day ${r.activeToDay}` : ''}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {deleting === r.id ? (
                  <>
                    <span className="text-[12.5px] text-ink">Delete this rule?</span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setDraftRules(rules.filter((x) => x.id !== r.id));
                        setDeleting(null);
                        if (editing?.id === r.id) setEditing(null);
                      }}
                    >
                      Delete
                    </Button>
                    <Button size="sm" onClick={() => setDeleting(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" disabled={editing?.id === r.id} onClick={() => setEditing(formOf(r))} aria-label={`Edit rule: ${r.name}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(r.id)} aria-label={`Delete rule: ${r.name}`}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <RuleFormView key={editing.id ?? 'new'} initial={editing} others={others} onSave={save} onCancel={() => setEditing(null)} />}
    </Card>
  );
}
