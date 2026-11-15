import type { Policies } from '@/simulation';
import { useStore } from '@/services/store';
import { ROUTING_LABEL, chipKey, effectivePrice } from '@/services/derive';
import { formatParam, money } from '@/services/format';
import { Card, Icon, ProvenanceBadge, Segmented, SliderField, Switch, cx } from '../ui';
import { useProjections } from '../hooks';

function useDraftAction(key: string) {
  const draft = useStore((s) => s.draftActions);
  return draft.find((p) => chipKey(p.action) === key)?.action;
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const pctText = (p: number) => (p === 0 ? '0%' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`);

// ───────────────────────── Pricing & services ─────────────────────────

function JobTypePriceRow({ jobId }: { jobId: string }) {
  const { base, full } = useProjections();
  const company = useStore((s) => s.company);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftByKey = useStore((s) => s.removeDraftByKey);
  const priceAction = useDraftAction(`price:${jobId}`);
  const offeredAction = useDraftAction(`offered:${jobId}`);
  const job = company.jobTypes.find((j) => j.id === jobId)!;
  const B = base.pricing.byJobType[jobId] ?? 1;
  const draftMult = priceAction && priceAction.type === 'set-price' ? priceAction.multiplier : B;
  const pct = Math.round((draftMult / B - 1) * 100);
  const offered = full.offered[jobId];
  const priceBefore = effectivePrice(job, base.pricing);
  const priceAfter = effectivePrice(job, full.pricing);

  return (
    <div className="grid gap-x-6 gap-y-2 border-b border-line/70 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]" data-jobtype={jobId}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Switch
            label={`Offer ${job.name}`}
            checked={offered}
            onChange={(v) => {
              if (v === base.offered[jobId]) removeDraftByKey(`offered:${jobId}`);
              else setDraftAction({ type: 'set-job-type-offered', jobTypeId: jobId, offered: v });
            }}
          />
          <span className={cx('text-[13.5px] font-medium', offered ? 'text-ink' : 'text-muted line-through')}>{job.name}</span>
          <span className="rounded bg-[#ece9e0] px-1.5 text-[11px] text-muted">{job.kind === 'recurring' ? 'Recurring' : 'One-off'}</span>
        </div>
        <p className="num mt-1 text-[12.5px] text-muted">
          {offeredAction ? (offered ? 'Offered again in the draft. ' : 'Declined in the draft: no new orders, open orders withdrawn. ') : ''}
          Standard visit {money(priceBefore, 2)}
          {Math.abs(priceAfter - priceBefore) > 0.005 && <> {'→'} <span className="font-medium text-ink">{money(priceAfter, 2)}</span></>}
          {' '}
          for a standard property.
        </p>
      </div>
      <div className={cx(!offered && 'pointer-events-none opacity-40')}>
        <SliderField
          label={`Price change, ${job.name.toLowerCase()}`}
          valueText={pctText(pct)}
          value={pct}
          min={-20}
          max={30}
          step={1}
          ticks={['−20%', '+30%']}
          onChange={(p) => {
            if (p === 0) removeDraftByKey(`price:${jobId}`);
            else setDraftAction({ type: 'set-price', jobTypeId: jobId, multiplier: round4(B * (1 + p / 100)) });
          }}
        />
      </div>
    </div>
  );
}

export function PricingSection() {
  const { base } = useProjections();
  const industry = useStore((s) => s.industry);
  const company = useStore((s) => s.company);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftByKey = useStore((s) => s.removeDraftByKey);
  const allAction = useDraftAction('price:all');
  const G0 = base.pricing.globalMultiplier;
  const pct = allAction && allAction.type === 'set-price' ? Math.round((allAction.multiplier / G0 - 1) * 100) : 0;
  const meta = industry.paramMeta['pricing.globalMultiplier'];

  return (
    <div className="space-y-4">
      <Card
        title="All prices"
        subtitle="Scales every job type at once, on top of any per-job adjustment below."
        actions={meta && <ProvenanceBadge provenance={meta.provenance} />}
      >
        <SliderField
          label="Price change, all services"
          valueText={pctText(pct)}
          value={pct}
          min={-20}
          max={30}
          step={1}
          ticks={['−20%', '+30%']}
          onChange={(p) => {
            if (p === 0) removeDraftByKey('price:all');
            else setDraftAction({ type: 'set-price', jobTypeId: 'all', multiplier: round4(G0 * (1 + p / 100)) });
          }}
          hint={
            <>
              Higher prices raise revenue per job but, in the model, lower the share of leads who sign up and raise churn, and a one-time price
              increase makes a few customers leave. The simulation shows the net result.
            </>
          }
        />
      </Card>
      <Card title="By service" subtitle="Switch a service off to decline that work, or adjust its price on its own.">
        <div>
          {company.jobTypes.map((j) => (
            <JobTypePriceRow key={j.id} jobId={j.id} />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────── Scheduling ─────────────────────────

function PolicySlider({ field, hint }: { field: Exclude<keyof Policies, 'routing' | 'autoBackfill' | 'acceptNewCustomers'>; hint?: string }) {
  const { base, full } = useProjections();
  const industry = useStore((s) => s.industry);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftByKey = useStore((s) => s.removeDraftByKey);
  const meta = industry.paramMeta[`policies.${field}`];
  const value = full.policies[field];
  if (!meta) return null;
  const changed = value !== base.policies[field];
  return (
    <SliderField
      label={
        <span className="inline-flex flex-wrap items-center gap-2">
          {meta.label}
          <ProvenanceBadge provenance={meta.provenance} />
        </span>
      }
      valueText={
        <span className={cx(changed && 'text-accent')}>
          {formatParam(value, meta)}
          {changed && <span className="ml-1.5 text-[12px] font-normal text-muted">was {formatParam(base.policies[field], meta)}</span>}
        </span>
      }
      value={value}
      min={meta.min}
      max={meta.max}
      step={meta.step}
      ticks={[formatParam(meta.min, meta), formatParam(meta.max, meta)]}
      hint={hint ?? meta.description}
      onChange={(v) => {
        if (v === base.policies[field]) removeDraftByKey(`policy:${field}`);
        else setDraftAction({ type: 'set-policy', patch: { [field]: v } });
      }}
    />
  );
}

function PolicySwitch({ field, label, description }: { field: 'autoBackfill' | 'acceptNewCustomers'; label: string; description: string }) {
  const { base, full } = useProjections();
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftByKey = useStore((s) => s.removeDraftByKey);
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <p className="text-[12.5px] leading-snug text-muted">{description}</p>
      </div>
      <Switch
        label={label}
        checked={full.policies[field]}
        onChange={(v) => {
          if (v === base.policies[field]) removeDraftByKey(`policy:${field}`);
          else setDraftAction({ type: 'set-policy', patch: { [field]: v } });
        }}
      />
    </div>
  );
}

const ROUTING_HELP: Record<Policies['routing'], string> = {
  fifo: 'Oldest orders first, wherever they are. Simple, but crews may criss-cross the area.',
  nearest: 'Drive to the nearest next stop, unless an order is about to be cancelled.',
  zoned: 'Each crew works its own sector around the depot, which cuts overlap and driving.',
};

export function SchedulingSection() {
  const { base, full } = useProjections();
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftByKey = useStore((s) => s.removeDraftByKey);
  const routing = full.policies.routing;
  return (
    <Card title="Scheduling and policies" subtitle="How crews are dispatched and how long they work.">
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <div className="mb-1.5 text-[13px] font-medium text-ink">Routing</div>
          <Segmented
            ariaLabel="Routing policy"
            value={routing}
            onChange={(v) => {
              if (v === base.policies.routing) removeDraftByKey('policy:routing');
              else setDraftAction({ type: 'set-policy', patch: { routing: v } });
            }}
            options={(['fifo', 'nearest', 'zoned'] as const).map((r) => ({ value: r, label: ROUTING_LABEL[r] }))}
          />
          <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{ROUTING_HELP[routing]}</p>
        </div>
        <PolicySlider field="shiftHours" />
        <PolicySlider field="workDaysPerWeek" hint="5 is Monday to Friday, 6 adds Saturday, 7 is every day." />
        <PolicySlider field="maxOvertimeHoursPerDay" />
        <PolicySlider field="minPaidHoursPerShift" />
        <PolicySlider field="rainoutPaidHours" />
        <div className="space-y-4 lg:col-span-1">
          <PolicySwitch field="autoBackfill" label="Backfill vacancies" description="Open a requisition automatically when someone quits." />
          <PolicySwitch field="acceptNewCustomers" label="Accept new customers" description="Turn off to stop converting leads, for example when crews are full." />
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────── Marketing ─────────────────────────

export function MarketingSection() {
  const { base, full } = useProjections();
  const industry = useStore((s) => s.industry);
  const setDraftAction = useStore((s) => s.setDraftAction);
  const removeDraftByKey = useStore((s) => s.removeDraftByKey);
  const meta = industry.paramMeta['market.marketingMonthlySpend'];
  if (!meta) return null;
  const v = full.marketingSpend;
  const changed = v !== base.marketingSpend;
  return (
    <Card title="Marketing" subtitle="Monthly paid-marketing budget." actions={<ProvenanceBadge provenance={meta.provenance} />}>
      <SliderField
        label="Marketing spend per month"
        valueText={
          <span className={cx(changed && 'text-accent')}>
            {money(v)}/mo{changed && <span className="ml-1.5 text-[12px] font-normal text-muted">was {money(base.marketingSpend)}</span>}
          </span>
        }
        value={v}
        min={meta.min}
        max={meta.max}
        step={meta.step}
        ticks={[money(meta.min), money(meta.max)]}
        hint="Paid leads rise with spend but with diminishing returns, so each extra dollar buys fewer leads than the one before. Extra customers also need crew capacity."
        onChange={(x) => {
          if (x === base.marketingSpend) removeDraftByKey('marketing');
          else setDraftAction({ type: 'set-marketing-spend', monthlySpend: x });
        }}
      />
      <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted">
        <Icon.Info className="h-3.5 w-3.5 shrink-0" /> Lead volume, conversion and churn are assumptions; see Assumptions below.
      </p>
    </Card>
  );
}
