import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CompanyDataLabel } from '@/components/CompanyDataLabel';
import { useAddOptions } from '@/components/business/PlanTimeline';
import { useProjections } from '@/components/hooks';
import { Button, Card, Notice } from '@/components/ui';
import { kpisOf, ROUTING_LABEL, type CompanyPatch } from '@/services/derive';
import { money, num, signed, signedMoney } from '@/services/format';
import { selectCompanyProvenance, selectHasDraft, useStore } from '@/services/store';
import type { Action, Policies } from '@/simulation';

type Decision = 'price' | 'route' | 'crew';
const inputClass = 'mt-1 block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-ink';
const decisions: Record<Decision, string> = {
  price: 'Change a service price',
  route: 'Change how crews are routed',
  crew: 'Add a crew',
};
const routeOptions: Policies['routing'][] = ['zoned', 'nearest', 'fifo'];

function OptionalNumber({ name, label, current, unit, provenance, min, max = 1_000_000, step }: {
  name: string; label: string; current: number; unit: string; provenance: string; min: number; max?: number; step: string;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input className={inputClass} type="number" name={name} min={min} max={max} step={step} placeholder={String(current)} />
      <span className="mt-1 block text-xs font-normal text-muted">
        {num(current, 2)} {unit} in the current model · {provenance === 'user-provided' ? 'Provided' : 'Estimated'}
      </span>
    </label>
  );
}

export function ClientReviewPage({ onBack, onFinancials }: { onBack: () => void; onFinancials: () => void }) {
  const company = useStore((state) => state.company);
  const industry = useStore((state) => state.industry);
  const pending = useStore((state) => state.pending);
  const horizonDays = useStore((state) => state.horizonDays);
  const hasDraft = useStore(selectHasDraft);
  const baseline = useStore((state) => state.baselineResult);
  const draft = useStore((state) => state.draftResult);
  const baselineIssues = useStore((state) => state.baselineIssues);
  const draftIssues = useStore((state) => state.draftIssues);
  const applyGuidedDecision = useStore((state) => state.applyGuidedDecision);
  const setView = useStore((state) => state.setView);
  const draftPlan = useStore((state) => state.draft);
  const { base } = useProjections();
  const standardCrew = useAddOptions().fleet.find((option) => option.id === 'std-crew')?.make(null);
  const [decision, setDecision] = useState<Decision>('price');
  const [serviceId, setServiceId] = useState(company.jobTypes.find((job) => job.offered)?.id ?? '');
  const [route, setRoute] = useState<Policies['routing']>(() => routeOptions.find((option) => option !== base.policies.routing) ?? 'nearest');
  const [comparison, setComparison] = useState<{ label: string; action: Action } | null>(null);
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  const serviceIndex = company.jobTypes.findIndex((item) => item.id === serviceId);
  const service = company.jobTypes[serviceIndex];
  const pricePath = `jobTypes.${serviceIndex}.basePrice`;
  const timePath = `jobTypes.${serviceIndex}.standardLaborHours`;
  const priceSource = useStore((state) => selectCompanyProvenance(state, pricePath, 'synthetic-demo'));
  const timeSource = useStore((state) => selectCompanyProvenance(state, timePath, 'synthetic-demo'));
  const cashSource = useStore((state) => selectCompanyProvenance(state, 'finance.startingCash', 'synthetic-demo'));
  const speedSource = useStore((state) => selectCompanyProvenance(state, 'costs.avgSpeedMph', 'industry-assumption'));
  const comparingOwnChange = comparison !== null && draftPlan.actions.length === 1
    && draftPlan.actions[0]?.action === comparison.action && draftPlan.rules.length === 0;
  const mustConfirm = hasDraft && !comparingOwnChange;

  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (mustConfirm && !replace) return;
    const form = new FormData(event.currentTarget);
    const priceChange = Number(form.get('price-change'));
    const edits = [
      ['finance.startingCash', form.get('starting-cash')],
      [pricePath, form.get('visit-price')],
      [timePath, form.get('labor-time')],
      ['costs.avgSpeedMph', form.get('drive-speed')],
    ] as const;
    let action: Action;
    let label: string;
    if (decision === 'price' && service && priceChange !== 0) {
      action = { type: 'set-price', jobTypeId: service.id, multiplier: (base.pricing.byJobType[service.id] ?? 1) * (1 + priceChange / 100) };
      label = `${service.name} ${signed(priceChange)}%`;
    } else if (decision === 'route' && route !== base.policies.routing) {
      action = { type: 'set-policy', patch: { routing: route } };
      label = `Crew routing · ${ROUTING_LABEL[route]}`;
    } else if (decision === 'crew' && standardCrew?.type === 'add-crew') {
      action = standardCrew;
      label = 'Add a standard crew with financed vehicle and equipment';
    } else {
      setError('Choose a change that differs from the current plan.');
      return;
    }
    const patch: CompanyPatch = {};
    for (const [path, raw] of edits) {
      if (typeof raw === 'string' && raw !== '') patch[path] = Number(raw);
    }
    applyGuidedDecision(patch, action);
    setView('financials');
    setReplace(false);
    setComparison({ label, action });
  }

  const b = kpisOf(baseline);
  const d = kpisOf(draft);
  const invalid = [...baselineIssues, ...draftIssues].find((issue) => issue.severity === 'error');
  const rows = [
    { label: 'Net profit before income tax', current: money(b.netProfit), change: money(d.netProfit), delta: signedMoney(d.netProfit - b.netProfit) },
    { label: 'Lowest cash', current: money(b.lowestCash), change: money(d.lowestCash), delta: signedMoney(d.lowestCash - b.lowestCash) },
    { label: 'Jobs completed', current: num(b.jobsCompleted), change: num(d.jobsCompleted), delta: signed(d.jobsCompleted - b.jobsCompleted) },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold text-ink">Review a client</h1>
          <p className="mt-1 text-sm text-muted">Start with {company.name} and compare one decision with the current plan.</p>
          <CompanyDataLabel className="mt-2" />
        </div>
        <Button onClick={onBack}>Back to simulator</Button>
      </header>

      <form onSubmit={compare} className="space-y-4">
        <Card title="Which decision are you reviewing?" subtitle="The change takes effect on the first day of the simulation.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Decision
              <select className={inputClass} value={decision} onChange={(event) => setDecision(event.target.value as Decision)}>
                {Object.entries(decisions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {decision === 'price' && <>
              <label className="text-sm font-medium text-ink">
                Service
                <select className={inputClass} value={serviceId} required onChange={(event) => setServiceId(event.target.value)}>
                  {company.jobTypes.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-ink">
                Proposed price change (%)
                <input className={inputClass} name="price-change" type="number" required min={-20} max={30} step="1" defaultValue={5} />
              </label>
            </>}
            {decision === 'route' &&
              <label className="text-sm font-medium text-ink">
                Proposed routing
                <select className={inputClass} value={route} onChange={(event) => setRoute(event.target.value as Policies['routing'])}>
                  {routeOptions.map((option) => <option key={option} value={option}>{ROUTING_LABEL[option]}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-muted">Current plan · {ROUTING_LABEL[base.policies.routing]}</span>
              </label>}
            {decision === 'crew' && standardCrew?.type === 'add-crew' &&
              <div className="text-sm text-muted">
                <p>Estimated {industry.name.toLowerCase()} crew costs</p>
                <ul className="list-disc pl-5">
                  {standardCrew.hires.map((hire, index) => <li key={index}>{hire.name}, {money(hire.hourlyWage)}/hour</li>)}
                  <li>{standardCrew.vehicle.spec.name}, {money(standardCrew.vehicle.spec.purchasePrice)} before financing</li>
                  <li>{standardCrew.equipment.length} equipment items financed on a loan</li>
                </ul>
              </div>}
          </div>
        </Card>

        <Card title="Enter figures you have" subtitle="Leave missing figures blank to keep the current values. These inputs affect both sides of the comparison.">
          <div className="grid gap-4 sm:grid-cols-3">
            <OptionalNumber name="starting-cash" label="Starting cash" current={company.finance.startingCash} unit="USD" provenance={cashSource} min={0} step="0.01" />
            {decision === 'price' && service && <div key={service.id} className="contents">
              <OptionalNumber name="visit-price" label="Base price for a standard visit" current={service.basePrice} unit="USD" provenance={priceSource} min={0} step="0.01" />
              <OptionalNumber name="labor-time" label="Labor per standard visit" current={service.standardLaborHours} unit="person-hours" provenance={timeSource} min={0.01} step="0.01" />
            </div>}
            {decision === 'route' && <OptionalNumber name="drive-speed" label="Average road speed between jobs" current={company.costs.avgSpeedMph} unit="mph" provenance={speedSource} min={5} max={70} step="1" />}
          </div>
        </Card>

        {mustConfirm && (
          <Notice tone="warn">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
              <span>Replace the current what-if changes with this decision. You can save those changes as a client review first.</span>
            </label>
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" variant="primary" disabled={pending || (mustConfirm && !replace)}>Compare with current plan</Button>
      </form>

      {comparison && comparingOwnChange && (
        <Card
          title={comparison.label}
          subtitle={`Simulated over ${horizonDays} days under the same conditions. Check estimates before acting on the results.`}
          actions={<Button onClick={onFinancials}>Open financial details</Button>}
        >
          {pending ? <p role="status" className="text-sm text-muted">Running comparison…</p>
            : invalid ? <Notice tone="error">{invalid.message}</Notice>
            : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr><th scope="col" className="pb-2 pr-2">Measure</th><th scope="col" className="pb-2 pr-2">Current plan</th><th scope="col" className="pb-2 pr-2">What if</th><th scope="col" className="pb-2">Change</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => <tr key={row.label} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 font-medium">{row.label}</th>
                  <td className="num pr-2">{row.current}</td>
                  <td className="num pr-2">{row.change}</td>
                  <td className="num">{row.delta}</td>
                </tr>)}
              </tbody>
            </table></div>}
        </Card>
      )}
    </div>
  );
}
