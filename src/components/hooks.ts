import { useMemo } from 'react';
import { useStore } from '@/services/store';
import { nameLookup, projectCompany, type LabelContext } from '@/services/derive';

/** Roster/pricing projections of baseline (adopted only) and draft (adopted + pending), plus label context. */
export function useProjections() {
  const company = useStore((s) => s.company);
  const baselineActions = useStore((s) => s.baselineActions);
  const draftActions = useStore((s) => s.draftActions);
  const draftResult = useStore((s) => s.draftResult);
  return useMemo(() => {
    const base = projectCompany(company, baselineActions, []);
    const full = projectCompany(company, baselineActions, draftActions);
    const ctx: LabelContext = { base, full, jobTypes: company.jobTypes };
    const nameOf = nameLookup(full, company.jobTypes, draftResult);
    return { base, full, ctx, nameOf };
  }, [company, baselineActions, draftActions, draftResult]);
}
