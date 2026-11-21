import { useState, type ReactNode } from 'react';
import { HORIZON_OPTIONS, selectHasUserWork, useStore, type ViewId } from '@/services/store';
import { Button, Icon, Notice, Segmented, cx } from './ui';
import { CompanyFileControls } from './CompanyFiles';

export const VIEWS: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: 'operations', label: 'Operations', icon: <Icon.Map /> },
  { id: 'financials', label: 'Financials', icon: <Icon.Chart /> },
  { id: 'business', label: 'Business', icon: <Icon.Wrench /> },
  { id: 'optimize', label: 'Optimize', icon: <Icon.Target /> },
];

const SAMPLE = '';
const USER = 'user-company';

/** Confirms before switching away from a company with edits or a plan. */
function ScenarioSwitcher() {
  const industry = useStore((s) => s.industry);
  const demoId = useStore((s) => s.demoScenarioId);
  const source = useStore((s) => s.companySource);
  const userName = useStore((s) => s.userCompany?.company.name);
  const hasWork = useStore(selectHasUserWork);
  const setDemo = useStore((s) => s.setDemoScenario);
  const activateUserCompany = useStore((s) => s.activateUserCompany);
  const [asked, setAsked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demos = industry.demoScenarios ?? [];
  const current = demos.find((d) => d.id === demoId);

  const active = source === 'user' ? USER : demoId ?? SAMPLE;
  const switchTo = (value: string) => {
    setError(null);
    setAsked(null);
    try {
      if (value === USER) activateUserCompany();
      else setDemo(value === SAMPLE ? null : value);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not switch companies.');
    }
  };
  const choose = (value: string) => {
    if (value === active) return;
    if (hasWork) setAsked(value);
    else switchTo(value);
  };
  const askedName = asked === USER ? userName : asked === SAMPLE ? `the ${industry.name.toLowerCase()} sample company` : demos.find((d) => d.id === asked)?.name;
  return (
    <>
      <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
        <span className="whitespace-nowrap">Company</span>
        <select
          aria-label="Company or demo scenario"
          value={active}
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
          {userName && <option value={USER}>{userName} (imported)</option>}
        </select>
      </label>
      {asked !== null && (
        <div className="flex basis-full flex-wrap items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-ink" role="alertdialog" aria-label="Confirm switching company">
          <span className="wrap-anywhere">Switch to {askedName}? Your draft, adopted changes, conditions and edited assumptions will be discarded.</span>
          <Button
            size="sm"
            variant="danger"
            onClick={() => switchTo(asked)}
          >
            Switch and discard
          </Button>
          <Button size="sm" onClick={() => setAsked(null)}>
            Keep current
          </Button>
        </div>
      )}
      {error && <Notice tone="error" className="basis-full">{error}</Notice>}
    </>
  );
}

export function Header({ guideOpen, openGuide, closeGuide }: { guideOpen: boolean; openGuide: () => void; closeGuide: () => void }) {
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
                  onClick={() => { setView(v.id); closeGuide(); }}
                  aria-current={!guideOpen && view === v.id ? 'page' : undefined}
                  className={cx(
                    'rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors',
                    !guideOpen && view === v.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-ink',
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
          <CompanyFileControls openGuide={openGuide} onImported={closeGuide} />
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
export function MobileNav({ guideOpen, closeGuide }: { guideOpen: boolean; closeGuide: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <nav aria-label="Views" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden">
      <ul className="grid grid-cols-4">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => { setView(v.id); closeGuide(); }}
              aria-current={!guideOpen && view === v.id ? 'page' : undefined}
              className={cx('flex w-full flex-col items-center gap-0.5 py-2 text-[11.5px] font-medium', !guideOpen && view === v.id ? 'text-accent' : 'text-muted')}
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
