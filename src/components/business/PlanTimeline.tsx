import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Action, EquipmentSpec, NewHireSpec, PlannedAction, VehicleSpec } from '@/simulation';
import { useStore } from '@/services/store';
import { describeAction } from '@/services/derive';
import { LANES, chipDateLabel, clampDay, dayNumberLabel, laneOf, monthTicks, shockBars, type LaneId } from '@/services/planTimeline';
import { dayLabel, money } from '@/services/format';
import { Button, Card, Icon, NumberField, cx } from '../ui';
import { useProjections } from '../hooks';
import { describeShock, shockTitle } from '../conditions/shocks';

// Layout constants (pixels). The day axis is `AXIS_PX` wide; chips hang to the right of their day.
const CHIP_W = 168;
const CHIP_H = 26;
const ROW_GAP = 4;
const LABEL_W = 116;

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const stripId = <T extends { id: string }>(item: T): Omit<T, 'id'> => {
  const { id: _id, ...rest } = item;
  void _id;
  return rest;
};

interface Chip {
  key: string;
  /** Index into the draft list, or -1 for an adopted (read-only) decision. */
  index: number;
  pa: PlannedAction;
  lane: LaneId;
}

interface Placed extends Chip {
  day: number;
  row: number;
}

/** Greedy sub-row assignment so chips of one lane never overlap. */
function place(chips: (Chip & { day: number })[], pxPerDay: number): { placed: Placed[]; rows: number } {
  const sorted = chips.slice().sort((a, b) => a.day - b.day || a.index - b.index);
  const rowEnd: number[] = [];
  const placed: Placed[] = [];
  for (const c of sorted) {
    const x = c.day * pxPerDay;
    let row = rowEnd.findIndex((end) => end + 4 <= x);
    if (row < 0) {
      row = rowEnd.length;
      rowEnd.push(0);
    }
    rowEnd[row] = x + CHIP_W;
    placed.push({ ...c, row });
  }
  return { placed, rows: Math.max(1, rowEnd.length) };
}

export interface AddOption {
  id: string;
  label: string;
  needsCrew?: boolean;
  make: (crewId: string | null) => Action;
}

export function useAddOptions(): Record<LaneId, AddOption[]> {
  const industry = useStore((s) => s.industry);
  const { base } = useProjections();
  return useMemo(() => {
    const marketingMeta = industry.paramMeta['market.marketingMonthlySpend'];
    const G = base.pricing.globalMultiplier;
    const sc = industry.standardCrew;
    const standardCrew = (): Action => {
      const hires: NewHireSpec[] = sc.hireTemplateIds.flatMap((id) => {
        const t = industry.hireTemplates.find((x) => x.id === id);
        return t ? [{ name: t.title, hourlyWage: t.hourlyWage, skill: t.skill, productivity: t.productivity }] : [];
      });
      const v = industry.vehicleCatalog.find((x) => x.id === sc.vehicleCatalogId)!;
      const equipment = sc.equipmentCatalogIds.flatMap((id) => {
        const q = industry.equipmentCatalog.find((x) => x.id === id);
        return q ? [{ spec: stripId(q) as EquipmentSpec, method: 'loan' as const }] : [];
      });
      return { type: 'add-crew', name: 'New crew', hires, vehicle: { spec: stripId(v) as VehicleSpec, method: 'loan' }, equipment };
    };
    const marketing = (delta: number): AddOption => ({
      id: `marketing${delta}`,
      label: `Marketing ${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}/mo`,
      make: () => ({
        type: 'set-marketing-spend',
        monthlySpend: Math.max(marketingMeta?.min ?? 0, Math.min(marketingMeta?.max ?? 1e9, base.marketingSpend + delta)),
      }),
    });
    return {
      people: industry.hireTemplates.map((t) => ({
        id: `hire-${t.id}`,
        label: `Hire ${t.title.toLowerCase()} (${money(t.hourlyWage)}/h)`,
        needsCrew: true,
        make: (crewId) => ({
          type: 'hire-employee',
          crewId: crewId ?? '',
          hire: { name: t.title, hourlyWage: t.hourlyWage, skill: t.skill, productivity: t.productivity },
        }),
      })),
      fleet: [
        { id: 'std-crew', label: 'Add a standard crew (loan)', make: standardCrew },
        ...industry.vehicleCatalog.map<AddOption>((v) => ({
          id: `veh-${v.id}`,
          label: `Buy ${v.name.toLowerCase()} (loan)`,
          make: () => ({ type: 'acquire-vehicle', spec: stripId(v) as VehicleSpec, method: 'loan', crewId: null }),
        })),
      ],
      equipment: industry.equipmentCatalog.map<AddOption>((q) => ({
        id: `eq-${q.id}`,
        label: `Buy ${q.name.toLowerCase()} (cash)`,
        make: () => ({ type: 'acquire-equipment', spec: stripId(q) as EquipmentSpec, method: 'cash', crewId: null }),
      })),
      pricing: [
        { id: 'price+5', label: 'All prices +5%', make: () => ({ type: 'set-price', jobTypeId: 'all', multiplier: round4(G * 1.05) }) },
        { id: 'price-5', label: 'All prices −5%', make: () => ({ type: 'set-price', jobTypeId: 'all', multiplier: round4(G * 0.95) }) },
        marketing(500),
        marketing(-500),
      ],
      policies: (['zoned', 'nearest', 'fifo'] as const).map<AddOption>((r) => ({
        id: `route-${r}`,
        label: `Routing: ${r === 'fifo' ? 'oldest first' : r}`,
        make: () => ({ type: 'set-policy', patch: { routing: r } }),
      })).concat([{ id: 'six-days', label: 'Work six days a week', make: () => ({ type: 'set-policy', patch: { workDaysPerWeek: 6 } }) }]),
    };
  }, [industry, base]);
}

function AddDecision({ initialLane, initialDay, onDone }: { initialLane: LaneId; initialDay: number; onDone: () => void }) {
  const horizonDays = useStore((s) => s.horizonDays);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const startMonth = useStore((s) => s.company.startMonth);
  const { full } = useProjections();
  const options = useAddOptions();
  const [lane, setLane] = useState<LaneId>(initialLane);
  const [optId, setOptId] = useState<string>('');
  const [crewId, setCrewId] = useState<string>('');
  const [day, setDay] = useState(initialDay);
  const list = options[lane];
  const opt = list.find((o) => o.id === optId) ?? list[0];
  const crews = full.crews.filter((c) => !c.removed);
  const crew = crewId || crews[0]?.id || '';
  const selectCls = 'mt-0.5 block h-8 min-w-40 max-w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink';
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3" role="group" aria-label="Add a dated decision">
      <label className="text-[12.5px] text-muted">
        Lane
        <select
          value={lane}
          onChange={(e) => {
            setLane(e.target.value as LaneId);
            setOptId('');
          }}
          className={selectCls}
        >
          {LANES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12.5px] text-muted">
        Decision
        <select value={opt?.id ?? ''} onChange={(e) => setOptId(e.target.value)} className={cx(selectCls, 'min-w-56')}>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {opt?.needsCrew && (
        <label className="text-[12.5px] text-muted">
          Into crew
          <select value={crew} onChange={(e) => setCrewId(e.target.value)} className={selectCls}>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="text-[12.5px] text-muted">
        Starts on day
        <div className="mt-0.5 flex items-center gap-2">
          <NumberField ariaLabel="Day the decision starts" value={day + 1} min={1} max={horizonDays} onCommit={(v) => setDay(clampDay(v - 1, horizonDays))} className="w-20" />
          <span className="num whitespace-nowrap text-muted">{dayLabel(startMonth, day)}</span>
        </div>
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={!opt || (opt.needsCrew && !crew)}
        onClick={() => {
          if (!opt) return;
          setDraftAction(opt.make(opt.needsCrew ? crew : null), day);
          onDone();
        }}
      >
        <Icon.Plus /> Add to timeline
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}

export function PlanTimeline() {
  const draft = useStore((s) => s.draft.actions);
  const baselineActions = useStore((s) => s.baselineActions);
  const horizonDays = useStore((s) => s.horizonDays);
  const startMonth = useStore((s) => s.company.startMonth);
  const moveDraftAction = useStore((s) => s.moveDraftAction);
  const removeDraftAt = useStore((s) => s.removeDraftAt);
  const shocks = useStore((s) => s.shocks);
  const company = useStore((s) => s.company);
  const { ctx } = useProjections();
  const shockName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of company.employees) map.set(e.id, e.name);
    for (const v of company.vehicles) map.set(v.id, v.name);
    for (const q of company.equipment) map.set(q.id, q.name);
    return (id: string) => map.get(id) ?? id;
  }, [company]);

  const axisPx = Math.max(560, Math.min(1000, Math.round(horizonDays * 2.6)));
  const pxPerDay = axisPx / horizonDays;
  const ticks = useMemo(() => monthTicks(startMonth, horizonDays), [startMonth, horizonDays]);

  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ lane: LaneId; day: number } | null>(null);
  const [drag, setDrag] = useState<{ index: number; day: number } | null>(null);
  const dragRef = useRef<{ index: number; offsetX: number; trackLeft: number; moved: boolean; startX: number; day: number } | null>(null);

  const lanes = useMemo(() => {
    const chips: Chip[] = [
      ...baselineActions.map((pa, i) => ({ key: `a${i}`, index: -1, pa, lane: laneOf(pa.action) })),
      ...draft.map((pa, i) => ({ key: `d${i}`, index: i, pa, lane: laneOf(pa.action) })),
    ];
    return LANES.map((l) => {
      const mine = chips.filter((c) => c.lane === l.id).map((c) => ({ ...c, day: drag && drag.index === c.index && c.index >= 0 ? drag.day : c.pa.day }));
      return { ...l, ...place(mine, pxPerDay) };
    });
  }, [baselineActions, draft, drag, pxPerDay]);

  const conditions = useMemo(() => shockBars(shocks, horizonDays, pxPerDay), [shocks, horizonDays, pxPerDay]);

  const dayFromPointer = (clientX: number, d: NonNullable<typeof dragRef.current>) =>
    clampDay(Math.round(((clientX - d.offsetX - d.trackLeft) / axisPx) * horizonDays), horizonDays);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, c: Placed) => {
    if (c.index < 0 || e.button !== 0) return;
    const chipRect = e.currentTarget.getBoundingClientRect();
    const track = e.currentTarget.parentElement!.getBoundingClientRect();
    dragRef.current = { index: c.index, offsetX: e.clientX - chipRect.left, trackLeft: track.left, moved: false, startX: e.clientX, day: c.pa.day };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
    d.moved = true;
    const day = dayFromPointer(e.clientX, d);
    d.day = day;
    setDrag({ index: d.index, day });
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
    if (d.moved) {
      moveDraftAction(d.index, d.day);
      setSelected(d.index);
    } else setSelected((cur) => (cur === d.index ? null : d.index));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, c: Placed) => {
    if (c.index < 0) return;
    const step = e.shiftKey ? 7 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      moveDraftAction(c.index, c.pa.day + (e.key === 'ArrowLeft' ? -step : step));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeDraftAt(c.index);
      setSelected(null);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected((cur) => (cur === c.index ? null : c.index));
    }
  };

  const sel = selected !== null ? draft[selected] : undefined;
  const trackWidth = axisPx + CHIP_W;

  return (
    <Card
      title="Plan timeline"
      subtitle="Each decision starts on a day. Drag a chip, use the arrow keys, or type a day to change when it takes effect."
      actions={
        <Button size="sm" variant="primary" onClick={() => setAdding({ lane: 'people', day: 0 })}>
          <Icon.Plus /> Add decision
        </Button>
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto" data-plan-timeline>
        <div style={{ width: LABEL_W + trackWidth }} className="relative">
          <div className="flex border-b border-line bg-sunken text-[11.5px] text-muted">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-sunken px-3 py-1.5 font-medium">
              Month
            </div>
            <div className="relative h-7" style={{ width: trackWidth }}>
              {ticks.map((t) => (
                <span key={t.day} className="absolute top-1.5 border-l border-line-strong pl-1 leading-none" style={{ left: t.day * pxPerDay }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          {lanes.map((lane) => {
            const height = lane.rows * (CHIP_H + ROW_GAP) + ROW_GAP;
            return (
              <div key={lane.id} className="flex border-b border-line/70 last:border-b-0" data-lane={lane.id}>
                <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink">
                  {lane.label}
                </div>
                <div
                  className="relative cursor-copy"
                  style={{ width: trackWidth, height }}
                  data-lane-track={lane.id}
                  aria-label={`${lane.label} lane`}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                    setAdding({ lane: lane.id, day: clampDay(Math.floor(x / pxPerDay), horizonDays) });
                  }}
                >
                  {ticks.map((t) => (
                    <span key={t.day} className="pointer-events-none absolute inset-y-0 border-l border-line/60" style={{ left: t.day * pxPerDay }} />
                  ))}
                  {lane.placed.map((c) => {
                    const label = describeAction(c.pa.action, ctx);
                    const adopted = c.index < 0;
                    const isSel = c.index >= 0 && selected === c.index;
                    const dragging = drag?.index === c.index && c.index >= 0;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        data-chip-day={c.day}
                        data-timeline-chip={adopted ? 'adopted' : 'draft'}
                        aria-label={`${label}, ${chipDateLabel(startMonth, c.day)}${adopted ? ', adopted' : ''}`}
                        title={`${label}\n${chipDateLabel(startMonth, c.day)}${adopted ? ' (adopted into the baseline)' : ''}`}
                        onPointerDown={(e) => onPointerDown(e, c)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => {
                          dragRef.current = null;
                          setDrag(null);
                        }}
                        onKeyDown={(e) => onKeyDown(e, c)}
                        disabled={adopted}
                        style={{ left: c.day * pxPerDay, top: ROW_GAP + c.row * (CHIP_H + ROW_GAP), width: CHIP_W, height: CHIP_H, touchAction: adopted ? 'auto' : 'none' }}
                        className={cx(
                          'absolute flex flex-col justify-center overflow-hidden rounded-md border px-1.5 text-left leading-tight',
                          adopted ? 'border-line bg-[#ece9e0] text-muted' : 'cursor-grab border-accent/40 bg-accent-soft text-accent hover:border-accent',
                          isSel && 'ring-2 ring-accent',
                          dragging && 'cursor-grabbing shadow-md',
                        )}
                      >
                        <span className="truncate text-[11.5px] font-medium">{label}</span>
                        <span className="num truncate text-[10.5px] opacity-80">
                          {dayNumberLabel(c.day)} · {dayLabel(startMonth, c.day)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {shocks.length > 0 && (
            <div className="flex border-b border-line/70 last:border-b-0" data-lane="conditions">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink" title="Hypothetical conditions, applied to baseline and draft. Edit them in the Conditions panel.">
                Conditions
              </div>
              <div className="relative" style={{ width: trackWidth, height: conditions.rows * (CHIP_H + ROW_GAP) + ROW_GAP }} data-lane-track="conditions" aria-label="Conditions lane (read-only)">
                {ticks.map((t) => (
                  <span key={t.day} className="pointer-events-none absolute inset-y-0 border-l border-line/60" style={{ left: t.day * pxPerDay }} />
                ))}
                {conditions.bars.map((b) => {
                  const shock = shocks[b.index];
                  const title = shockTitle(shock, shockName);
                  const full = describeShock(shock, { nameOf: shockName, horizonDays, startMonth });
                  return (
                    <div
                      key={b.index}
                      role="img"
                      aria-label={full}
                      title={full}
                      data-condition-bar={b.index}
                      data-from-day={b.fromDay}
                      data-to-day={b.toDay}
                      className="absolute flex items-center overflow-hidden rounded-md border border-warn/50 bg-warn-soft px-1.5 text-[11.5px] font-medium text-warn"
                      style={{ left: b.fromDay * pxPerDay, width: Math.max(28, (b.toDay - b.fromDay) * pxPerDay), top: ROW_GAP + b.row * (CHIP_H + ROW_GAP), height: CHIP_H }}
                    >
                      <span className="truncate">{title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {draft.length === 0 && baselineActions.length === 0 && (
        <p className="border-t border-line px-4 py-3 text-[12.5px] text-muted">No decisions yet. Click a lane, or use Add decision, to plan one for a specific day.</p>
      )}

      {sel && selected !== null && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line bg-sunken px-4 py-3" role="group" aria-label="Edit selected decision" data-chip-editor>
          <div className="min-w-0 flex-1 basis-56">
            <div className="text-[12px] text-muted">Selected decision</div>
            <div className="truncate text-[13px] font-medium text-ink">{describeAction(sel.action, ctx)}</div>
          </div>
          <div className="text-[12.5px] text-muted">
            Starts on day
            <div className="mt-0.5 flex items-center gap-2">
              <NumberField
                ariaLabel="Day this decision starts"
                value={sel.day + 1}
                min={1}
                max={horizonDays}
                onCommit={(v) => moveDraftAction(selected, v - 1)}
                className="w-20"
              />
              <span className="num whitespace-nowrap">{dayLabel(startMonth, sel.day)}</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              removeDraftAt(selected);
              setSelected(null);
            }}
          >
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
            Done
          </Button>
        </div>
      )}

      {adding && <AddDecision key={`${adding.lane}-${adding.day}`} initialLane={adding.lane} initialDay={adding.day} onDone={() => setAdding(null)} />}
    </Card>
  );
}
