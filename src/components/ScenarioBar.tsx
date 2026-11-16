import { useState } from 'react';
import { selectHasDraft, useStore } from '@/services/store';
import { describeAction, kpisOf, type Kpis } from '@/services/derive';
import { money, num, percent, signed, signedMoney, signedPoints } from '@/services/format';
import { Button, DeltaText, Icon, Notice, cx, type Better } from './ui';
import { useProjections } from './hooks';

interface KpiDef {
  id: keyof Kpis;
  label: string;
  better: Better;
  show: (v: number) => string;
  diff: (d: number) => string;
  eps: number;
  hint?: string;
}

const KPIS: KpiDef[] = [
  { id: 'netProfit', label: 'Net profit before income tax', better: 'higher', show: (v) => money(v), diff: (d) => signedMoney(d), eps: 0.5 },
  { id: 'revenue', label: 'Revenue', better: 'higher', show: (v) => money(v), diff: (d) => signedMoney(d), eps: 0.5 },
  { id: 'endingCash', label: 'Ending cash', better: 'higher', show: (v) => money(v), diff: (d) => signedMoney(d), eps: 0.5 },
  {
    id: 'lowestCash',
    label: 'Lowest cash',
    better: 'higher',
    show: (v) => money(v),
    diff: (d) => signedMoney(d),
    eps: 0.5,
    hint: 'Lowest end-of-day cash balance during the period.',
  },
  { id: 'jobsCompleted', label: 'Jobs completed', better: 'higher', show: (v) => num(v), diff: (d) => signed(d), eps: 0.5 },
  {
    id: 'missedJobRate',
    label: 'Missed-job rate',
    better: 'lower',
    show: (v) => percent(v),
    diff: (d) => signedPoints(d),
    eps: 0.00005,
    hint: 'Cancelled jobs as a share of completed plus cancelled. Higher is worse.',
  },
  {
    id: 'utilization',
    label: 'Utilization',
    better: 'higher',
    show: (v) => percent(v),
    diff: (d) => signedPoints(d),
    eps: 0.00005,
    hint: 'On-site hours as a share of paid hours.',
  },
];

export function ScenarioBar() {
  const baselineResult = useStore((s) => s.baselineResult);
  const draftResult = useStore((s) => s.draftResult);
  const draftActions = useStore((s) => s.draftActions);
  const baselineActions = useStore((s) => s.baselineActions);
  const pending = useStore((s) => s.pending);
  const draftIssues = useStore((s) => s.draftIssues);
  const baselineIssues = useStore((s) => s.baselineIssues);
  const removeDraftAt = useStore((s) => s.removeDraftAt);
  const draftRules = useStore((s) => s.draft.rules);
  const setDraftRules = useStore((s) => s.setDraftRules);
  const resetDraft = useStore((s) => s.resetDraft);
  const adoptDraft = useStore((s) => s.adoptDraft);
  const { ctx } = useProjections();
  const [confirming, setConfirming] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const hasDraft = useStore(selectHasDraft);
  const hasActions = draftActions.length > 0;
  const b = kpisOf(baselineResult);
  const d = kpisOf(draftResult);
  const errors = [...baselineIssues, ...draftIssues].filter((i) => i.severity === 'error');
  const warnings = draftResult.warnings;

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-[1500px] px-4 pb-3 pt-3 md:px-6">
        <div
          className={cx('grid grid-cols-2 gap-x-4 gap-y-3 transition-opacity sm:grid-cols-4 xl:grid-cols-7', pending && 'opacity-60')}
          aria-label="Baseline versus draft results"
          aria-busy={pending}
        >
          {KPIS.map((k) => {
            const bv = b[k.id];
            const dv = d[k.id];
            const delta = dv - bv;
            return (
              <div key={k.id} className="min-w-0 border-l-2 border-line pl-3" title={k.hint} data-kpi={k.id}>
                <div className="text-[12px] leading-tight text-muted">{k.label}</div>
                <div className="num mt-0.5 text-[19px] font-semibold leading-tight text-ink" data-kpi-value>
                  {k.show(dv)}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5 text-[12px] leading-tight">
                  {hasDraft ? (
                    <>
                      <span className="num text-muted">was {k.show(bv)}</span>
                      <DeltaText delta={delta} text={Math.abs(delta) <= k.eps ? 'no change' : k.diff(delta)} better={k.better} epsilon={k.eps} />
                    </>
                  ) : (
                    <span className="hidden text-faint sm:inline">Baseline</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="text-[12px] font-medium text-muted">Draft changes</span>
          {!hasDraft && <span className="text-[12.5px] text-faint">None yet. Make a change in the Business view and it appears here.</span>}
          {draftActions.map((pa, i) => (
            <span
              key={`${i}-${describeAction(pa.action, ctx)}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/30 bg-accent-soft py-0.5 pl-2.5 pr-1 text-[12.5px] text-accent"
              data-chip
            >
              <span className="truncate">{describeAction(pa.action, ctx)}</span>
              <button
                type="button"
                aria-label={`Remove change: ${describeAction(pa.action, ctx)}`}
                onClick={() => removeDraftAt(i)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-accent hover:bg-accent/15"
              >
                <Icon.Close className="h-3 w-3" />
              </button>
            </span>
          ))}
          {draftRules.map((rule) => (
            <span
              key={rule.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/30 bg-accent-soft py-0.5 pl-2.5 pr-1 text-[12.5px] text-accent"
              data-chip
              data-rule-chip
              title="Decision rule"
            >
              <span className="truncate">Rule: {rule.name}</span>
              <button
                type="button"
                aria-label={`Remove rule: ${rule.name}`}
                onClick={() => setDraftRules(draftRules.filter((x) => x.id !== rule.id))}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-accent hover:bg-accent/15"
              >
                <Icon.Close className="h-3 w-3" />
              </button>
            </span>
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {baselineActions.length > 0 && (
              <span className="text-[12px] text-muted" title="Decisions you adopted earlier are part of the baseline.">
                Baseline includes {baselineActions.length} adopted {baselineActions.length === 1 ? 'change' : 'changes'}
              </span>
            )}
            {warnings.length > 0 && (
              <button type="button" onClick={() => setNotesOpen(!notesOpen)} className="text-[12px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
                {warnings.length} model {warnings.length === 1 ? 'note' : 'notes'}
              </button>
            )}
            {confirming ? (
              <>
                <span className="text-[12.5px] text-ink">Make these {draftActions.length} changes the new baseline?</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    adoptDraft();
                    setConfirming(false);
                  }}
                >
                  Adopt
                </Button>
                <Button size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" disabled={!hasDraft} onClick={resetDraft}>
                  Reset draft
                </Button>
                <Button size="sm" variant="primary" disabled={!hasActions} onClick={() => setConfirming(true)}>
                  Adopt draft as baseline
                </Button>
              </>
            )}
          </span>
        </div>

        {notesOpen && warnings.length > 0 && (
          <Notice tone="warn" className="mt-2">
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}
        {errors.length > 0 && (
          <Notice tone="error" className="mt-2">
            <div className="font-medium">The simulation cannot run with these inputs. Results below show the last valid run.</div>
            <ul className="mt-1 list-disc pl-4">
              {errors.slice(0, 6).map((e) => (
                <li key={e.path + e.message}>
                  {e.path}: {e.message}
                </li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </div>
  );
}
