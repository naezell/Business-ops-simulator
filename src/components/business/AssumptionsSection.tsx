import { useMemo } from 'react';
import type { CompanyConfig, ParamMeta } from '@/simulation';
import type { IndustryDefinition } from '@/business/types';
import { useStore } from '@/services/store';
import { getPath } from '@/services/derive';
import { formatParam } from '@/services/format';
import { Notice, NumberField, ProvenanceBadge } from '../ui';

/** Parameters that have a dedicated decision control elsewhere on this page. */
const DECISION_PATHS = new Set(['pricing.globalMultiplier', 'market.marketingMonthlySpend']);
const isDecision = (path: string) => DECISION_PATHS.has(path) || path.startsWith('policies.');

const GROUPS: { prefix: string; title: string }[] = [
  { prefix: 'market', title: 'Demand, marketing and customers' },
  { prefix: 'workforce', title: 'Workforce' },
  { prefix: 'weather', title: 'Weather' },
  { prefix: 'costs', title: 'Operating costs' },
  { prefix: 'finance', title: 'Finance and credit' },
];

function Row({ meta }: { meta: ParamMeta }) {
  const company = useStore((s) => s.company);
  const industry = useStore((s) => s.industry);
  const editedPaths = useStore((s) => s.editedPaths);
  const setPatch = useStore((s) => s.setPatch);
  const clearPatch = useStore((s) => s.clearPatch);
  const edited = editedPaths.has(meta.path);
  const value = getPath(company, meta.path);
  const original = getPath(pristine(industry), meta.path);
  if (typeof value !== 'number') return null;
  return (
    <div className="grid gap-x-6 gap-y-1.5 border-b border-line/70 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_14rem]" data-param={meta.path}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[13px] font-medium text-ink" htmlFor={`param-${meta.path}`}>
            {meta.label}
          </label>
          <ProvenanceBadge provenance={meta.provenance} edited={edited} />
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{meta.description}</p>
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
              aria-label={`Reset ${meta.label} to its default`}
            >
              reset
            </button>
          )}
        </div>
        <div className="num text-[11.5px] text-faint">
          Range {formatParam(meta.min, meta)} to {formatParam(meta.max, meta)}
          {edited && typeof original === 'number' && <> · default {formatParam(original, meta)}</>}
        </div>
      </div>
    </div>
  );
}

const pristineCache = new Map<string, CompanyConfig>();
function pristine(industry: IndustryDefinition): CompanyConfig {
  let c = pristineCache.get(industry.id);
  if (!c) pristineCache.set(industry.id, (c = industry.createSampleCompany()));
  return c;
}

export function AssumptionsSection() {
  const industry = useStore((s) => s.industry);
  const editedPaths = useStore((s) => s.editedPaths);
  const metas = useMemo(() => Object.values(industry.paramMeta).filter((m) => !isDecision(m.path)), [industry]);
  const editedCount = [...editedPaths].filter((p) => !p.startsWith('employees.')).length;

  return (
    <div className="space-y-4">
      <Notice tone="warn">
        <span className="font-medium">Default values are illustrative.</span> They describe a synthetic demonstration company or are assumptions
        for the sake of the example. They are not verified industry benchmarks. Replace them with your own figures and the badge changes to
        Your data. Edits here describe the business as it is, so they apply to the baseline and the draft alike.
      </Notice>
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
