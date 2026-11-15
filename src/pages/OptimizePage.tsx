import { useMemo, useState, type ReactNode } from 'react';
import type { CandidateEvaluation, Distribution, Objective, OptimizationResult } from '@/optimization';
import { scenarioKey, useStore } from '@/services/store';
import { money, num, signed, signedMoney } from '@/services/format';
import { Button, Card, DeltaText, Icon, Notice, Segmented, cx } from '@/components/ui';
import { BottleneckCard, RangeBar, Tag, Waterfall, improvedText, paybackText, ratioShift, scaleOf } from '@/components/optimize/parts';

const OBJECTIVES: { value: Objective; label: string; title: string }[] = [
  { value: 'net-profit', label: 'Net profit', title: 'Rank by change in net profit before income tax over the period.' },
  { value: 'ending-cash', label: 'Ending cash', title: 'Rank by change in cash (minus any line of credit owed) at the end of the period.' },
];

const PHASES = [
  { id: 'baseline', label: 'Measuring today' },
  { id: 'singles', label: 'Trying single changes' },
  { id: 'plans', label: 'Combining the best' },
] as const;

const objDist = (c: CandidateEvaluation, o: Objective): Distribution => (o === 'net-profit' ? c.deltaNetProfit : c.deltaEndingCash);

export function OptimizePage() {
  const opt = useStore((s) => s.opt);
  const draftCount = useStore((s) => s.draftActions.length);
  const draftIssues = useStore((s) => s.draftIssues);
  const key = useStore((s) => scenarioKey(s));
  const start = useStore((s) => s.startOptimization);
  const cancel = useStore((s) => s.cancelOptimization);
  const [objective, setObjective] = useState<Objective>(opt.result?.objective ?? opt.objective);

  const running = opt.status === 'running';
  const blocked = draftIssues.some((i) => i.severity === 'error');
  const result = opt.result;
  const stale = result !== null && opt.resultKey !== key;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <Card
        title="What to change next"
        subtitle={
          <>
            Starts from your current scenario{draftCount > 0 ? ` (baseline plus ${draftCount} draft ${draftCount === 1 ? 'change' : 'changes'})` : ''} and
            tests each option and the best combinations, so the answer is what to do next on top of it.
          </>
        }
        actions={
          <>
            <Segmented ariaLabel="Objective" size="sm" value={objective} onChange={setObjective} options={OBJECTIVES} />
            {running ? (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            ) : (
              <Button variant="primary" disabled={blocked} onClick={() => start(objective)} title={blocked ? 'Fix the scenario errors first.' : undefined}>
                <Icon.Target className="h-4 w-4" />
                {result ? 'Run again' : 'Find what to change'}
              </Button>
            )}
          </>
        }
      >
        {running && opt.progress && <Progress phase={opt.progress.phase} completed={opt.progress.completed} total={opt.progress.total} />}
        {!running && !result && opt.status !== 'error' && (
          <p className="text-[13.5px] leading-snug text-muted">
            The search runs the simulation many times (about 5 to 10 seconds) under five sets of random conditions and compares every option with
            today. You can keep using the other views while it runs.
          </p>
        )}
        {opt.status === 'error' && (
          <Notice tone="error">
            <div className="font-medium">The optimizer could not finish.</div>
            <div className="mt-0.5">{opt.error}</div>
          </Notice>
        )}
        {stale && !running && (
          <Notice tone="warn" className="mt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">These results are out of date.</span> The scenario changed after they were computed
                {opt.appliedIds.length > 0 ? ' (a recommendation was applied)' : ''}. Run again to see what to change next.
              </span>
              <Button size="sm" variant="secondary" disabled={blocked} onClick={() => start(objective)}>
                Run again
              </Button>
            </div>
          </Notice>
        )}
        {result && !running && !stale && (
          <p className="text-[12.5px] text-muted">
            Ranked by change in {result.objective === 'net-profit' ? 'net profit before income tax' : 'ending cash'}, over{' '}
            {result.seeds.length} sets of random conditions, {num(result.simulationsRun)} simulations in {num(result.elapsedMs / 1000, 1)} s.
          </p>
        )}
      </Card>

      {result && <Results result={result} stale={stale} />}
      <Honesty />
    </div>
  );
}

function Progress({ phase, completed, total }: { phase: 'baseline' | 'singles' | 'plans'; completed: number; total: number }) {
  const idx = PHASES.findIndex((p) => p.id === phase);
  const frac = total > 0 ? Math.min(1, completed / total) : 0;
  return (
    <div role="status" aria-live="polite" data-opt-progress>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {PHASES.map((p, i) => (
          <span key={p.id} className={cx(i === idx ? 'font-semibold text-ink' : i < idx ? 'text-good' : 'text-faint')}>
            {i + 1}. {p.label}
          </span>
        ))}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="num mt-1 text-[12px] text-muted">
        {PHASES[idx]?.label}: {num(completed)} of {num(total)} simulations
      </div>
    </div>
  );
}

function Results({ result, stale }: { result: OptimizationResult; stale: boolean }) {
  const o = result.objective;
  const recommended = result.candidates.filter((c) => c.recommended);
  const others = result.candidates.filter((c) => !c.recommended);
  const best = result.bestPlan;
  const multi = best !== null && best.actions.length > 1;
  const bestSingleId = best && best.actions.length === 1 ? (result.candidates.find((c) => c.id === best.id)?.id ?? null) : null;
  const scale = useMemo(() => scaleOf(result.candidates.map((c) => objDist(c, o))), [result, o]);

  return (
    <div className={cx('space-y-4', stale && 'opacity-80')} data-stale={stale ? 'true' : 'false'}>
      {best && multi && (
        <section aria-label="Best plan">
          <div className="mb-1.5 flex items-baseline gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Best plan found</h2>
            <span className="text-[12.5px] text-muted">{best.actions.length} changes together</span>
          </div>
          <CandidateRow c={best} o={o} scale={scaleOf([objDist(best, o)])} stale={stale} badge="Best plan" emphasis />
        </section>
      )}

      {result.bottlenecks.length > 0 && (
        <section aria-label="Bottlenecks">
          <h2 className="mb-1.5 text-[15px] font-semibold text-ink">What is holding the business back</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.bottlenecks.map((b, i) => (
              <BottleneckCard key={b.kind + (b.relatedJobTypeId ?? '') + (b.relatedReason ?? '')} b={b} rank={i + 1} />
            ))}
          </div>
        </section>
      )}

      <section aria-label="Recommendations">
        <h2 className="mb-1.5 text-[15px] font-semibold text-ink">Recommended changes</h2>
        {recommended.length === 0 ? (
          <Notice>
            <div className="font-medium text-ink">Nothing tested clearly beats the current scenario.</div>
            <p className="mt-0.5">No single change improved the result in enough of the random conditions. That is a useful answer: the current set-up is hard to beat with these options.</p>
          </Notice>
        ) : (
          <>
            <Legend />
            <ul className="space-y-2">
              {recommended.map((c, i) => (
                <li key={c.id}>
                  <CandidateRow c={c} o={o} scale={scale} stale={stale} rank={i + 1} badge={c.id === bestSingleId ? 'Best single change' : undefined} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {others.length > 0 && (
        <Fold
          title="Evaluated but not recommended"
          subtitle={`${others.length} options that did not clearly help. Seeing what loses money is useful too.`}
          id="not-recommended"
        >
          <Legend />
          <ul className="space-y-2">
            {others.map((c) => (
              <li key={c.id}>
                <CandidateRow c={c} o={o} scale={scale} stale={stale} quiet />
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {result.infeasible.length > 0 && (
        <Fold title="Not feasible" subtitle={`${result.infeasible.length} options ruled out by cash, capacity or the guard rails.`} id="infeasible">
          <ul className="divide-y divide-line">
            {result.infeasible.map((c) => (
              <li key={c.id} className="py-2">
                <div className="text-[13.5px] font-medium text-ink">{c.label}</div>
                <ul className="mt-0.5 list-disc pl-5 text-[12.5px] text-muted">
                  {c.infeasibleReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}

function Fold({ title, subtitle, children, id }: { title: string; subtitle: string; children: ReactNode; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className="rounded-lg border border-line bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{subtitle}</span>
        </span>
        <Icon.Chevron className={cx('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-line p-3">{children}</div>}
    </section>
  );
}

function Legend() {
  return (
    <p className="mb-2 text-[12px] leading-snug text-muted">
      The bar shows the worst to best result across the random conditions; the dark tick is the average and the dashed line is no change.
    </p>
  );
}

function CandidateRow({
  c,
  o,
  scale,
  stale,
  rank,
  badge,
  quiet,
  emphasis,
}: {
  c: CandidateEvaluation;
  o: Objective;
  scale: { lo: number; hi: number };
  stale: boolean;
  rank?: number;
  badge?: string;
  quiet?: boolean;
  emphasis?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const applied = useStore((s) => s.opt.appliedIds.includes(c.id));
  const apply = useStore((s) => s.applyPlannedActions);
  const d = objDist(c, o);
  const { n, k } = improvedText(c);
  const customers = c.deltaEndCustomers?.mean ?? 0;
  const objLabel = o === 'net-profit' ? 'net profit' : 'ending cash';
  return (
    <div
      className={cx(
        'min-w-0 rounded-lg border bg-surface',
        emphasis ? 'border-accent/50 shadow-[0_0_0_1px_var(--color-accent-soft)]' : 'border-line',
        quiet && 'bg-sunken',
      )}
      data-candidate={c.id}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="block w-full px-3 py-2.5 text-left lg:grid lg:grid-cols-[minmax(0,1.5fr)_8.5rem_minmax(9rem,1fr)] lg:items-center lg:gap-4"
      >
        <span className="flex min-w-0 items-start gap-2">
          {rank !== undefined && <span className="num mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11.5px] font-semibold text-accent">{rank}</span>}
          <span className="min-w-0">
            <span className={cx('block text-[14px] leading-snug', quiet ? 'font-medium text-muted' : 'font-semibold text-ink')}>{c.label}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {badge && <Tag tone="accent">{badge}</Tag>}
              {c.assumptionSensitive && (
                <Tag tone="warn" title="Illustrative price-sensitivity, churn or marketing-response assumptions drive this result.">
                  depends on price-sensitivity assumptions
                </Tag>
              )}
              <Tag tone={c.confidence === 'high' ? 'good' : c.confidence === 'low' ? 'warn' : 'neutral'} title="How consistent the result is across random conditions.">
                {c.confidence} confidence
              </Tag>
              {applied && <Tag tone="good">applied</Tag>}
            </span>
          </span>
        </span>
        <span className="mt-2 flex items-baseline justify-between gap-2 lg:mt-0 lg:block lg:text-right">
          <span className="text-[11.5px] text-muted lg:block">Change in {objLabel}</span>
          <DeltaText delta={d.mean} text={signedMoney(d.mean)} better="higher" className={cx('text-[16px]', quiet && 'opacity-80')} epsilon={0.5} />
        </span>
        <span className="mt-1 block min-w-0 lg:mt-0">
          <RangeBar dist={d} lo={scale.lo} hi={scale.hi} />
          <span className="num flex justify-between text-[11px] text-muted">
            <span>{signedMoney(d.min)}</span>
            <span>{signedMoney(d.max)}</span>
          </span>
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 pb-2.5 text-[12.5px] text-muted">
        <span>
          Improved in <span className="num font-medium text-ink">{n} of {k}</span> conditions
        </span>
        <span>
          Upfront cash <span className="num font-medium text-ink">{money(c.upfrontCash)}</span>
        </span>
        <span>
          Payback <span className="font-medium text-ink">{paybackText(c)}</span>
        </span>
        {Math.abs(customers) >= 0.5 && (
          <span>
            Customers at end <DeltaText delta={customers} text={signed(customers, 1)} better="higher" epsilon={0.05} />
          </span>
        )}
      </div>

      {open && (
        <div className="space-y-4 border-t border-line px-3 py-3">
          <ul className="space-y-1.5 text-[13.5px] leading-snug text-ink">
            {c.explanation.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div>
              <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">Where the profit change comes from</h3>
              <Waterfall drivers={c.drivers} total={c.deltaNetProfit.mean} />
            </div>
            <div>
              <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">Operations, before → after</h3>
              <dl className="space-y-1 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Utilization</dt>
                  <dd className="num text-ink">{ratioShift(c.utilization.before, c.utilization.after)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Missed-job rate</dt>
                  <dd className="num text-ink">{ratioShift(c.missedJobRate.before, c.missedJobRate.after)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Lowest cash in any condition</dt>
                  <dd className="num text-ink">{money(c.minCash)}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={stale || applied}
              title={stale ? 'These results are out of date. Run again first.' : undefined}
              onClick={() => {
                apply(c.actions, c.id);
              }}
            >
              <Icon.Plus className="h-3.5 w-3.5" />
              {applied ? 'Applied to draft' : 'Apply to draft'}
            </Button>
            <span className="text-[12px] text-muted">
              {applied ? 'Added to the draft changes above. Results below are now out of date.' : 'Adds this as draft changes you can remove from the bar above. Nothing is adopted until you say so.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Honesty() {
  return (
    <footer className="rounded-lg border border-line bg-sunken px-4 py-3 text-[12.5px] leading-snug text-muted" aria-label="How to read these results">
      <h2 className="mb-1 text-[12.5px] font-semibold text-ink">How to read these results</h2>
      <ul className="list-disc space-y-1 pl-4">
        <li>
          Results hold only for the period you chose and the assumptions behind the model. Price sensitivity, customer churn and breakdown rates are
          illustrative unless you replaced them with your own numbers.
        </li>
        <li>The search is a smart shortcut, not a proof. It finds the best plan among the options it generated and tried, not necessarily the best plan that exists.</li>
        <li>
          The ranges come from a small number of random conditions (weather, absences, breakdowns, demand). They show how much a result can vary; they are not
          statistical confidence intervals.
        </li>
      </ul>
    </footer>
  );
}
