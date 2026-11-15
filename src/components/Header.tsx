import type { ReactNode } from 'react';
import { HORIZON_OPTIONS, useStore, type ViewId } from '@/services/store';
import { num } from '@/services/format';
import { Button, Icon, Segmented, cx } from './ui';

export const VIEWS: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: 'operations', label: 'Operations', icon: <Icon.Map /> },
  { id: 'financials', label: 'Financials', icon: <Icon.Chart /> },
  { id: 'business', label: 'Business', icon: <Icon.Wrench /> },
  { id: 'optimize', label: 'Optimize', icon: <Icon.Target /> },
];

export function Header() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const name = useStore((s) => s.company.name);
  const horizonMonths = useStore((s) => s.horizonMonths);
  const setHorizonMonths = useStore((s) => s.setHorizonMonths);
  const seed = useStore((s) => s.seed);
  const reroll = useStore((s) => s.rerollSeed);

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-faint">Business Operations Simulator</div>
          <div className="truncate text-[15px] font-semibold leading-tight text-ink">{name}</div>
        </div>

        <nav aria-label="Views" className="hidden md:block">
          <ul className="flex gap-1">
            {VIEWS.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setView(v.id)}
                  aria-current={view === v.id ? 'page' : undefined}
                  className={cx(
                    'rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors',
                    view === v.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-ink',
                  )}
                >
                  {v.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            ariaLabel="Simulation horizon"
            size="sm"
            value={horizonMonths}
            onChange={setHorizonMonths}
            options={HORIZON_OPTIONS.map((m) => ({ value: m as number, label: `${m} mo`, title: `Simulate the next ${m} months` }))}
          />
          <span className="flex items-center gap-2 text-[12.5px] text-muted">
            <span title="Seed of the random conditions (weather, breakdowns, absences, demand). Baseline and draft share it, so differences come from your decisions.">
              Seed <span className="num font-medium text-ink">{num(seed)}</span>
            </span>
            <Button size="sm" onClick={reroll} title="Draw a new set of random conditions">
              Re-roll conditions
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Bottom navigation for narrow screens. */
export function MobileNav() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <nav aria-label="Views" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden">
      <ul className="grid grid-cols-4">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
              className={cx('flex w-full flex-col items-center gap-0.5 py-2 text-[11.5px] font-medium', view === v.id ? 'text-accent' : 'text-muted')}
            >
              {v.icon}
              {v.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
