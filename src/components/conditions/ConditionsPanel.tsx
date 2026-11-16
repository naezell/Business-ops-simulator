import { useMemo, useState } from 'react';
import type { Shock, ShockTarget, WeatherState } from '@/simulation';
import { horizonDaysFor, useStore } from '@/services/store';
import { dayLabel } from '@/services/format';
import { Button, Card, Icon, NumberField, Notice, cx } from '../ui';
import {
  PRESETS,
  TARGET_LABEL,
  TARGET_ORDER,
  TYPE_LABEL,
  WEATHER_LABEL,
  dayNumbersOf,
  describeShock,
  windowFromDayNumbers,
  type ShockType,
} from './shocks';

const selectCls = 'mt-0.5 block h-8 min-w-40 max-w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink';
const FACTOR_META = { unit: 'multiplier', min: 0, max: 50, step: 0.05 } as const;

/** Names of everything a condition can refer to: the company as it stands before any decision. */
function useNames() {
  const company = useStore((s) => s.company);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const e of company.employees) map.set(e.id, e.name);
    for (const v of company.vehicles) map.set(v.id, v.name);
    for (const q of company.equipment) map.set(q.id, q.name);
    return { company, nameOf: (id: string) => map.get(id) ?? id };
  }, [company]);
}

function DayField({ label, value, onCommit, max }: { label: string; value: number; onCommit: (v: number) => void; max: number }) {
  return (
    <div className="text-[12.5px] text-muted">
      {label}
      <NumberField ariaLabel={label} value={value} min={1} max={max} onCommit={(v) => onCommit(Math.round(v))} className="mt-0.5 w-20" />
    </div>
  );
}

function PresetBar() {
  const addShock = useStore((s) => s.addShock);
  const horizonDays = useStore((s) => s.horizonDays);
  const { company } = useNames();
  const startMonth = company.startMonth;
  const [startDay, setStartDay] = useState(1);
  const [vehicleId, setVehicleId] = useState('');
  const vehicle = vehicleId || company.vehicles[0]?.id || null;
  const ctx = { startDay: Math.min(startDay, horizonDays), monthDays: horizonDaysFor(startMonth, 1), quarterDays: horizonDaysFor(startMonth, 3), vehicleId: vehicle };
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-[12.5px] text-muted">
          Windowed presets start on day
          <div className="mt-0.5 flex items-center gap-2">
            <NumberField ariaLabel="Preset start day" value={startDay} min={1} max={horizonDays} onCommit={(v) => setStartDay(Math.round(v))} className="w-20" />
            <span className="num whitespace-nowrap">{dayLabel(startMonth, Math.min(startDay, horizonDays) - 1)}</span>
          </div>
        </div>
        <label className="text-[12.5px] text-muted">
          Truck for the outage preset
          <select value={vehicle ?? ''} onChange={(e) => setVehicleId(e.target.value)} className={selectCls} aria-label="Vehicle for the out-of-service preset">
            {company.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Condition presets">
        {PRESETS.map((p) => {
          const shock = p.make(ctx);
          return (
            <Button key={p.id} size="sm" disabled={!shock} onClick={() => shock && addShock(shock)} className="!h-auto min-h-7 whitespace-normal py-1 text-left">
              <Icon.Plus /> {p.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function CustomForm({ onDone }: { onDone: () => void }) {
  const addShock = useStore((s) => s.addShock);
  const horizonDays = useStore((s) => s.horizonDays);
  const { company, nameOf } = useNames();
  const [type, setType] = useState<ShockType>('multiplier');
  const [target, setTarget] = useState<ShockTarget>('fuel-price');
  const [factor, setFactor] = useState(1.3);
  const [assetId, setAssetId] = useState('');
  const [weather, setWeather] = useState<WeatherState>('rainout');
  const [people, setPeople] = useState<string[]>([]);
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(horizonDays);
  const assets = [...company.vehicles, ...company.equipment];
  const asset = assetId || assets[0]?.id || '';
  const valid = last >= first && (type !== 'absence' || people.length > 0) && (type !== 'outage' || asset !== '');
  const build = (): Shock => {
    const w = windowFromDayNumbers(first, last);
    switch (type) {
      case 'multiplier':
        return { type, target, factor, ...w };
      case 'outage':
        return { type, assetId: asset, ...w };
      case 'absence':
        return { type, employeeIds: people, ...w };
      case 'weather':
        return { type, state: weather, ...w };
    }
  };
  const toggle = (id: string) => setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="space-y-3 border-t border-line px-4 py-3" role="group" aria-label="Add a custom condition">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12.5px] text-muted">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as ShockType)} className={selectCls} aria-label="Condition type">
            {(Object.keys(TYPE_LABEL) as ShockType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {type === 'multiplier' && (
          <>
            <label className="text-[12.5px] text-muted">
              What changes
              <select value={target} onChange={(e) => setTarget(e.target.value as ShockTarget)} className={cx(selectCls, 'min-w-56')} aria-label="What changes">
                {TARGET_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-[12.5px] text-muted">
              Factor (1 = no change)
              <NumberField ariaLabel="Factor" value={factor} meta={FACTOR_META} onCommit={setFactor} className="mt-0.5 w-24" />
            </div>
          </>
        )}
        {type === 'outage' && (
          <label className="text-[12.5px] text-muted">
            Asset
            <select value={asset} onChange={(e) => setAssetId(e.target.value)} className={selectCls} aria-label="Asset">
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === 'weather' && (
          <label className="text-[12.5px] text-muted">
            Weather
            <select value={weather} onChange={(e) => setWeather(e.target.value as WeatherState)} className={selectCls} aria-label="Weather">
              {(Object.keys(WEATHER_LABEL) as WeatherState[]).map((w) => (
                <option key={w} value={w}>
                  {WEATHER_LABEL[w]}
                </option>
              ))}
            </select>
          </label>
        )}
        <DayField label="From day" value={first} max={horizonDays} onCommit={setFirst} />
        <DayField label="To day (inclusive)" value={last} max={horizonDays} onCommit={setLast} />
      </div>
      {type === 'absence' && (
        <fieldset className="text-[12.5px] text-muted">
          <legend>Who is absent (unpaid on workdays in the window)</legend>
          <div className="mt-1 flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
            {company.crews.map((crew) => {
              const members = company.employees.filter((e) => e.crewId === crew.id);
              if (members.length === 0) return null;
              return (
                <div key={crew.id} className="min-w-44">
                  <div className="font-medium text-ink">{crew.name}</div>
                  {members.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 py-0.5 text-ink">
                      <input type="checkbox" checked={people.includes(m.id)} onChange={() => toggle(m.id)} /> {nameOf(m.id)}
                    </label>
                  ))}
                </div>
              );
            })}
            {company.employees.some((e) => !e.crewId) && (
              <div className="min-w-44">
                <div className="font-medium text-ink">Not in a crew</div>
                {company.employees
                  .filter((e) => !e.crewId)
                  .map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 py-0.5 text-ink">
                      <input type="checkbox" checked={people.includes(m.id)} onChange={() => toggle(m.id)} /> {nameOf(m.id)}
                    </label>
                  ))}
              </div>
            )}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!valid}
          onClick={() => {
            addShock(build());
            onDone();
          }}
        >
          <Icon.Plus /> Add condition
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {last < first && <span className="text-[12px] text-bad">The last day must not be before the first day.</span>}
        {type === 'absence' && people.length === 0 && <span className="text-[12px] text-muted">Choose at least one person.</span>}
      </div>
    </div>
  );
}

function ShockRow({ shock, index }: { shock: Shock; index: number }) {
  const updateShock = useStore((s) => s.updateShock);
  const removeShock = useStore((s) => s.removeShock);
  const horizonDays = useStore((s) => s.horizonDays);
  const startMonth = useStore((s) => s.company.startMonth);
  const { nameOf } = useNames();
  const { first, last } = dayNumbersOf(shock, horizonDays);
  const text = describeShock(shock, { nameOf, horizonDays, startMonth });
  const setWindow = (f: number, l: number) => {
    const w = windowFromDayNumbers(Math.min(f, l), Math.max(f, l));
    updateShock(index, { ...shock, ...w });
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" data-shock-row={index}>
      <div className="min-w-0 flex-1 basis-64 text-[13px] text-ink">{text}</div>
      <div className="flex flex-wrap items-center gap-3">
        {shock.type === 'multiplier' && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            ×<NumberField ariaLabel={`Factor of condition ${index + 1}`} value={shock.factor} meta={FACTOR_META} onCommit={(v) => updateShock(index, { ...shock, factor: v })} className="w-20" />
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[12px] text-muted">
          Day
          <NumberField ariaLabel={`First day of condition ${index + 1}`} value={first} min={1} max={horizonDays} onCommit={(v) => setWindow(Math.round(v), last)} className="w-16" />
          to
          <NumberField ariaLabel={`Last day of condition ${index + 1}`} value={last} min={1} max={horizonDays} onCommit={(v) => setWindow(first, Math.round(v))} className="w-16" />
        </div>
        <Button size="sm" variant="secondary" ariaLabel={`Remove condition ${index + 1}`} onClick={() => removeShock(index)}>
          <Icon.Close /> Remove
        </Button>
      </div>
    </li>
  );
}

export function ConditionsPanel() {
  const shocks = useStore((s) => s.shocks);
  const [custom, setCustom] = useState(false);
  return (
    <Card
      title="Conditions"
      subtitle="Hypothetical conditions for stress testing: fuel prices, weather, absences, a truck out of service. They are not decisions."
      actions={
        <Button size="sm" onClick={() => setCustom((c) => !c)}>
          <Icon.Plus /> Custom condition
        </Button>
      }
      bodyClassName="p-0"
    >
      <div className="border-b border-line px-4 py-3">
        <Notice tone="info">
          These conditions are hypothetical. They apply to <span className="font-medium text-ink">both the baseline and the draft</span>, so the comparison between them stays fair. Remove a condition to restore the numbers.
        </Notice>
      </div>
      <PresetBar />
      {custom && <CustomForm onDone={() => setCustom(false)} />}
      <div className="border-t border-line">
        {shocks.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-muted">No conditions. The simulation runs under the company's normal conditions.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Active conditions">
            {shocks.map((s, i) => (
              <ShockRow key={i} shock={s} index={i} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
