import type { ReactNode } from 'react';
import type { Bottleneck, CandidateEvaluation, Distribution, ProfitDriver } from '@/optimization';
import { INCOME_ROWS } from '@/services/derive';
import { money, moneyCompact, num, percent, signedMoney } from '@/services/format';
import { cx } from '../ui';

// ───────────────────────── Range bar ─────────────────────────

/** Min–max across seeds on a shared scale, mean tick, and a visible zero line. */
export function RangeBar({ dist, lo, hi, className }: { dist: Distribution; lo: number; hi: number; className?: string }) {
  const span = hi - lo || 1;
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  const left = ((dist.min - lo) / span) * 100;
  const width = Math.max(0.8, ((dist.max - dist.min) / span) * 100);
  const allBelow = dist.max < 0;
  const allAbove = dist.min > 0;
  return (
    <div
      className={cx('relative h-5', className)}
      role="img"
      aria-label={`Range across conditions ${signedMoney(dist.min)} to ${signedMoney(dist.max)}, mean ${signedMoney(dist.mean)}`}
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
      <div
        className={cx('absolute top-1/2 h-2 -translate-y-1/2 rounded-sm', allAbove ? 'bg-good/35' : allBelow ? 'bg-bad/35' : 'bg-accent/30')}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
      <div className="absolute top-0.5 bottom-0.5 w-0 border-l border-dashed border-ink/60" style={{ left: at(0) }} title="Zero: no change from today" />
      <div className="absolute top-1 bottom-1 w-[3px] -translate-x-1/2 rounded-sm bg-ink" style={{ left: at(dist.mean) }} title={`Mean ${signedMoney(dist.mean)}`} />
    </div>
  );
}

/** Shared scale for a list of distributions, always including zero. */
export function scaleOf(dists: Distribution[]): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const d of dists) {
    lo = Math.min(lo, d.min);
    hi = Math.max(hi, d.max);
  }
  const pad = (hi - lo) * 0.04 || 1;
  return { lo: lo - (lo < 0 ? pad : 0), hi: hi + (hi > 0 ? pad : 0) };
}

// ───────────────────────── Driver waterfall ─────────────────────────

const LABEL: Record<string, string> = Object.fromEntries(INCOME_ROWS.map((r) => [r.key as string, r.label.replace(/ \(.*\)$/, '')]));

export function Waterfall({ drivers, total }: { drivers: ProfitDriver[]; total: number }) {
  const rows = drivers.filter((d) => Math.abs(d.delta) >= 0.5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (rows.length === 0) return <p className="text-[13px] text-muted">No line of the income statement moves by more than $1.</p>;
  let run = 0;
  const steps = rows.map((d) => {
    const start = run;
    run += d.delta;
    return { ...d, start, end: run };
  });
  const all = [0, ...steps.flatMap((s) => [s.start, s.end])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const zero = pos(0);
  return (
    <ul className="space-y-1" aria-label="Change in net profit by income statement line">
      {steps.map((s) => {
        const a = pos(Math.min(s.start, s.end));
        const w = Math.max(0.6, Math.abs(pos(s.end) - pos(s.start)));
        return (
          <li key={s.line} className="grid grid-cols-[7.5rem_minmax(0,1fr)_5rem] items-center gap-2 text-[12.5px] sm:grid-cols-[10rem_minmax(0,1fr)_5.5rem]">
            <span className="truncate text-muted">{LABEL[s.line] ?? s.line}</span>
            <span className="relative h-4">
              <span className="absolute inset-y-0 w-0 border-l border-line-strong" style={{ left: `${zero}%` }} />
              <span className={cx('absolute top-0.5 bottom-0.5 rounded-sm', s.delta >= 0 ? 'bg-good/70' : 'bg-bad/70')} style={{ left: `${a}%`, width: `${w}%` }} />
            </span>
            <span className={cx('num text-right font-medium', s.delta >= 0 ? 'text-good' : 'text-bad')}>{signedMoney(s.delta)}</span>
          </li>
        );
      })}
      <li className="grid grid-cols-[7.5rem_minmax(0,1fr)_5rem] items-center gap-2 border-t border-line pt-1 text-[12.5px] font-semibold sm:grid-cols-[10rem_minmax(0,1fr)_5.5rem]">
        <span className="text-ink">Net profit change</span>
        <span />
        <span className={cx('num text-right', total >= 0 ? 'text-good' : 'text-bad')}>{signedMoney(total)}</span>
      </li>
    </ul>
  );
}

// ───────────────────────── Small pieces ─────────────────────────

export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'accent'; title?: string }) {
  const tones = {
    neutral: 'bg-[#eceae3] text-muted',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    accent: 'bg-accent-soft text-accent',
  } as const;
  return (
    <span title={title} className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium leading-4', tones[tone])}>
      {children}
    </span>
  );
}

export function SeverityBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Severity ${Math.round(v * 100)} out of 100`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div className={cx('h-full rounded-full', v >= 0.66 ? 'bg-bad' : v >= 0.33 ? 'bg-[#c58a1f]' : 'bg-faint')} style={{ width: `${v * 100}%` }} />
      </div>
      <span className="num w-8 shrink-0 text-right text-[11.5px] text-muted">{Math.round(v * 100)}</span>
    </div>
  );
}

export function BottleneckCard({ b, rank }: { b: Bottleneck; rank: number }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-surface p-3" data-bottleneck={b.kind}>
      <div className="flex items-start gap-2">
        <span className="num mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sunken text-[11.5px] font-semibold text-muted">{rank}</span>
        <h3 className="text-[14px] font-semibold leading-snug text-ink">{b.headline}</h3>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-muted">{b.detail}</p>
      <div className="mt-auto pt-3">
        <SeverityBar value={b.severity} />
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12.5px]">
          <span className="text-muted">Severity</span>
          <span className="num text-ink">
            about {money(Math.round(b.estimatedAnnualImpact / 100) * 100)} a year <Tag tone="warn" title="Estimated from baseline diagnostics. Not a promise of recoverable profit.">estimate</Tag>
          </span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Formatting helpers ─────────────────────────

export function paybackText(c: CandidateEvaluation): string {
  if (c.upfrontCash <= 0) return 'no upfront cost';
  if (c.paybackDays === null) return 'not paid back in this period';
  const d = Math.round(c.paybackDays);
  return d >= 60 ? `about ${num(d / 30.4, 1).replace(/\.0$/, '')} months` : `${d} days`;
}

export const improvedText = (c: CandidateEvaluation): { n: number; k: number } => {
  const k = c.seedsEvaluated;
  return { n: Math.round(c.probabilityOfImprovement * k), k };
};

export function ratioShift(before: number, after: number): string {
  return `${percent(before)} → ${percent(after)}`;
}

export { moneyCompact };
