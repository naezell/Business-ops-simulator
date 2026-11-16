import { selectIsSynthetic, useStore } from '@/services/store';
import { cx } from './ui';

/**
 * "Synthetic demonstration data" label. One component, shown on every view that displays results,
 * while the company is built-in demo data rather than data the user provided.
 */
export function SyntheticLabel({ className, withNote = false }: { className?: string; withNote?: boolean }) {
  const synthetic = useStore(selectIsSynthetic);
  const demoName = useStore((s) => s.industry.demoScenarios?.find((d) => d.id === s.demoScenarioId)?.name ?? null);
  if (!synthetic) return null;
  return (
    <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', className)} data-synthetic-label>
      <span
        className="inline-flex items-center rounded-full border border-transparent bg-[#eceae3] px-2 py-0.5 text-[12px] font-medium text-muted"
        title="The company in this app is a built-in demonstration. Its numbers are made up and illustrative, not benchmarks."
      >
        Synthetic demonstration data
      </span>
      {demoName && <span className="text-[12px] text-muted">{demoName}</span>}
      {withNote && <span className="text-[12px] text-muted">Results describe this simulated company under the assumptions shown, not a forecast.</span>}
    </div>
  );
}
