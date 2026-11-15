import { useState } from 'react';
import type { AcquisitionMethod, EquipmentSpec, Id, NewHireSpec, VehicleSpec } from '@/simulation';
import { useStore } from '@/services/store';
import { METHOD_LABEL, describeFinancing, skillLabel, type PCrew, type PEmployee, type Origin } from '@/services/derive';
import { money, num, plural } from '@/services/format';
import { Button, Card, Icon, NumberField, ProvenanceBadge, Segmented, cx } from '../ui';
import { useProjections } from '../hooks';

const METHOD_OPTIONS = (['cash', 'loan', 'lease'] as AcquisitionMethod[]).map((m) => ({ value: m, label: m === 'cash' ? 'Cash' : m === 'loan' ? 'Loan' : 'Lease', title: METHOD_LABEL[m] }));

function OriginTag({ origin }: { origin: Origin }) {
  if (origin === 'draft') return <span className="rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent">Draft</span>;
  if (origin === 'adopted') return <span className="rounded bg-[#ece9e0] px-1.5 text-[11px] font-medium text-muted">Adopted</span>;
  return null;
}

function tenure(days: number): string {
  if (days >= 365) return `${num(days / 365, 1)} yrs`;
  if (days >= 60) return `${num(days / 30.4, 0)} months`;
  return `${num(days)} days`;
}

const stripId = <T extends { id: string }>(item: T): Omit<T, 'id'> => {
  const { id: _id, ...rest } = item;
  void _id;
  return rest;
};

// ───────────────────────── Crews & people ─────────────────────────

function EmployeeRow({ e, crewRemoved }: { e: PEmployee; crewRemoved: boolean }) {
  const setPatch = useStore((s) => s.setPatch);
  const clearPatch = useStore((s) => s.clearPatch);
  const editedPaths = useStore((s) => s.editedPaths);
  const removeDraftAt = useStore((s) => s.removeDraftAt);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const path = `employees.${e.id}.hourlyWage`;
  const edited = editedPaths.has(path);
  const isBase = e.origin === 'base';
  const removedInDraft = e.removed && e.removedOrigin === 'draft';
  if (e.removed && !removedInDraft) return null;

  return (
    <tr className={cx('border-b border-line/70 align-middle', e.removed && 'text-faint')} data-employee={e.id}>
      <td className={cx('px-3 py-1.5', e.removed && 'line-through')}>
        <div className="flex flex-wrap items-center gap-1.5 text-ink">
          <span className={cx(e.removed && 'text-faint')}>{e.name}</span>
          {!isBase && <OriginTag origin={e.origin} />}
        </div>
      </td>
      <td className="px-3 py-1.5 text-muted">{skillLabel(e.skill)}</td>
      <td className="px-3 py-1.5">
        {isBase && !e.removed ? (
          <div className="flex items-center justify-end gap-1.5">
            {edited && <ProvenanceBadge provenance="user-provided" edited />}
            <NumberField
              ariaLabel={`Hourly wage for ${e.name}`}
              value={e.hourlyWage}
              unit="usd/hour"
              min={8}
              max={80}
              step={0.25}
              onCommit={(v) => setPatch(path, v)}
              className="w-24"
            />
            {edited && (
              <button type="button" onClick={() => clearPatch(path)} className="text-[12px] text-muted underline decoration-dotted hover:text-ink" aria-label={`Reset wage for ${e.name}`}>
                reset
              </button>
            )}
          </div>
        ) : (
          <div className="num text-right">{money(e.hourlyWage, 2)}/h</div>
        )}
      </td>
      <td className="num px-3 py-1.5 text-right text-muted">{num(e.productivity, 2)}</td>
      <td className="num px-3 py-1.5 text-right text-muted">{e.origin === 'base' ? tenure(e.tenureDays) : 'new'}</td>
      <td className="px-3 py-1.5 text-right">
        {crewRemoved ? null : removedInDraft ? (
          e.removedByDraftIndex >= 0 && (
            <Button size="sm" variant="ghost" onClick={() => removeDraftAt(e.removedByDraftIndex)} ariaLabel={`Undo removal of ${e.name}`}>
              <Icon.Undo /> Undo
            </Button>
          )
        ) : e.origin === 'draft' && e.draftIndex >= 0 ? (
          <Button size="sm" variant="ghost" onClick={() => removeDraftAt(e.draftIndex)} ariaLabel={`Undo hire of ${e.name}`}>
            <Icon.Undo /> Undo
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            ariaLabel={`Remove ${e.name}`}
            onClick={() => setDraftAction({ type: 'remove-employee', employeeId: e.id })}
          >
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}

function CrewPanel({ crew }: { crew: PCrew }) {
  const { full } = useProjections();
  const industry = useStore((s) => s.industry);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftAt = useStore((s) => s.removeDraftAt);
  const members = full.employees.filter((e) => e.crewId === crew.id);
  const vehicle = full.vehicles.find((v) => v.id === crew.vehicleId);
  const kit = full.equipment.filter((q) => q.crewId === crew.id);
  const removedInDraft = crew.removed && crew.removedOrigin === 'draft';
  if (crew.removed && !removedInDraft) return null;
  const typeName = (id: string) => industry.equipmentTypes.find((t) => t.id === id)?.name ?? id;
  const visible = members.filter((e) => !e.removed || e.removedOrigin === 'draft');
  const activeCount = members.filter((e) => !e.removed).length;

  const hire = (t: (typeof industry.hireTemplates)[number]) => {
    const hireSpec: NewHireSpec = { name: t.title, hourlyWage: t.hourlyWage, skill: t.skill, productivity: t.productivity };
    setDraftAction({ type: 'hire-employee', crewId: crew.id, hire: hireSpec });
  };

  return (
    <div className={cx('rounded-lg border bg-surface', removedInDraft ? 'border-line opacity-70' : 'border-line')} data-crew-panel={crew.id}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cx('text-[15px] font-semibold text-ink', removedInDraft && 'line-through')}>{crew.name}</h3>
            <OriginTag origin={crew.origin} />
            {removedInDraft && <span className="text-[12px] text-bad">Removal in draft</span>}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
            {vehicle ? vehicle.name : 'No vehicle'} · {plural(activeCount, 'person', 'people')}
            {kit.length > 0 && <> · {kit.map((q) => typeName(q.equipmentTypeId).toLowerCase()).join(', ')}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {removedInDraft ? (
            <Button size="sm" variant="ghost" onClick={() => removeDraftAt(crew.removedByDraftIndex)}>
              <Icon.Undo /> Undo removal
            </Button>
          ) : crew.origin === 'draft' ? (
            <Button size="sm" variant="ghost" onClick={() => removeDraftAt(crew.draftIndex)}>
              <Icon.Undo /> Undo new crew
            </Button>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setDraftAction({ type: 'remove-crew', crewId: crew.id })} ariaLabel={`Remove crew ${crew.name}`}>
              Remove crew
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="num w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-sunken text-[12px] text-muted">
              <th scope="col" className="px-3 py-1.5 text-left font-medium">Person</th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">Role</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  Hourly wage <ProvenanceBadge provenance="synthetic-demo" />
                </span>
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium" title="Work rate at full ramp-up; 1.00 is standard.">Productivity</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Tenure</th>
              <th scope="col" className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <EmployeeRow key={e.id} e={e} crewRemoved={crew.removed} />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-muted">
                  Nobody on this crew.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!crew.removed && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="text-[12.5px] text-muted">Hire into this crew:</span>
          {industry.hireTemplates.map((t) => (
            <Button key={t.id} size="sm" onClick={() => hire(t)} ariaLabel={`Hire ${t.title.toLowerCase()} into ${crew.name}`}>
              <Icon.Plus /> {t.title} <span className="num text-muted">{money(t.hourlyWage)}/h</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CrewsSection() {
  const { full, base } = useProjections();
  const industry = useStore((s) => s.industry);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const [method, setMethod] = useState<AcquisitionMethod>('loan');

  const addStandardCrew = () => {
    const sc = industry.standardCrew;
    const hires: NewHireSpec[] = sc.hireTemplateIds.map((id) => {
      const t = industry.hireTemplates.find((x) => x.id === id);
      if (!t) throw new Error(`Unknown hire template ${id}`);
      return { name: t.title, hourlyWage: t.hourlyWage, skill: t.skill, productivity: t.productivity };
    });
    const v = industry.vehicleCatalog.find((x) => x.id === sc.vehicleCatalogId);
    if (!v) throw new Error('Unknown standard-crew vehicle');
    const equipment = sc.equipmentCatalogIds.map((id) => {
      const q = industry.equipmentCatalog.find((x) => x.id === id);
      if (!q) throw new Error(`Unknown equipment ${id}`);
      return { spec: stripId(q) as EquipmentSpec, method };
    });
    const existing = full.crews.filter((c) => c.origin !== 'base').length;
    setDraftAction({
      type: 'add-crew',
      name: `New crew ${existing + 1}`,
      hires,
      vehicle: { spec: stripId(v) as VehicleSpec, method },
      equipment,
    });
  };

  const sc = industry.standardCrew;
  const crewCost = sc.equipmentCatalogIds.length;
  const vehicleName = industry.vehicleCatalog.find((v) => v.id === sc.vehicleCatalogId)?.name ?? 'vehicle';

  return (
    <div className="space-y-3">
      {full.crews.map((c) => (
        <CrewPanel key={c.id} crew={c} />
      ))}
      <Card
        title="Add a standard crew"
        subtitle={`${plural(sc.hireTemplateIds.length, 'person', 'people')}, a ${vehicleName.toLowerCase()} and ${plural(crewCost, 'tool')}. The purchase method applies to the vehicle and the equipment.`}
        actions={
          <>
            <Segmented ariaLabel="How to pay for the new crew's vehicle and equipment" size="sm" value={method} onChange={setMethod} options={METHOD_OPTIONS} />
            <Button variant="primary" size="sm" onClick={addStandardCrew}>
              <Icon.Plus /> Add crew to draft
            </Button>
          </>
        }
        bodyClassName="py-3"
      >
        <p className="text-[12.5px] leading-snug text-muted">
          Cash buys outright and may draw on the line of credit. A loan pays a down payment now and installments after. A lease has no upfront cost and a monthly payment.
          Today the business has {plural(base.crews.filter((c) => !c.removed).length, 'crew')}.
        </p>
      </Card>
    </div>
  );
}

// ───────────────────────── Fleet & equipment ─────────────────────────

function AcquireVehicle() {
  const industry = useStore((s) => s.industry);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const { full } = useProjections();
  const [item, setItem] = useState(industry.vehicleCatalog[0]?.id ?? '');
  const [method, setMethod] = useState<AcquisitionMethod>('loan');
  const [crewId, setCrewId] = useState<string>('');
  const crews = full.crews.filter((c) => !c.removed);
  const spec = industry.vehicleCatalog.find((v) => v.id === item);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-[12.5px] text-muted">
        Vehicle
        <select value={item} onChange={(e) => setItem(e.target.value)} className="mt-0.5 block h-8 min-w-48 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink">
          {industry.vehicleCatalog.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({money(v.purchasePrice)}, lease {money(v.leaseMonthly)}/mo)
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12.5px] text-muted">
        Assign to
        <select value={crewId} onChange={(e) => setCrewId(e.target.value)} className="mt-0.5 block h-8 min-w-40 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink">
          <option value="">Spare (no crew)</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Segmented ariaLabel="How to pay for the vehicle" size="sm" value={method} onChange={setMethod} options={METHOD_OPTIONS} />
      <Button
        size="sm"
        variant="primary"
        disabled={!spec}
        onClick={() => spec && setDraftAction({ type: 'acquire-vehicle', spec: stripId(spec) as VehicleSpec, method, crewId: crewId === '' ? null : crewId })}
      >
        <Icon.Plus /> Add vehicle to draft
      </Button>
    </div>
  );
}

function AcquireEquipment() {
  const industry = useStore((s) => s.industry);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const { full } = useProjections();
  const [item, setItem] = useState(industry.equipmentCatalog[0]?.id ?? '');
  const [method, setMethod] = useState<AcquisitionMethod>('cash');
  const [crewId, setCrewId] = useState<string>('');
  const crews = full.crews.filter((c) => !c.removed);
  const spec = industry.equipmentCatalog.find((v) => v.id === item);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-[12.5px] text-muted">
        Equipment
        <select value={item} onChange={(e) => setItem(e.target.value)} className="mt-0.5 block h-8 min-w-48 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink">
          {industry.equipmentCatalog.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({money(v.purchasePrice)}, lease {money(v.leaseMonthly)}/mo)
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12.5px] text-muted">
        Assign to
        <select value={crewId} onChange={(e) => setCrewId(e.target.value)} className="mt-0.5 block h-8 min-w-40 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink">
          <option value="">Spare (no crew)</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Segmented ariaLabel="How to pay for the equipment" size="sm" value={method} onChange={setMethod} options={METHOD_OPTIONS} />
      <Button
        size="sm"
        variant="primary"
        disabled={!spec}
        onClick={() => spec && setDraftAction({ type: 'acquire-equipment', spec: stripId(spec) as EquipmentSpec, method, crewId: crewId === '' ? null : crewId })}
      >
        <Icon.Plus /> Add equipment to draft
      </Button>
    </div>
  );
}

export function FleetSection() {
  const { full } = useProjections();
  const industry = useStore((s) => s.industry);
  const removeDraftAt = useStore((s) => s.removeDraftAt);
  const crewName = (id: Id | null) => (id === null ? 'Spare' : (full.crews.find((c) => c.id === id)?.name ?? id));
  const typeName = (id: string) => industry.equipmentTypes.find((t) => t.id === id)?.name ?? id;
  const vehicles = full.vehicles;
  const equipment = full.equipment;
  const vehicleCrew = (vid: Id) => full.crews.find((c) => c.vehicleId === vid && !c.removed)?.name ?? 'Spare';

  return (
    <div className="space-y-4">
      <Card title="Vehicles" bodyClassName="p-0" subtitle="Age and financing as of day 0. New purchases start at age 0.">
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken text-[12px] text-muted">
                <th scope="col" className="px-4 py-1.5 text-left font-medium">Vehicle</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">Used by</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Age</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Purchase price</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">Financing</th>
                <th scope="col" className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} className="border-b border-line/70">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="mr-1.5">{v.name}</span>
                    <OriginTag origin={v.origin} />
                  </td>
                  <td className="px-3 py-1.5 text-muted">{vehicleCrew(v.id)}</td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {num(v.asset.ageYears, 0)} of {num(v.asset.usefulLifeYears, 0)} yrs
                  </td>
                  <td className="px-3 py-1.5 text-right">{money(v.asset.purchasePrice)}</td>
                  <td className="px-3 py-1.5 text-muted">{describeFinancing(v.asset.financing)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {v.origin === 'draft' && v.draftIndex >= 0 && !full.crews.some((c) => c.draftIndex === v.draftIndex && c.vehicleId === v.id) && (
                      <Button size="sm" variant="ghost" onClick={() => removeDraftAt(v.draftIndex)} ariaLabel={`Undo purchase of ${v.name}`}>
                        <Icon.Undo /> Undo
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-3">
          <AcquireVehicle />
          <p className="mt-2 text-[12px] text-muted">
            A new vehicle becomes the crew's own only if that crew has none; otherwise it is a spare any crew can borrow while its own is in repair.
          </p>
        </div>
      </Card>

      <Card title="Equipment" bodyClassName="p-0" subtitle="Each job type needs specific equipment in the crew's kit.">
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken text-[12px] text-muted">
                <th scope="col" className="px-4 py-1.5 text-left font-medium">Item</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">Type</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">Assigned to</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Age</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Purchase price</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">Financing</th>
                <th scope="col" className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {equipment.map((q) => (
                <tr key={q.id} className="border-b border-line/70">
                  <td className="px-4 py-1.5 text-ink">
                    <span className="mr-1.5">{q.name}</span>
                    <OriginTag origin={q.origin} />
                  </td>
                  <td className="px-3 py-1.5 text-muted">{typeName(q.equipmentTypeId)}</td>
                  <td className="px-3 py-1.5 text-muted">{crewName(q.crewId)}</td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {num(q.asset.ageYears, 0)} of {num(q.asset.usefulLifeYears, 0)} yrs
                  </td>
                  <td className="px-3 py-1.5 text-right">{money(q.asset.purchasePrice)}</td>
                  <td className="px-3 py-1.5 text-muted">{describeFinancing(q.asset.financing)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {q.origin === 'draft' && q.draftIndex >= 0 && !full.crews.some((c) => c.draftIndex === q.draftIndex) && (
                      <Button size="sm" variant="ghost" onClick={() => removeDraftAt(q.draftIndex)} ariaLabel={`Undo purchase of ${q.name}`}>
                        <Icon.Undo /> Undo
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-3">
          <AcquireEquipment />
        </div>
      </Card>
    </div>
  );
}
