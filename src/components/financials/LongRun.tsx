import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildCalendar } from '@/simulation';
import { useStore } from '@/services/store';
import { MONTHS, dayLabel, money, moneyCompact, num, percent, signedMoney, signedPoints, signed } from '@/services/format';
import { Card, DeltaText, Segmented, cx } from '@/components/ui';
import { YEAR_METRICS, longRunSeries, yearLabel, type YearMetric } from './long-run-data';
import type { PeriodSummary } from '@/simulation/types';

function fmt(m: YearMetric, v: number): string {
  return m.kind === 'money' ? money(v) : m.kind === 'pct' ? percent(v) : num(v);
}
function fmtDelta(m: YearMetric, d: number): string {
  return m.kind === 'money' ? signedMoney(d) : m.kind === 'pct' ? signedPoints(d) : signed(d);
}

// ───────────────────────── Yearly table ─────────────────────────

export function YearlyTable({ hasDraft }: { hasDraft: boolean }) {
  const baseline = useStore((s) => s.baselineResult);
  const draft = useStore((s) => s.draftResult);
  const [view, setView] = useState<'draft' | 'baseline' | 'change'>('draft');
  const mode = hasDraft ? view : 'baseline';
  if (baseline.horizonDays <= 365) return null;

  const main = mode === 'baseline' ? baseline : draft;
  const cols: { key: string; label: string; main: PeriodSummary; base?: PeriodSummary; draft?: PeriodSummary; total?: boolean }[] = [
    ...main.years.map((y, i) => ({ key: `y${i}`, label: yearLabel(y), main: y, base: baseline.years[i], draft: draft.years[i] })),
    { key: 'total', label: 'Total', main: main.totals, base: baseline.totals, draft: draft.totals, total: true },
  ];

  return (
    <Card
      title="Year by year"
      subtitle="One column per 365-day block from day 1. Money and counts in the Total column are the whole-horizon engine totals; ending cash, ending customers and ratios are end-of-horizon or whole-horizon values."
      actions={
        hasDraft ? (
          <Segmented
            ariaLabel="Yearly table layout"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'baseline', label: 'Baseline' },
              { value: 'change', label: 'Change' },
            ]}
          />
        ) : undefined
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[560px] border-collapse text-[13px]" data-testid="yearly-table">
          <thead>
            <tr className="border-b border-line bg-sunken text-[12px] text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-sunken px-4 py-2 text-left font-medium">
                Measure
              </th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap px-3 py-2 text-right font-medium last:px-4', c.total && 'font-semibold text-ink')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {YEAR_METRICS.map((m) => (
              <tr key={m.id} className="border-b border-line/70" data-testid={`yearly-row-${m.id}`}>
                <th scope="row" title={m.hint} className="sticky left-0 z-10 bg-surface px-4 py-1.5 text-left font-normal text-muted">
                  {m.label}
                </th>
                {cols.map((c) => {
                  if (mode === 'change') {
                    const d = m.read(c.draft!) - m.read(c.base!);
                    return (
                      <td key={c.key} data-testid={c.total ? `yearly-total-${m.id}` : undefined} className={cx('px-3 py-1.5 text-right last:px-4', c.total && 'font-semibold')}>
                        <DeltaText delta={d} text={fmtDelta(m, d)} better={m.better} epsilon={m.kind === 'pct' ? 0.0005 : 0.5} />
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} data-testid={c.total ? `yearly-total-${m.id}` : undefined} className={cx('px-3 py-1.5 text-right last:px-4', c.total && 'font-semibold text-ink')}>
                      {fmt(m, m.read(c.main))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ───────────────────────── Long-run charts ─────────────────────────

type Key = 'cash' | 'customers' | 'distributions';

function LongChart({
  dataKey,
  baseKey,
  data,
  horizonDays,
  yLabel,
  testId,
  money: isMoney,
  compare,
}: {
  dataKey: Key;
  baseKey: 'baselineCash' | 'baselineCustomers' | 'baselineDistributions';
  data: ReturnType<typeof longRunSeries>;
  horizonDays: number;
  yLabel: string;
  testId: string;
  money: boolean;
  compare: boolean;
}) {
  const startMonth = useStore((s) => s.company.startMonth);
  const cal = useMemo(() => buildCalendar(startMonth, horizonDays), [startMonth, horizonDays]);
  const ticks = useMemo(() => {
    const firsts = cal.filter((c) => c.dayOfMonth === 1).map((c) => c.day);
    const step = horizonDays > 730 ? 6 : 3;
    return [0, ...firsts.filter((_, i) => i % step === step - 1)];
  }, [cal, horizonDays]);
  const f = (v: number) => (isMoney ? money(v) : num(v));
  return (
    <div className="h-[260px] w-full" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebe8de" />
          <XAxis
            dataKey="day"
            type="number"
            domain={[0, horizonDays - 1]}
            ticks={ticks}
            tickFormatter={(d: number) => {
              const c = cal[d];
              return c ? `${MONTHS[c.month]} y${Math.floor(d / 365) + 1}` : '';
            }}
            tickLine={false}
            axisLine={{ stroke: '#cfcbbd' }}
          />
          <YAxis
            width={isMoney ? 64 : 48}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => (isMoney ? moneyCompact(v) : num(v))}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 11, fill: '#5f6a63', textAnchor: 'middle' } }}
          />
          {isMoney && dataKey === 'cash' && <ReferenceLine y={0} stroke="#8d968f" />}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              const b = p[baseKey] as number | undefined;
              return (
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] shadow-sm">
                  <div className="font-medium text-ink">{dayLabel(startMonth, p.day)}</div>
                  <div className="num mt-1 text-ink">{f(p[dataKey])}</div>
                  {compare && b !== undefined && <div className="num text-muted">Baseline {f(b)}</div>}
                </div>
              );
            }}
          />
          {compare && <Line dataKey={baseKey} stroke="#8d968f" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
          <Line dataKey={dataKey} stroke="#1d2420" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LongRunCharts({ showDraft, hasDraft }: { showDraft: boolean; hasDraft: boolean }) {
  const baseline = useStore((s) => s.baselineResult);
  const draft = useStore((s) => s.draftResult);
  const r = showDraft ? draft : baseline;
  const compare = showDraft && hasDraft;
  const data = useMemo(() => longRunSeries(r, compare ? baseline : undefined), [r, baseline, compare]);
  const anyDist = baseline.totals.cashFlow.ownerDistributions !== 0 || draft.totals.cashFlow.ownerDistributions !== 0;
  if (baseline.horizonDays <= 365) return null;

  const legend = (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 bg-ink" /> {showDraft ? 'Draft' : 'Baseline'}
      </li>
      {compare && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-faint" /> Baseline
        </li>
      )}
    </ul>
  );
  const sub = 'Weekly points for display; every point is the engine value for that day.';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Cash over the whole horizon" subtitle={sub}>
          <LongChart dataKey="cash" baseKey="baselineCash" data={data} horizonDays={r.horizonDays} yLabel="USD, end of day" testId="longrun-cash" money compare={compare} />
          {legend}
        </Card>
        <Card title="Active customers over the whole horizon" subtitle={sub}>
          <LongChart dataKey="customers" baseKey="baselineCustomers" data={data} horizonDays={r.horizonDays} yLabel="Customers" testId="longrun-customers" money={false} compare={compare} />
          {legend}
        </Card>
      </div>
      {anyDist && (
        <Card title="Owner distributions, cumulative" subtitle="Running total of cash the owner has taken out. Distributions are not an expense, so they reduce cash but not profit.">
          <LongChart dataKey="distributions" baseKey="baselineDistributions" data={data} horizonDays={r.horizonDays} yLabel="USD, cumulative" testId="longrun-distributions" money compare={compare} />
          {legend}
        </Card>
      )}
    </div>
  );
}
