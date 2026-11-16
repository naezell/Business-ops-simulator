import { useState, type ReactNode } from 'react';
import { HORIZON_OPTIONS, selectHasUserWork, useStore, type ViewId } from '@/services/store';
import { Button, Icon, Segmented, cx } from './ui';

export const VIEWS: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: 'operations', label: 'Operations', icon: <Icon.Map /> },
  { id: 'financials', label: 'Financials', icon: <Icon.Chart /> },
  { id: 'business', label: 'Business', icon: <Icon.Wrench /> },
  { id: 'optimize', label: 'Optimize', icon: <Icon.Target /> },
];

const SAMPLE = '';

/** Chooses between the industry's sample company and its demo scenarios; confirms before discarding work. */
function ScenarioSwitcher() {
  const industry = useStore((s) => s.industry);
  const demoId = useStore((s) => s.demoScenarioId);
  const hasWork = useStore(selectHasUserWork);
  const setDemo = useStore((s) => s.setDemoScenario);
  const [asked, setAsked] = useState<string | null>(null);
  const demos = industry.demoScenarios ?? [];
  if (demos.length === 0) return null;
  const current = demos.find((d) => d.id === demoId);
  const choose = (value: string) => {
    const next = value === SAMPLE ? null : value;
    if (next === demoId) return;
    if (hasWork) setAsked(value);
    else setDemo(next);
  };
  const askedName = asked === null ? '' : asked === SAMPLE ? `the ${industry.name.toLowerCase()} sample company` : (demos.find((d) => d.id === asked)?.name ?? asked);
  return (
    <>
      <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
        <span className="whitespace-nowrap">Company</span>
        <select
          aria-label="Company or demo scenario"
          value={demoId ?? SAMPLE}
          onChange={(e) => choose(e.target.value)}
          className="h-8 min-w-0 max-w-[15rem] rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink"
          title={current?.description}
        >
          <option value={SAMPLE}>{industry.name} sample company</option>
          {demos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {asked !== null && (
        <div className="flex basis-full flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-ink" role="alertdialog" aria-label="Confirm switching company">
          <span>Switch to {askedName}? Your draft, adopted changes, conditions and edited assumptions belong to the current company and will be discarded.</span>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setDemo(asked === SAMPLE ? null : asked);
              setAsked(null);
            }}
          >
            Switch and discard
          </Button>
          <Button size="sm" onClick={() => setAsked(null)}>
            Keep current
          </Button>
        </div>
      )}
    </>
  );
}

export function Header() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const name = useStore((s) => s.company.name);
  const horizonMonths = useStore((s) => s.horizonMonths);
  const setHorizonMonths = useStore((s) => s.setHorizonMonths);
  const seed = useStore((s) => s.seed);
  const demoDays = useStore((s) => (s.demoScenarioId ? s.horizonDays : null));
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
          <ScenarioSwitcher />
          {demoDays !== null ? (
            <span className="text-[12.5px] text-muted" title="This demo scenario has a fixed horizon.">
              Horizon <span className="num font-medium text-ink">{demoDays} days</span>
            </span>
          ) : (
            <Segmented
              ariaLabel="Simulation horizon"
              size="sm"
              value={horizonMonths}
              onChange={setHorizonMonths}
              options={HORIZON_OPTIONS.map((m) => ({ value: m as number, label: `${m} mo`, title: `Simulate the next ${m} months` }))}
            />
          )}
          <span className="flex items-center gap-2 text-[12.5px] text-muted">
            <span title="Seed of the random conditions (weather, breakdowns, absences, demand). Baseline and draft share it, so differences come from your decisions.">
              Seed <span className="num font-medium text-ink">{seed}</span>
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
