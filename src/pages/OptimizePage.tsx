import { useMemo, useState, type ReactNode } from 'react';
import type { Objective, StudyResult } from '@/optimization';
import { scenarioKey, useStore } from '@/services/store';
import { num } from '@/services/format';
import { Button, Card, Icon, Notice, Segmented, cx } from '@/components/ui';
import { BottleneckCard, Tag, scaleOf } from '@/components/optimize/parts';
import { BaselineSummary, CapacitySection, LossAttribution, SectionTitle, StrategyCard } from '@/components/optimize/StudySections';
import { hiddenCount, phaseStates, visibleStrategies } from '@/components/optimize/studyModel';

const OBJECTIVES: { value: Objective; label: string; title: string }[] = [
  { value: 'net-profit', label: 'Net profit', title: 'Rank by change in net profit before income tax over the period.' },
  { value: 'ending-cash', label: 'Ending cash', title: 'Rank by change in cash (minus any line of credit owed) at the end of the period.' },
];

export function OptimizePage() {
  const study = useStore((s) => s.study);
  const draftCount = useStore((s) => s.draftActions.length);
  const draftIssues = useStore((s) => s.draftIssues);
  const key = useStore((s) => scenarioKey(s));
  const start = useStore((s) => s.startStudy);
  const cancel = useStore((s) => s.cancelStudy);
  const [objective, setObjective] = useState<Objective>(study.result?.objective ?? study.objective);

  const running = study.status === 'running';
  const blocked = draftIssues.some((i) => i.severity === 'error');
  const result = study.result;
  const stale = result !== null && study.resultKey !== key && !running;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4" data-study-view>
      <Card
        title="What to change next"
        subtitle={
          <>
            A study of your current scenario{draftCount > 0 ? ` (baseline plus ${draftCount} draft ${draftCount === 1 ? 'change' : 'changes'})` : ''}: where the
            business loses money, how much more it could take on, and which changes, and when, are worth making.
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
                {result ? 'Run again' : 'Start study'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="neutral" title="The company in this app is a built-in demonstration. Its numbers are made up and illustrative, not benchmarks.">
              Synthetic demonstration data
            </Tag>
            <span className="text-[12px] text-muted">Results describe this simulated company under the assumptions shown, not a forecast.</span>
          </div>

          {(running || result) && <StudyHeader running={running} />}

          {!running && !result && study.status !== 'error' && (
            <p className="text-[13.5px] leading-snug text-muted">
              The study runs the simulation many times (roughly 10 to 30 seconds), in stages. Findings appear as each stage finishes. You can keep using the
              other views while it runs.
            </p>
          )}
          {study.status === 'error' && (
            <Notice tone="error">
              <div className="font-medium">The study could not finish.</div>
              <div className="mt-0.5">{study.error}</div>
            </Notice>
          )}
          {stale && (
            <Notice tone="warn" className="mt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">These results are out of date.</span> The scenario changed after they were computed
                  {study.appliedIds.length > 0 ? ' (a strategy was adopted into the draft)' : ''}. Run again to see what to change next.
                </span>
                <Button size="sm" variant="secondary" disabled={blocked} onClick={() => start(objective)}>
                  Run again
                </Button>
              </div>
            </Notice>
          )}
          {!running && study.partial && result && (
            <Notice tone="info">
              <span className="font-medium">Partial result.</span> The study was stopped before every stage finished; what is shown comes from the stages that did.
            </Notice>
          )}
        </div>
      </Card>

      {result && <Findings result={result} stale={stale} running={running} />}
      <Honesty />
    </div>
  );
}

function StudyHeader({ running }: { running: boolean }) {
  const study = useStore((s) => s.study);
  const result = study.result;
  const phases = phaseStates(result?.phasesCompleted ?? [], running ? (study.progress?.phase ?? null) : null);
  const p = study.progress;
  const frac = p && p.total > 0 ? Math.min(1, p.completed / p.total) : 0;
  const active = phases.find((x) => x.state === 'active');
  return (
    <div role="status" aria-live="polite" data-study-progress className="space-y-2">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {phases.map((x, i) => (
          <li key={x.id} data-phase={x.id} data-state={x.state} className={cx(x.state === 'active' ? 'font-semibold text-ink' : x.state === 'done' ? 'text-good' : 'text-faint')}>
            {x.state === 'done' ? '✓ ' : `${i + 1}. `}
            {x.label}
          </li>
        ))}
      </ol>
      {running && (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${frac * 100}%` }} />
          </div>
          {p && active && (
            <div className="num text-[12px] text-muted">
              {active.label}: {num(p.completed)} of {num(p.total)}
            </div>
          )}
        </>
      )}
      {result && (
        <div className="num flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-muted" data-study-counts>
          <span>
            <span className="font-medium text-ink">{num(result.feasibleStrategiesEvaluated)}</span> feasible strategies evaluated
          </span>
          <span>
            <span className="font-medium text-ink">{num(result.simulationsRun)}</span> simulations
          </span>
          <span>{result.seeds.length} sets of random conditions</span>
          {!running && <span>{num(result.elapsedMs / 1000, 1)} s</span>}
          {result.budgetExhausted && (
            <Tag tone="warn" title="The study stopped searching because it reached its simulation budget. Better strategies may exist.">
              budget limit reached
            </Tag>
          )}
        </div>
      )}
    </div>
  );
}

function Findings({ result, stale, running }: { result: StudyResult; stale: boolean; running: boolean }) {
  const [all, setAll] = useState(false);
  const shown = visibleStrategies(result, all);
  const hidden = hiddenCount(result);
  const scale = useMemo(() => scaleOf(result.strategies.map((s) => s.deltaNetProfit)), [result]);
  const done = (p: string) => (result.phasesCompleted as string[]).includes(p);
  const o = result.objective;

  return (
    <div className={cx('space-y-5', stale && 'opacity-80')} data-stale={stale ? 'true' : 'false'}>
      <section aria-label="Today">
        <SectionTitle note={`Mean and range across ${result.seeds.length} sets of random conditions, over ${num(result.horizonDays)} days.`}>Today, without changes</SectionTitle>
        <BaselineSummary b={result.baseline} />
      </section>

      {result.bottlenecks.length > 0 && (
        <section aria-label="Bottlenecks">
          <SectionTitle>What is holding the business back</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.bottlenecks.map((b, i) => (
              <BottleneckCard key={b.kind + (b.relatedJobTypeId ?? '') + (b.relatedReason ?? '')} b={b} rank={i + 1} />
            ))}
          </div>
        </section>
      )}

      {result.lossAttribution.length > 0 && (
        <section aria-label="Loss attribution">
          <SectionTitle note="How much profit each source of loss costs, found by removing it in the simulation.">Where the money leaks</SectionTitle>
          <LossAttribution sources={result.lossAttribution} />
        </section>
      )}

      {result.capacity && (
        <section aria-label="Capacity">
          <SectionTitle note="How far the customer base can grow before service suffers, measured by running the simulation with more customers.">Capacity</SectionTitle>
          <CapacitySection c={result.capacity} />
        </section>
      )}
      {!result.capacity && running && !done('capacity') && <p className="text-[12.5px] text-muted">Capacity results will appear when that stage finishes.</p>}

      <section aria-label="Strategies">
        <SectionTitle
          note={`Ranked by score: the smaller of the yearly gain inside the plan and over the long run, in ${o === 'net-profit' ? 'net profit' : 'ending cash'} terms. Not a forecast.`}
        >
          Strategies
        </SectionTitle>
        {result.strategies.length === 0 ? (
          running && !done('singles') ? (
            <p className="text-[12.5px] text-muted">Strategies will appear once single changes have been tried.</p>
          ) : (
            <Notice>
              <div className="font-medium text-ink">No feasible strategy was found.</div>
            </Notice>
          )
        ) : (
          <>
            {running && !done('validation') && (
              <Notice tone="info" className="mb-2">
                Preliminary ranking. Long-run and stress checks are still running, so verdicts can change.
              </Notice>
            )}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] leading-snug text-muted">
                The bar shows the worst to best result across the random conditions; the dark tick is the average and the dashed line is no change.
              </p>
              {hidden > 0 && (
                <Segmented
                  ariaLabel="Which strategies to show"
                  size="sm"
                  value={all ? 'all' : 'rec'}
                  onChange={(v) => setAll(v === 'all')}
                  options={[
                    { value: 'rec', label: 'Recommended and conditional' },
                    { value: 'all', label: `All (${result.strategies.length})` },
                  ]}
                />
              )}
            </div>
            {shown.length === 0 ? (
              <Notice>
                <div className="font-medium text-ink">Nothing tested is recommended.</div>
                <p className="mt-0.5">{hidden} strategies were evaluated and none clearly beats the current scenario. Show all to see what loses money.</p>
              </Notice>
            ) : (
              <ul className="space-y-2">
                {shown.map((s, i) => (
                  <li key={s.id}>
                    <StrategyCard s={s} scale={scale} rank={i + 1} stale={stale || running} quiet={s.verdict === 'not-recommended'} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

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

function Honesty() {
  return (
    <footer className="rounded-lg border border-line bg-sunken px-4 py-3 text-[12.5px] leading-snug text-muted" aria-label="How to read these results">
      <h2 className="mb-1 text-[12.5px] font-semibold text-ink">How to read these results</h2>
      <ul className="list-disc space-y-1 pl-4">
        <li>The company is a synthetic demonstration. Default values are illustrative assumptions, not benchmarks, unless you replaced them with your own numbers.</li>
        <li>Nothing here is a forecast. Figures describe what the simulation produced under the conditions and assumptions tested.</li>
        <li>Loss figures are upper bounds: they show the most a source could cost if it vanished completely, and they overlap, so they do not add up.</li>
        <li>The search is a smart shortcut, not a proof. It finds the best strategy among those it generated and tried, not necessarily the best that exists.</li>
        <li>Ranges come from a small number of random conditions. They show how much a result can vary; they are not statistical confidence intervals.</li>
      </ul>
    </footer>
  );
}
