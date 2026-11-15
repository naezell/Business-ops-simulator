import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildCalendar } from '@/simulation';
import { useStore } from '@/services/store';
import {
  COST_GROUPS,
  INCOME_ROWS,
  cashBridge,
  cashSeries,
  jobTypeRows,
  monthlyPoints,
  payrollDays,
  shortfallRanges,
  type JobTypeRow,
} from '@/services/derive';
import { MONTHS, dayLabel, money, moneyCompact, num, percent, signedMoney, signedPoints, signedRelative } from '@/services/format';
import { Card, DeltaText, Notice, Segmented, StatTile, cx } from '@/components/ui';

// ───────────────────────── KPI row ─────────────────────────

function KpiRow({ showDraft }: { showDraft: boolean }) {
  const baseline = useStore((s) => s.baselineResult);
  const draft = useStore((s) => s.draftResult);
  const r = showDraft ? draft : baseline;
  const t = r.totals;
  const b = baseline.totals;
  const tiles: {
    label: string;
    value: number;
    base: number;
    kind: 'money' | 'pct';
    hint?: string;
  }[] = [
    { label: 'Revenue', value: t.income.revenue, base: b.income.revenue, kind: 'money' },
    {
      label: 'Gross margin',
      value: t.income.revenue > 0 ? t.income.grossProfit / t.income.revenue : 0,
      base: b.income.revenue > 0 ? b.income.grossProfit / b.income.revenue : 0,
      kind: 'pct',
      hint: 'Gross profit divided by revenue.',
    },
    { label: 'Operating profit', value: t.income.operatingProfit, base: b.income.operatingProfit, kind: 'money' },
    { label: 'Net profit before income tax', value: t.income.netProfit, base: b.income.netProfit, kind: 'money' },
    { label: 'Ending cash', value: t.balance.cash, base: b.balance.cash, kind: 'money' },
    {
      label: 'Available cash',
      value: t.balance.availableCash,
      base: b.balance.availableCash,
      kind: 'money',
      hint: 'Cash minus payroll owed minus your cash reserve, plus unused line of credit.',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((k) => {
        const delta = k.value - k.base;
        return (
          <StatTile
            key={k.label}
            label={k.label}
            hint={k.hint}
            value={k.kind === 'money' ? money(k.value) : percent(k.value)}
            delta={showDraft ? delta : undefined}
            deltaText={showDraft ? (k.kind === 'money' ? signedMoney(delta) : signedPoints(delta)) : undefined}
            better="higher"
            sub={showDraft ? <span>was {k.kind === 'money' ? money(k.base) : percent(k.base)}</span> : undefined}
          />
        );
      })}
    </div>
  );
}

// ───────────────────────── Monthly P&L chart ─────────────────────────

function PnlChart({ showDraft }: { showDraft: boolean }) {
  const r = useStore((s) => (showDraft ? s.draftResult : s.baselineResult));
  const data = useMemo(() => monthlyPoints(r), [r]);
  return (
    <div>
      <div className="h-[280px] w-full" data-testid="pnl-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ebe8de" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#cfcbbd' }} />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => moneyCompact(v)}
              label={{ value: 'USD per month', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 11, fill: '#5f6a63', textAnchor: 'middle' } }}
            />
            <ReferenceLine y={0} stroke="#8d968f" />
            <Tooltip
              cursor={{ fill: 'rgba(43,95,138,0.06)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] shadow-sm">
                    <div className="font-medium text-ink">{label}</div>
                    <table className="num mt-1">
                      <tbody>
                        <tr>
                          <td className="pr-4 text-muted">Revenue</td>
                          <td className="text-right text-ink">{money(p.income.revenue)}</td>
                        </tr>
                        {COST_GROUPS.map((g) => (
                          <tr key={g.id}>
                            <td className="pr-4 text-muted">
                              <i className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: g.color }} />
                              {g.label}
                            </td>
                            <td className="text-right text-ink">{money(p[g.id] as number)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="pr-4 pt-1 font-medium text-ink">Net profit</td>
                          <td className="pt-1 text-right font-medium text-ink">{money(p.income.netProfit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              }}
            />
            {COST_GROUPS.map((g) => (
              <Bar key={g.id} dataKey={g.id} stackId="costs" fill={g.color} stroke="#fff" strokeWidth={0.5} isAnimationActive={false} />
            ))}
            <Line dataKey="revenue" stroke="#1d2420" strokeWidth={2} dot={{ r: 2.5, fill: '#1d2420' }} isAnimationActive={false} />
            <Line dataKey="netProfit" stroke="#2b5f8a" strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 2.5, fill: '#2b5f8a' }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-ink" /> Revenue
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-accent" /> Net profit before income tax
        </li>
        {COST_GROUPS.map((g) => (
          <li key={g.id} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: g.color }} /> {g.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────── P&L table ─────────────────────────

function PnlTable({ hasDraft, showDraft }: { hasDraft: boolean; showDraft: boolean }) {
  const baseline = useStore((s) => s.baselineResult);
  const draft = useStore((s) => s.draftResult);
  const [mode, setMode] = useState<'compare' | 'monthly'>('compare');
  const effective = hasDraft ? mode : 'monthly';
  const r = showDraft ? draft : baseline;
  const bt = baseline.totals.income;
  const dt = draft.totals.income;

  return (
    <Card
      title="Income statement"
      subtitle="Accrual basis, in US dollars. Costs are shown as positive amounts that reduce profit; profit is before income tax."
      actions={
        hasDraft ? (
          <Segmented
            ariaLabel="Table layout"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'compare', label: 'Baseline vs draft' },
              { value: 'monthly', label: 'By month' },
            ]}
          />
        ) : undefined
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[640px] border-collapse text-[13px]" data-testid="pnl-table">
          <thead>
            <tr className="border-b border-line bg-sunken text-[12px] text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-sunken px-4 py-2 text-left font-medium">
                Line
              </th>
              {effective === 'compare' ? (
                <>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Baseline</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Draft</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Change %</th>
                </>
              ) : (
                <>
                  {r.months.map((m) => (
                    <th key={m.index} scope="col" className="px-3 py-2 text-right font-medium">
                      {MONTHS[m.month]}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2 text-right font-semibold text-ink">Total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {INCOME_ROWS.map((row) => {
              const sub = row.kind === 'subtotal';
              const better = row.kind === 'cost' ? 'lower' : 'higher';
              const a = bt[row.key];
              const b = dt[row.key];
              return (
                <tr key={row.key} className={cx('border-b border-line/70', sub && 'bg-sunken font-semibold')}>
                  <th
                    scope="row"
                    className={cx('sticky left-0 z-10 px-4 py-1.5 text-left font-normal', sub ? 'bg-sunken font-semibold text-ink' : 'bg-surface text-muted')}
                  >
                    {row.label}
                  </th>
                  {effective === 'compare' ? (
                    <>
                      <td className="px-3 py-1.5 text-right">{money(a)}</td>
                      <td className="px-3 py-1.5 text-right">{money(b)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <DeltaText delta={b - a} text={signedMoney(b - a)} better={better} epsilon={0.5} />
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <DeltaText delta={b - a} text={signedRelative(a, b) || '–'} better={better} epsilon={0.5} />
                      </td>
                    </>
                  ) : (
                    <>
                      {r.months.map((m) => (
                        <td key={m.index} className="px-3 py-1.5 text-right">
                          {money(m.income[row.key])}
                        </td>
                      ))}
                      <td className="px-4 py-1.5 text-right font-semibold text-ink">{money(r.totals.income[row.key])}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ───────────────────────── Cash chart ─────────────────────────

function CashChart({ showDraft, hasDraft }: { showDraft: boolean; hasDraft: boolean }) {
  const baseline = useStore((s) => s.baselineResult);
  const draft = useStore((s) => s.draftResult);
  const startMonth = useStore((s) => s.company.startMonth);
  const r = showDraft ? draft : baseline;
  const data = useMemo(() => cashSeries(r, showDraft && hasDraft ? baseline : undefined), [r, baseline, showDraft, hasDraft]);
  const ranges = useMemo(() => shortfallRanges(r), [r]);
  const payDays = useMemo(() => payrollDays(r), [r]);
  const monthTicks = useMemo(() => {
    const cal = buildCalendar(startMonth, r.horizonDays);
    return cal.filter((c) => c.dayOfMonth === 1).map((c) => c.day);
  }, [startMonth, r.horizonDays]);
  const cal = useMemo(() => buildCalendar(startMonth, r.horizonDays), [startMonth, r.horizonDays]);

  return (
    <div>
      <div className="h-[300px] w-full" data-testid="cash-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ebe8de" />
            <XAxis
              dataKey="day"
              type="number"
              domain={[0, r.horizonDays - 1]}
              ticks={monthTicks}
              tickFormatter={(d: number) => MONTHS[cal[d]?.month ?? 0]}
              tickLine={false}
              axisLine={{ stroke: '#cfcbbd' }}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => moneyCompact(v)}
              label={{ value: 'USD, end of day', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 11, fill: '#5f6a63', textAnchor: 'middle' } }}
            />
            <ReferenceLine y={0} stroke="#8d968f" />
            {ranges.map(([a, b]) => (
              <ReferenceArea key={a} x1={a} x2={b + 1} fill="#a8322a" fillOpacity={0.14} stroke="none" ifOverflow="extendDomain" />
            ))}
            {payDays.map((d) => (
              <ReferenceLine key={d} x={d} stroke="#cfcbbd" strokeDasharray="1 3" />
            ))}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                const rec = r.days[p.day];
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] shadow-sm">
                    <div className="font-medium text-ink">{dayLabel(startMonth, p.day)}</div>
                    <table className="num mt-1">
                      <tbody>
                        <tr>
                          <td className="pr-4 text-muted">Cash</td>
                          <td className="text-right text-ink">{money(p.cash)}</td>
                        </tr>
                        <tr>
                          <td className="pr-4 text-muted">Available cash</td>
                          <td className="text-right text-ink">{money(p.availableCash)}</td>
                        </tr>
                        <tr>
                          <td className="pr-4 text-muted">Line of credit drawn</td>
                          <td className="text-right text-ink">{money(p.loc)}</td>
                        </tr>
                        {p.baselineCash !== undefined && (
                          <tr>
                            <td className="pr-4 text-muted">Baseline cash</td>
                            <td className="text-right text-ink">{money(p.baselineCash)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {rec.cashFlow.payrollPaid > 0 && <div className="mt-1 text-muted">Payroll day: {money(rec.cashFlow.payrollPaid)} paid</div>}
                    {rec.cashShortfall && <div className="mt-1 font-medium text-bad">Cash shortfall</div>}
                  </div>
                );
              }}
            />
            {data[0]?.baselineCash !== undefined && (
              <Line dataKey="baselineCash" stroke="#8d968f" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            )}
            <Line dataKey="loc" stroke="#c2662d" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="availableCash" stroke="#2b5f8a" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="cash" stroke="#1d2420" strokeWidth={2.2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-ink" /> Cash
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-accent" /> Available cash
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[#c2662d]" /> Line of credit drawn
        </li>
        {showDraft && hasDraft && (
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-faint" /> Baseline cash
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-bad/20" /> Cash shortfall
          {ranges.length === 0 && <span className="text-faint">(none)</span>}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0 border-l border-dotted border-line-strong" /> Payroll day
        </li>
      </ul>
    </div>
  );
}

// ───────────────────────── Cash bridge ─────────────────────────

function Bridge({ showDraft }: { showDraft: boolean }) {
  const r = useStore((s) => (showDraft ? s.draftResult : s.baselineResult));
  const startingCash = useStore((s) => s.company.finance.startingCash);
  const steps = useMemo(() => cashBridge(r), [r]);
  const geo = useMemo(() => {
    let run = 0;
    const rows = steps.map((s) => {
      const from = s.kind === 'net' ? 0 : run;
      const to = s.kind === 'net' ? s.value : run + s.value;
      if (s.kind !== 'net') run = to;
      return { ...s, lo: Math.min(from, to), hi: Math.max(from, to) };
    });
    const min = Math.min(0, ...rows.map((x) => x.lo));
    const max = Math.max(0, ...rows.map((x) => x.hi));
    return { rows, min, span: Math.max(1, max - min) };
  }, [steps]);
  return (
    <div>
      <div className="space-y-1.5" role="table" aria-label="Cash flow bridge">
        {geo.rows.map((s) => {
          const left = ((s.lo - geo.min) / geo.span) * 100;
          const width = Math.max(0.4, ((s.hi - s.lo) / geo.span) * 100);
          const zero = ((0 - geo.min) / geo.span) * 100;
          const color = s.kind === 'net' ? '#1d2420' : s.value >= 0 ? '#1c7048' : '#a8322a';
          return (
            <div key={s.key} role="row" className="grid grid-cols-[9.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 sm:grid-cols-[11rem_minmax(0,1fr)_7rem]">
              <div role="cell" className={cx('text-[13px]', s.kind === 'net' ? 'font-semibold text-ink' : 'text-muted')}>
                {s.label}
              </div>
              <div role="cell" className="relative h-4">
                <div className="absolute inset-y-0 w-px bg-line-strong" style={{ left: `${zero}%` }} />
                <div className="absolute top-0.5 h-3 rounded-sm" style={{ left: `${left}%`, width: `${width}%`, background: color }} />
              </div>
              <div role="cell" className={cx('num text-right text-[13px]', s.kind === 'net' ? 'font-semibold text-ink' : 'text-ink')}>
                {s.kind === 'net' ? signedMoney(s.value) : signedMoney(s.value)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12.5px] text-muted">
        Starting cash {money(startingCash)} plus the net change gives ending cash{' '}
        {money(r.totals.balance.cash)}.
      </p>
    </div>
  );
}

// ───────────────────────── Job-type profitability ─────────────────────────

type SortKey = keyof Pick<
  JobTypeRow,
  'name' | 'jobsCompleted' | 'revenue' | 'laborCost' | 'materials' | 'fuel' | 'contribution' | 'margin' | 'perOnSiteHour'
>;

function JobTypeTable({ showDraft }: { showDraft: boolean }) {
  const r = useStore((s) => (showDraft ? s.draftResult : s.baselineResult));
  const jobTypes = useStore((s) => s.company.jobTypes);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'contribution', dir: 'desc' });
  const rows = useMemo(() => {
    const list = jobTypeRows(r, jobTypes);
    const k = sort.key;
    return list.sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      const c = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === 'asc' ? c : -c;
    });
  }, [r, jobTypes, sort]);

  const cols: { key: SortKey; label: string; fmt: (row: JobTypeRow) => string; title?: string }[] = [
    { key: 'name', label: 'Job type', fmt: (x) => x.name },
    { key: 'jobsCompleted', label: 'Jobs', fmt: (x) => num(x.jobsCompleted) },
    { key: 'revenue', label: 'Revenue', fmt: (x) => money(x.revenue) },
    { key: 'laborCost', label: 'Labor', fmt: (x) => money(x.laborCost), title: 'Loaded wages for on-site and inbound travel time. Excludes idle time and overtime premium.' },
    { key: 'materials', label: 'Materials', fmt: (x) => money(x.materials) },
    { key: 'fuel', label: 'Fuel', fmt: (x) => money(x.fuel) },
    { key: 'contribution', label: 'Contribution', fmt: (x) => money(x.contribution), title: 'Revenue minus labor, materials and fuel.' },
    { key: 'margin', label: 'Margin', fmt: (x) => percent(x.margin), title: 'Contribution divided by revenue.' },
    { key: 'perOnSiteHour', label: 'Per on-site hour', fmt: (x) => money(x.perOnSiteHour, 2), title: 'Contribution divided by person-hours on site.' },
  ];

  return (
    <Card
      title="Job-type profitability"
      subtitle="Contribution after labor, materials and fuel, before overhead and depreciation. Select a column heading to sort."
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[720px] border-collapse text-[13px]" data-testid="jobtype-table">
          <thead>
            <tr className="border-b border-line bg-sunken text-[12px] text-muted">
              {cols.map((c) => {
                const on = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cx('px-3 py-2 font-medium first:px-4 last:px-4', c.key === 'name' ? 'text-left' : 'text-right')}
                  >
                    <button
                      type="button"
                      title={c.title}
                      onClick={() => setSort(on ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.key === 'name' ? 'asc' : 'desc' })}
                      className={cx('inline-flex items-center gap-1 hover:text-ink', on && 'text-ink')}
                    >
                      {c.label}
                      <span aria-hidden className="inline-block w-2 text-[10px]">
                        {on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line/70">
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      'px-3 py-1.5 first:px-4 last:px-4',
                      c.key === 'name' ? 'text-left text-ink' : 'text-right',
                      c.key === 'contribution' && (row.contribution < 0 ? 'font-semibold text-bad' : 'font-semibold text-ink'),
                    )}
                  >
                    {c.fmt(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ───────────────────────── Page ─────────────────────────

export function FinancialsPage() {
  const hasDraft = useStore((s) => s.draftActions.length > 0);
  const [which, setWhich] = useState<'baseline' | 'draft'>('draft');
  const showDraft = hasDraft && which === 'draft';
  return (
    <div className="space-y-4">
      {hasDraft && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-muted">Showing</span>
          <Segmented
            ariaLabel="Scenario shown"
            size="sm"
            value={which}
            onChange={setWhich}
            options={[
              { value: 'baseline', label: 'Baseline' },
              { value: 'draft', label: 'Draft' },
            ]}
          />
        </div>
      )}
      <KpiRow showDraft={showDraft} />
      <Notice>
        <span className="font-medium text-ink">Profit, cash and available cash are three different things.</span> Profit counts a job when it is
        finished, whether or not the customer has paid. Cash is the money in the bank today. Available cash is what you could spend
        safely: cash, minus wages you owe, minus your reserve, plus the unused line of credit.
      </Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Monthly profit and loss" subtitle="Costs stacked by group, with revenue and net profit before income tax.">
          <PnlChart showDraft={showDraft} />
        </Card>
        <Card title="Cash balance" subtitle="Daily cash, available cash and line-of-credit balance.">
          <CashChart showDraft={showDraft} hasDraft={hasDraft} />
        </Card>
      </div>
      <PnlTable hasDraft={hasDraft} showDraft={showDraft} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Where the cash went" subtitle="Cash-flow bridge for the whole horizon, in US dollars.">
          <Bridge showDraft={showDraft} />
        </Card>
        <JobTypeTable showDraft={showDraft} />
      </div>
    </div>
  );
}
