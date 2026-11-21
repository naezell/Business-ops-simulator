import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ParamMeta, Provenance } from '@/simulation';
import { UNIT_PREFIX, UNIT_SUFFIX, decimalsForStep, fromDisplayValue, num, provenanceLabel, toDisplayValue } from '@/services/format';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ───────────────────────── Icons ─────────────────────────

type IconProps = { className?: string };
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  Close: ({ className = 'h-3.5 w-3.5' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  Play: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M4.5 2.8v10.4a.5.5 0 0 0 .77.42l8-5.2a.5.5 0 0 0 0-.84l-8-5.2a.5.5 0 0 0-.77.42z" />
    </svg>
  ),
  Pause: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <rect x="3.5" y="2.5" width="3" height="11" rx=".8" />
      <rect x="9.5" y="2.5" width="3" height="11" rx=".8" />
    </svg>
  ),
  Chevron: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M4 6l4 4 4-4" />
    </svg>
  ),
  Sun: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </svg>
  ),
  PartlyCloudy: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M5.5 5a2.2 2.2 0 0 1 4.2-.8M3 12.5h7.5a2.5 2.5 0 0 0 .3-4.98A3.3 3.3 0 0 0 4.4 8.2 2.2 2.2 0 0 0 3 12.5z" />
    </svg>
  ),
  Rain: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M4 9.5h6.8a2.4 2.4 0 0 0 .2-4.8A3.4 3.4 0 0 0 4.5 5.6 2 2 0 0 0 4 9.5zM5.5 11.5l-.7 1.8M8.5 11.5l-.7 1.8M11.5 11.5l-.7 1.8" />
    </svg>
  ),
  Alert: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M8 2.2l6.2 11H1.8L8 2.2zM8 6.5v3M8 11.5v.1" />
    </svg>
  ),
  Info: ({ className = 'h-4 w-4' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2V11M8 5v.1" />
    </svg>
  ),
  Undo: ({ className = 'h-3.5 w-3.5' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M5.5 3L2.5 6l3 3M3 6h6.5a4 4 0 0 1 0 8H6" />
    </svg>
  ),
  Plus: ({ className = 'h-3.5 w-3.5' }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} {...base} aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  Map: ({ className = 'h-5 w-5' }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} {...base} aria-hidden>
      <path d="M2.5 5.5l5-2 5 2 5-2v11l-5 2-5-2-5 2v-11zM7.5 3.5v11M12.5 5.5v11" />
    </svg>
  ),
  Chart: ({ className = 'h-5 w-5' }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} {...base} aria-hidden>
      <path d="M3 16.5h14M5 14V9M9 14V5M13 14v-6M17 14V7" />
    </svg>
  ),
  Wrench: ({ className = 'h-5 w-5' }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} {...base} aria-hidden>
      <path d="M12.5 3.5a4 4 0 0 0-3.8 5.2l-6 6a1.6 1.6 0 0 0 2.3 2.3l6-6a4 4 0 0 0 5.2-3.8l-2.4 2.4-2.1-.6-.6-2.1 2.4-2.4z" />
    </svg>
  ),
  Target: ({ className = 'h-5 w-5' }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} {...base} aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 10l.01 0" />
    </svg>
  ),
};

// ───────────────────────── Layout ─────────────────────────

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx('min-w-0 rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Collapsible card section. */
export function Disclosure({
  title,
  subtitle,
  defaultOpen = false,
  children,
  id,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  id?: string;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight text-ink">{title}</span>
          {subtitle && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-3 text-muted">
          {right}
          <Icon.Chevron className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && <div className="border-t border-line p-4">{children}</div>}
    </section>
  );
}

// ───────────────────────── Controls ─────────────────────────

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  className,
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}) {
  const variants = {
    primary: 'bg-accent text-white border-accent hover:bg-[#244f74] disabled:bg-faint disabled:border-faint',
    secondary: 'bg-surface text-ink border-line-strong hover:bg-sunken disabled:text-faint disabled:bg-sunken',
    ghost: 'bg-transparent text-muted border-transparent hover:bg-sunken hover:text-ink disabled:text-faint',
    danger: 'bg-surface text-bad border-line-strong hover:bg-bad-soft disabled:text-faint',
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13.5px]',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('inline-flex rounded-md border border-line-strong bg-sunken p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-[5px] font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[12.5px]' : 'px-3 py-1.5 text-[13px]',
              on ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors', checked ? 'border-accent bg-accent' : 'border-line-strong bg-line')}
    >
      <span className={cx('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
    </button>
  );
}

// ───────────────────────── Provenance ─────────────────────────

const PROV_STYLE: Record<Provenance, string> = {
  'verified-calculation': 'bg-good-soft text-good border-transparent',
  'user-provided': 'bg-accent-soft text-accent border-accent/30',
  'industry-assumption': 'bg-warn-soft text-warn border-transparent',
  'synthetic-demo': 'bg-[#eceae3] text-muted border-transparent',
};

export function ProvenanceBadge({ provenance, edited }: { provenance: Provenance; edited?: boolean }) {
  const p: Provenance = edited ? 'user-provided' : provenance;
  return (
    <span
      className={cx('inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-medium leading-4', PROV_STYLE[p])}
      title={
        p === 'industry-assumption'
          ? 'Illustrative default. Not a verified industry benchmark.'
          : p === 'synthetic-demo'
            ? 'Fabricated value for the demonstration company.'
            : p === 'user-provided'
              ? 'Supplied or edited by you.'
              : 'Output of the simulation engine.'
      }
    >
      {provenanceLabel(p)}
    </span>
  );
}

// ───────────────────────── Numeric inputs ─────────────────────────

/** Unit-aware number input that commits only valid in-range values. */
export function NumberField({
  value,
  meta,
  onCommit,
  ariaLabel,
  className,
  min,
  max,
  step,
  unit,
}: {
  value: number;
  meta?: Pick<ParamMeta, 'unit' | 'min' | 'max' | 'step'>;
  onCommit: (v: number) => void;
  ariaLabel: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: ParamMeta['unit'];
}) {
  const u = meta?.unit ?? unit ?? 'count';
  const lo = meta?.min ?? min ?? 0;
  const hi = meta?.max ?? max ?? 1e9;
  const st = meta?.step ?? step ?? 1;
  const dispStep = u === 'fraction' ? st * 100 : st;
  const decimals = decimalsForStep(dispStep);
  const format = (v: number) => num(toDisplayValue(v, u), decimals).replace(/,/g, '').replace('−', '-');
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed) && fromDisplayValue(parsed, u) >= lo - 1e-9 && fromDisplayValue(parsed, u) <= hi + 1e-9;
  const prefix = UNIT_PREFIX[u];
  const suffix = u === 'fraction' ? '%' : UNIT_SUFFIX[u];
  return (
    <span className={cx('inline-flex flex-col', className)}>
      <span
        className={cx(
          'inline-flex h-8 items-center gap-1 rounded-md border bg-surface px-2 text-[13px] focus-within:border-accent',
          valid ? 'border-line-strong' : 'border-bad',
        )}
      >
        {prefix && <span className="text-faint">{prefix}</span>}
        <input
          aria-label={ariaLabel}
          aria-invalid={!valid}
          inputMode="decimal"
          className="num w-full min-w-0 bg-transparent text-right text-ink outline-none"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(format(value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(format(value));
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const n = Number(t);
            if (t.trim() !== '' && Number.isFinite(n)) {
              const v = fromDisplayValue(n, u);
              if (v >= lo - 1e-9 && v <= hi + 1e-9) onCommit(v);
            }
          }}
        />
        {suffix && <span className="whitespace-nowrap text-faint">{suffix}</span>}
      </span>
      {!valid && (
        <span className="mt-0.5 text-[11.5px] text-bad num">
          {prefix}
          {num(toDisplayValue(lo, u), decimals)} to {prefix}
          {num(toDisplayValue(hi, u), decimals)}
          {suffix}
        </span>
      )}
    </span>
  );
}

export function SliderField({
  label,
  valueText,
  value,
  min,
  max,
  step,
  onChange,
  ticks,
  hint,
  right,
}: {
  label: ReactNode;
  valueText: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  ticks?: [string, string];
  hint?: ReactNode;
  right?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <span className="flex items-center gap-2">
          <span className="num text-[13px] font-semibold text-ink">{valueText}</span>
          {right}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {ticks && (
        <div className="-mt-0.5 flex justify-between text-[11px] text-faint num">
          <span>{ticks[0]}</span>
          <span>{ticks[1]}</span>
        </div>
      )}
      {hint && <p className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

// ───────────────────────── Deltas ─────────────────────────

export type Better = 'higher' | 'lower' | 'neutral';

/** Colours a signed difference by whether it is better or worse. */
export function DeltaText({
  delta,
  text,
  better = 'higher',
  className,
  epsilon = 1e-9,
}: {
  delta: number;
  text: string;
  better?: Better;
  className?: string;
  epsilon?: number;
}) {
  const zero = Math.abs(delta) <= epsilon;
  const good = better === 'higher' ? delta > 0 : better === 'lower' ? delta < 0 : false;
  const color = zero || better === 'neutral' ? 'text-muted' : good ? 'text-good' : 'text-bad';
  return (
    <span className={cx('num whitespace-nowrap font-medium', color, className)} data-delta={zero ? 'zero' : good ? 'better' : 'worse'}>
      {text}
    </span>
  );
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-line bg-sunken text-muted',
    warn: 'border-[#e6d3a0] bg-warn-soft text-warn',
    error: 'border-[#e5b9b4] bg-bad-soft text-bad',
  } as const;
  return (
    <div className={cx('flex gap-2 rounded-md border px-3 py-2 text-[13px] leading-snug', tones[tone], className)} role={tone === 'error' ? 'alert' : undefined}>
      <span className="mt-px shrink-0">{tone === 'info' ? <Icon.Info className="h-4 w-4" /> : <Icon.Alert className="h-4 w-4" />}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaText,
  better,
  sub,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: number;
  deltaText?: string;
  better?: Better;
  sub?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5" title={hint}>
      <div className="text-[12px] leading-tight text-muted">{label}</div>
      <div className="num mt-0.5 text-[20px] font-semibold leading-tight text-ink">{value}</div>
      <div className="num mt-0.5 min-h-4 text-[12px] leading-tight text-muted">
        {sub}
        {delta !== undefined && deltaText && <DeltaText delta={delta} text={deltaText} better={better} className={cx(sub ? 'ml-1.5' : undefined)} />}
      </div>
    </div>
  );
}
