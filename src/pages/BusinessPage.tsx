import { useState } from 'react';
import { useStore } from '@/services/store';
import { Button, Disclosure, Notice } from '@/components/ui';
import { CrewsSection, FleetSection } from '@/components/business/PeopleSection';
import { MarketingSection, PricingSection, SchedulingSection } from '@/components/business/DecisionsSection';
import { PlanTimeline } from '@/components/business/PlanTimeline';
import { AssumptionsSection } from '@/components/business/AssumptionsSection';

const SECTIONS = [
  { id: 'sec-timeline', label: 'Plan timeline' },
  { id: 'sec-crews', label: 'Crews and people' },
  { id: 'sec-fleet', label: 'Fleet and equipment' },
  { id: 'sec-pricing', label: 'Pricing and services' },
  { id: 'sec-scheduling', label: 'Scheduling' },
  { id: 'sec-marketing', label: 'Marketing' },
  { id: 'sec-assumptions', label: 'Assumptions' },
];

function SectionHeading({ id, title, children }: { id: string; title: string; children?: string }) {
  return (
    <div id={id} className="scroll-mt-44 pt-2">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      {children && <p className="mt-0.5 text-[13px] text-muted">{children}</p>}
    </div>
  );
}

export function BusinessPage() {
  const resetEverything = useStore((s) => s.resetEverything);
  const [confirm, setConfirm] = useState(false);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Notice>
        Every change you make here becomes a chip in the scenario bar and is simulated as a <span className="font-medium text-ink">draft</span> next to the
        baseline. Remove a chip to undo it. Edits to facts, such as a wage or an assumption, change the baseline too.
      </Notice>

      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            className="rounded-full border border-line-strong bg-surface px-3 py-1 text-[12.5px] font-medium text-muted hover:text-ink"
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div id="sec-timeline" className="scroll-mt-44">
        <PlanTimeline />
      </div>

      <SectionHeading id="sec-crews" title="Crews and people">
        Hire, remove people, add a standard crew or remove a crew.
      </SectionHeading>
      <CrewsSection />

      <SectionHeading id="sec-fleet" title="Fleet and equipment">
        What the crews drive and carry, and what you could add.
      </SectionHeading>
      <FleetSection />

      <SectionHeading id="sec-pricing" title="Pricing and services">
        Change prices or decline work you do not want.
      </SectionHeading>
      <PricingSection />

      <SectionHeading id="sec-scheduling" title="Scheduling" />
      <SchedulingSection />

      <SectionHeading id="sec-marketing" title="Marketing" />
      <MarketingSection />

      <div id="sec-assumptions" className="scroll-mt-44">
        <Disclosure
          title="Assumptions"
          subtitle="Every adjustable parameter of the model, with where its value comes from. Collapsed by default."
        >
          <AssumptionsSection />
        </Disclosure>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {confirm ? (
          <>
            <span className="text-[13px] text-ink">Discard all adopted changes, draft changes and edited assumptions, and return to the sample company?</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                resetEverything();
                setConfirm(false);
              }}
            >
              Reset everything
            </Button>
            <Button size="sm" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            Reset to the sample company
          </Button>
        )}
      </div>
    </div>
  );
}
