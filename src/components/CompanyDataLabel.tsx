import { selectIsSynthetic, useStore } from '@/services/store';
import { cx } from './ui';

/** Labels the source of input data on each simulator view. */
export function CompanyDataLabel({ className, withNote = false }: { className?: string; withNote?: boolean }) {
  const synthetic = useStore(selectIsSynthetic);
  const demoName = useStore((s) => s.industry.demoScenarios?.find((d) => d.id === s.demoScenarioId)?.name ?? null);
  const hasAssumptions = useStore((s) => (s.userCompany?.assumedPaths.length ?? 0) > 0);
  return (
    <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', className)} data-synthetic-label={synthetic || undefined}>
      <span
        className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium', synthetic ? 'bg-[#eceae3] text-muted' : 'bg-accent-soft text-accent')}
        title={synthetic ? 'The company inputs come from a built-in demonstration.' : 'Company inputs come from your import and any edits you make.'}
      >
        {synthetic ? 'Synthetic demonstration data' : 'Imported company'}
      </span>
      {demoName && <span className="text-[12px] text-muted">{demoName}</span>}
      {!synthetic && hasAssumptions && <span className="text-[12px] text-muted">Includes illustrative industry assumptions.</span>}
      {withNote && <span className="text-[12px] text-muted">Results are calculated by the simulation.</span>}
    </div>
  );
}
