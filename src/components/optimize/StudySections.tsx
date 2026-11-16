import { useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CapacityReport, LossSource, StrategyEvaluation, StudyResult } from '@/optimization';
import { useStore } from '@/services/store';
import { money, moneyCompact, num, percent, signed, signedMoney } from '@/services/format';
import { Button, DeltaText, Icon, Segmented, cx } from '@/components/ui';
import { RangeBar, Tag, Waterfall } from './parts';
import {
  VERDICT_LABEL,
  bridgeSteps,
  capacityChartData,
  flipsText,
  headroomText,
  longRunBadge,
  lossRows,
  memberDayLabel,
  paybackLabel,
  stressBadge,
} from './studyModel';

export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {note && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{note}</p>}
    </div>
  );
}

// ───────────────────────── Baseline ─────────────────────────

export function BaselineSummary({ b }: { b: StudyResult['baseline'] }) {
  const items: { label: string; value: string; sub?: string }[] = [
    { label: 'Net profit', value: money(b.netProfit.mean), sub: `${money(b.netProfit.min)} to ${money(b.netProfit.max)}` },
    { label: 'Ending cash', value: money(b.endingCash.mean), sub: `${money(b.endingCash.min)} to ${money(b.endingCash.max)}` },
    { label: 'Revenue', value: money(b.revenue.mean), sub: `${money(b.revenue.min)} to ${money(b.revenue.max)}` },
    { label: 'Lowest cash', value: money(b.minCash) },
    { label: 'Utilization', value: percent(b.utilization) },
    { label: 'Missed-job rate', value: percent(b.missedJobRate) },
    { label: 'Customers at end', value: num(b.endCustomers) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-study-baseline>
      {items.map((i) => (
        <div key={i.label} className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2">
          <dt className="text-[12px] text-muted">{i.label}</dt>
          <dd className="num mt-0.5 text-[17px] font-semibold leading-tight text-ink">{i.value}</dd>
          {i.sub && <dd className="num text-[11.5px] text-muted">{i.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ───────────────────────── Loss attribution ─────────────────────────

export function LossAttribution({ sources }: { sources: LossSource[] }) {
  const rows = useMemo(() => lossRows(sources), [sources]);
  const hi = Math.max(1, ...rows.map((r) => r.max));
  const lo = Math.min(0, ...rows.map((r) => r.min));
  return (
    <div className="rounded-lg border border-line bg-surface p-3" data-study-loss>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.id} data-loss={r.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[13.5px] font-medium text-ink">
                {r.label} {r.isDemand && <Tag tone="accent" title="Not a loss that can be removed: the value of having more customers to serve.">value of more demand</Tag>}
              </span>
              <span className="num text-[13px] text-ink">
                {r.noGain ? signedMoney(r.mean) : <>at most about {moneyCompact(r.mean)}</>}
              </span>
            </div>
            <RangeBar
              dist={{ mean: r.mean, min: r.min, max: r.max, stdDev: 0 }}
              lo={lo}
              hi={hi}
            />
            <p className="text-[12px] leading-snug text-muted">
              {r.sentence} Range across conditions {signedMoney(r.min)} to {signedMoney(r.max)}; {percent(r.share)} of revenue.
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-2 text-[12px] leading-snug text-muted">
        Each figure is an upper bound from removing that one source in the simulation, not a gain you can expect. The sources overlap, so they do not add up.
      </p>
    </div>
  );
}

// ───────────────────────── Capacity ─────────────────────────

export function CapacitySection({ c }: { c: CapacityReport }) {
  const [metric, setMetric] = useState<'hours' | 'missed'>('hours');
  const data = useMemo(() => capacityChartData(c), [c]);
  const steps = useMemo(() => bridgeSteps(c.lossBridge), [c.lossBridge]);
  const span = Math.max(1, ...steps.flatMap((s) => [s.from, s.to]));
  const pos = (v: number) => `${(Math.max(0, v) / span) * 100}%`;
  const yFmt = (v: number) => (metric === 'hours' ? num(v) : `${num(v, 0)}%`);
  return (
    <div className="space-y-3" data-study-capacity>
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-medium text-ink" data-capacity-headroom>
            {headroomText(c)}
          </p>
          <Segmented
            ariaLabel="Capacity chart metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'hours', label: 'Hours per week' },
              { value: 'missed', label: 'Missed jobs' },
            ]}
          />
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Service holds up to about {num(c.effectiveScale, 2)}× today&rsquo;s customer base. Profit peaks at about {num(c.profitMaxScale, 2)}×
          (which can be past the point where service holds). The binding constraint at saturation: {c.bindingConstraint}.
        </p>
        <div className="mt-2 h-[240px] w-full" data-testid="capacity-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#ebe8de" />
              <XAxis
                dataKey="scale"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => `${num(v, 1)}×`}
                tickLine={false}
                axisLine={{ stroke: '#cfcbbd' }}
                label={{ value: 'Customer base vs today', position: 'insideBottom', offset: -2, style: { fontSize: 11, fill: '#5f6a63' } }}
                height={34}
              />
              <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={yFmt} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] shadow-sm">
                      <div className="font-medium text-ink">
                        {num(p.scale, 2)}× ({num(p.customers)} customers)
                      </div>
                      <div className="num text-ink">{num(p.hours)} h/week completed</div>
                      <div className="num text-muted">Missed {num(p.missedPct, 1)}%, late {num(p.latePct, 1)}%</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine x={1} stroke="#8d968f" strokeDasharray="3 3" label={{ value: 'today', position: 'top', style: { fontSize: 11, fill: '#5f6a63' } }} />
              <ReferenceLine x={c.effectiveScale} stroke="#1c7048" strokeDasharray="4 3" label={{ value: 'service limit', position: 'top', style: { fontSize: 11, fill: '#1c7048' } }} />
              <Line dataKey={metric === 'hours' ? 'hours' : 'missedPct'} stroke="#1d2420" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-3" data-capacity-compare>
          <h3 className="text-[13px] font-semibold text-ink">Achievable vs theoretical capacity</h3>
          <dl className="mt-2 space-y-2 text-[13px]">
            <div>
              <dt className="flex justify-between text-muted">
                <span>Achievable at saturation</span>
                <span className="num font-medium text-ink">{num(c.saturationHoursPerWeek)} h/week</span>
              </dt>
              <dd className="mt-1 h-2.5 rounded-full bg-line">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (c.saturationHoursPerWeek / Math.max(1, c.theoreticalHoursPerWeek)) * 100)}%` }} />
              </dd>
            </div>
            <div>
              <dt className="flex justify-between text-muted">
                <span>Theoretical (everyone working, no losses)</span>
                <span className="num font-medium text-ink">{num(c.theoreticalHoursPerWeek)} h/week</span>
              </dt>
              <dd className="mt-1 h-2.5 rounded-full bg-line-strong" />
            </div>
          </dl>
          <p className="mt-2 text-[12px] leading-snug text-muted">The theoretical figure is never reachable; the achievable one is measured in the simulation.</p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-3" data-capacity-bridge>
          <h3 className="text-[13px] font-semibold text-ink">Where the capacity goes (person-hours per week)</h3>
          <ul className="mt-2 space-y-1">
            {steps.map((s) => {
              const a = Math.min(s.from, s.to);
              const w = Math.abs(s.to - s.from);
              return (
                <li key={s.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[12.5px] sm:grid-cols-[10rem_minmax(0,1fr)_4.5rem]">
                  <span className="truncate text-muted" title={s.label}>
                    {s.label}
                  </span>
                  <span className="relative h-4">
                    <span
                      className={cx('absolute top-0.5 bottom-0.5 rounded-sm', s.total ? 'bg-accent/70' : s.hoursPerWeek >= 0 ? 'bg-good/70' : 'bg-bad/60')}
                      style={{ left: pos(a), width: `max(2px, ${pos(w)})` }}
                    />
                  </span>
                  <span className="num text-right font-medium text-ink">{s.total ? num(s.hoursPerWeek) : signed(s.hoursPerWeek)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Strategies ─────────────────────────

const VERDICT_TONE = { recommended: 'good', conditional: 'warn', 'not-recommended': 'neutral' } as const;

export function StrategyCard({
  s,
  scale,
  rank,
  stale,
  quiet,
}: {
  s: StrategyEvaluation;
  scale: { lo: number; hi: number };
  rank?: number;
  stale: boolean;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const applied = useStore((st) => st.study.appliedIds.includes(s.id));
  const adopt = useStore((st) => st.adoptStrategy);
  const d = s.deltaNetProfit;
  const lr = longRunBadge(s);
  const stress = stressBadge(s);
  const flips = flipsText(s);
  const customers = s.deltaEndCustomers.mean;
  const nImproved = Math.round(s.probabilityOfImprovement * s.seedsEvaluated);
  return (
    <div className={cx('min-w-0 rounded-lg border border-line', quiet ? 'bg-sunken' : 'bg-surface')} data-strategy={s.id} data-verdict={s.verdict}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="block w-full px-3 py-2.5 text-left lg:grid lg:grid-cols-[minmax(0,1.5fr)_9rem_minmax(9rem,1fr)] lg:items-center lg:gap-4"
      >
        <span className="flex min-w-0 items-start gap-2">
          {rank !== undefined && <span className="num mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11.5px] font-semibold text-accent">{rank}</span>}
          <span className="min-w-0">
            <span className={cx('block text-[14px] leading-snug', quiet ? 'font-medium text-muted' : 'font-semibold text-ink')}>{s.label}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <Tag tone={VERDICT_TONE[s.verdict]}>{VERDICT_LABEL[s.verdict]}</Tag>
              {s.paretoOptimal && (
                <Tag tone="accent" title="No other feasible strategy is at least as good on every trade-off axis and better on one.">
                  trade-off option
                </Tag>
              )}
              <Tag tone={lr.tone} title={lr.title}>
                {lr.text}
              </Tag>
              {stress && (
                <Tag tone={stress.tone} title={stress.title}>
                  {stress.text}
                </Tag>
              )}
              {s.assumptionSensitive && (
                <Tag tone="warn" title="Illustrative price-sensitivity, churn or marketing-response assumptions drive this result.">
                  depends on assumptions
                </Tag>
              )}
              {s.validation && s.validation.sensitivity.flips.length > 0 && (
                <Tag tone="warn" title={flips ?? undefined}>
                  {s.validation.sensitivity.flips.length} assumption {s.validation.sensitivity.flips.length === 1 ? 'flip' : 'flips'}
                </Tag>
              )}
              {applied && <Tag tone="good">adopted into draft</Tag>}
            </span>
          </span>
        </span>
        <span className="mt-2 flex items-baseline justify-between gap-2 lg:mt-0 lg:block lg:text-right">
          <span className="text-[11.5px] text-muted lg:block">Net profit over the plan</span>
          <DeltaText delta={d.mean} text={signedMoney(d.mean)} better="higher" className={cx('text-[16px]', quiet && 'opacity-80')} epsilon={0.5} />
          <span className="num block text-[11.5px] text-muted">score {signedMoney(s.score)} per year</span>
        </span>
        <span className="mt-1 block min-w-0 lg:mt-0">
          <RangeBar dist={d} lo={scale.lo} hi={scale.hi} />
          <span className="num flex justify-between text-[11px] text-muted">
            <span>{signedMoney(d.min)}</span>
            <span>{signedMoney(d.max)}</span>
          </span>
        </span>
      </button>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 pb-1 text-[12.5px] text-muted">
        {s.members.map((m) => (
          <span key={m.candidateId + m.day}>
            <span className="num font-medium text-ink">{memberDayLabel(m.day)}</span> {m.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 pb-2.5 text-[12.5px] text-muted">
        <span>
          Improved in <span className="num font-medium text-ink">{nImproved} of {s.seedsEvaluated}</span> conditions
        </span>
        <span>
          Upfront cash <span className="num font-medium text-ink">{money(s.upfrontCash)}</span>
        </span>
        <span>
          Lowest cash <span className="num font-medium text-ink">{money(s.minCash)}</span>
        </span>
        <span>
          Payback <span className="font-medium text-ink">{paybackLabel(s)}</span>
        </span>
        {Math.abs(customers) >= 0.5 && (
          <span>
            Customers at end <DeltaText delta={customers} text={signed(customers, 1)} better="higher" epsilon={0.05} />
          </span>
        )}
      </div>

      {s.caveats.length > 0 && (
        <ul className="space-y-0.5 border-t border-line px-3 py-2 text-[12.5px] leading-snug text-warn">
          {s.caveats.map((c) => (
            <li key={c} className="flex gap-1.5">
              <Icon.Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-4 border-t border-line px-3 py-3">
          <ul className="space-y-1.5 text-[13.5px] leading-snug text-ink">
            {s.explanation.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div>
              <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">Where the profit change comes from</h3>
              <Waterfall drivers={s.drivers} total={d.mean} />
            </div>
            <div className="space-y-3">
              <div>
                <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">Operations, before → after</h3>
                <dl className="space-y-1 text-[13px]">
                  <Ratio label="Utilization" v={s.operations.utilization} pct />
                  <Ratio label="Missed-job rate" v={s.operations.missedJobRate} pct />
                  <Ratio label="Overtime hours" v={s.operations.overtimeHours} />
                  <Ratio label="Quits" v={s.operations.quits} />
                </dl>
              </div>
              {s.validation && (
                <div>
                  <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">Checks</h3>
                  <ul className="space-y-1 text-[12.5px] text-muted">
                    {s.validation.longRun && (
                      <li>
                        Long run ({num(s.validation.longRun.horizonDays / 365, 1)} yr): {signedMoney(s.validation.longRun.delta.mean)}; per year {signedMoney(s.validation.longRun.annualizedInHorizon)} inside the plan,{' '}
                        {signedMoney(s.validation.longRun.annualizedBeyondHorizon)} after.
                      </li>
                    )}
                    <li>
                      Stress: {percent(s.validation.stress.robustShare, 0)} of cases still improve and stay feasible; worst case {signedMoney(s.validation.stress.worstCase)}.
                    </li>
                    {flips && <li>{flips}.</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={stale || applied}
              title={stale ? 'These results are out of date. Run again first.' : undefined}
              onClick={() => adopt(s)}
            >
              <Icon.Plus className="h-3.5 w-3.5" />
              {applied ? 'Adopted into draft' : 'Adopt into draft'}
            </Button>
            <span className="text-[12px] text-muted">
              Adds these changes, on their start days{(s.variant.rules?.length ?? 0) > 0 ? ' and rules' : ''}, to the draft plan. Nothing is final until you adopt the draft.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Ratio({ label, v, pct }: { label: string; v: [number, number]; pct?: boolean }) {
  const f = (x: number) => (pct ? percent(x) : num(x, 0));
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-ink">
        {f(v[0])} → {f(v[1])}
      </dd>
    </div>
  );
}
