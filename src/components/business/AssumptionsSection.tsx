import { useMemo } from 'react';
import type { ParamMeta } from '@/simulation';
import { selectCompanyProvenance, selectUneditedCompany, useStore } from '@/services/store';
import { getPath } from '@/services/derive';
import { formatParam } from '@/services/format';
import { Notice, NumberField, ProvenanceBadge } from '../ui';

/** Parameters that have a dedicated decision control elsewhere on this page. */
const DECISION_PATHS = new Set(['pricing.globalMultiplier', 'market.marketingMonthlySpend']);
const isDecision = (path: string) => DECISION_PATHS.has(path) || path.startsWith('policies.');

const GROUPS: { prefix: string; title: string }[] = [
  { prefix: 'market', title: 'Demand, marketing and customers' },
  { prefix: 'workforce', title: 'Workforce' },
  { prefix: 'reliability', title: 'Breakdowns and repairs' },
  { prefix: 'weather', title: 'Weather' },
  { prefix: 'costs', title: 'Operating costs' },
  { prefix: 'finance', title: 'Finance and credit' },
];

/** The industry pack's descriptions refer to demo defaults. The badge labels the actual value. */
function describeInput(description: string): string {
  return description
    .replace(/^Illustrative assumption for ([a-z])/, (_, letter: string) => letter.toUpperCase())
    .replace(' (illustrative assumption)', '')
    .replace(' of the demonstration company', '')
    .replace(' the demonstration company ', ' the company ');
}

function Row({ meta }: { meta: ParamMeta }) {
  const value = useStore((s) => getPath(s.company, meta.path));
  const original = useStore((s) => getPath(selectUneditedCompany(s), meta.path));
  const provenance = useStore((s) => selectCompanyProvenance(s, meta.path, meta.provenance));
  const edited = useStore((s) => s.editedPaths.has(meta.path));
  const setPatch = useStore((s) => s.setPatch);
  const clearPatch = useStore((s) => s.clearPatch);
  if (typeof value !== 'number') return null;
  return (
    <div className="grid gap-x-6 gap-y-1.5 border-b border-line/70 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_14rem]" data-param={meta.path}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink">
            {meta.label}
          </span>
          <ProvenanceBadge provenance={provenance} />
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{describeInput(meta.description)}</p>
      </div>
      <div className="flex flex-col items-stretch gap-1 md:items-end">
        <div className="flex items-center gap-2">
          <NumberField
            ariaLabel={meta.label}
            value={value}
            meta={meta}
            onCommit={(v) => setPatch(meta.path, v)}
            className="w-36"
          />
          {edited && (
            <button
              type="button"
              onClick={() => clearPatch(meta.path)}
              className="text-[12px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
              aria-label={`Restore the original value for ${meta.label}`}
            >
              reset
            </button>
          )}
        </div>
        <div className="num text-[11.5px] text-faint">
          Range {formatParam(meta.min, meta)} to {formatParam(meta.max, meta)}
          {edited && typeof original === 'number' && <> · original {formatParam(original, meta)}</>}
        </div>
      </div>
    </div>
  );
}

export function AssumptionsSection() {
  const industry = useStore((s) => s.industry);
  const editedPaths = useStore((s) => s.editedPaths);
  const assumedPaths = useStore((s) => s.companySource === 'user' ? s.userCompany?.assumedPaths : undefined);
  const metas = useMemo(() => Object.values(industry.paramMeta).filter((m) => !isDecision(m.path)), [industry]);
  const editedCount = [...editedPaths].filter((p) => !p.startsWith('employees.')).length;
  const remainingPaths = assumedPaths?.filter((path) => !editedPaths.has(path)) ?? [];

  return (
    <div className="space-y-4">
      <Notice tone="warn">
        <span className="font-medium">Default values are illustrative.</span> Each badge shows whether a value is your data, an illustrative
        industry assumption, or synthetic demo data. Edits here describe the business as it is and apply to both the baseline and the draft.
      </Notice>
      {remainingPaths.length > 0 && (
        <details className="rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-muted">
          <summary className="cursor-pointer font-medium">Fields using illustrative industry assumptions</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {remainingPaths.map((path) => <li key={path} className="wrap-anywhere"><code>{path}</code></li>)}
          </ul>
        </details>
      )}
      {GROUPS.map((g) => {
        const items = metas.filter((m) => m.path.startsWith(g.prefix + '.'));
        if (items.length === 0) return null;
        return (
          <section key={g.prefix} aria-label={g.title}>
            <h3 className="mb-1 text-[13px] font-semibold text-ink">{g.title}</h3>
            <div className="rounded-lg border border-line bg-surface px-4">
              {items.map((m) => (
                <Row key={m.path} meta={m} />
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-[12.5px] text-muted">
        Scheduling policies, marketing spend and the price level are decisions, so they live in their own sections above and appear as
        changes in the scenario bar.
        {editedCount > 0 && ` You have edited ${editedCount} ${editedCount === 1 ? 'assumption' : 'assumptions'}.`}
      </p>
    </div>
  );
}
