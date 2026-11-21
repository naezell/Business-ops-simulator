import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/post-oak-company.json';
import { exportCompany, importCompany } from '../../src/services/company-files';
import { loadPersisted, migratePersisted, STORAGE_KEY } from '../../src/services/persistence';
import { scenarioKey, selectCompanyProvenance, selectExportAssumedPaths, selectIsSynthetic, useStore } from '../../src/services/store';

const v4 = {
  version: 4,
  industryId: 'landscaping',
  demoScenarioId: 'twin-90',
  seed: 7,
  horizonMonths: 6,
  baselineActions: [{ day: 0, action: { type: 'set-marketing-spend', monthlySpend: 500 } }],
  draft: { actions: [], rules: [] },
  patch: { 'finance.startingCash': 50000 },
  shocks: [{ type: 'weather', state: 'clear', fromDay: 1, toDay: 9 }],
  selectedDay: 3,
  view: 'business',
} as const;

function reviewFile() {
  const { costs, ...company } = fixture.company;
  const { fuelPricePerGallon: _omitted, ...otherCosts } = costs;
  const result = importCompany(JSON.stringify({ version: 1, company: { ...company, costs: otherCosts } }));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

describe('company storage migration and restoration', () => {
  it('migrates v4 sample and demo states with their scenario changes intact', () => {
    expect(migratePersisted(v4)).toEqual({ ...v4, version: 5, companySource: 'demo', userCompany: null });
    const sample = { ...v4, demoScenarioId: null };
    expect(migratePersisted(sample)).toEqual({ ...sample, version: 5, companySource: 'sample', userCompany: null });
  });

  it('rejects malformed and conflicting v5 company source data', () => {
    const base = { ...v4, version: 5, demoScenarioId: null, companySource: 'user' };
    expect(migratePersisted({ ...base, userCompany: null })).toBeNull();
    expect(migratePersisted({ ...base, userCompany: { ...fixture, assumedPaths: [] } })).toBeNull();
    expect(migratePersisted({ ...base, userCompany: { company: { name: 'Malformed' }, assumedPaths: [] } })).toBeNull();
    const { company, assumedPaths } = reviewFile();
    expect(migratePersisted({ ...base, demoScenarioId: 'twin-90', userCompany: { company, assumedPaths } })).toBeNull();
  });
});

describe('importing a company into the store', () => {
  let data: Map<string, string>;
  let setItem: ReturnType<typeof vi.fn<(key: string, value: string) => void>>;
  beforeEach(() => {
    vi.useFakeTimers();
    data = new Map();
    setItem = vi.fn((key, value) => { data.set(key, value); });
    vi.stubGlobal('window', {
      localStorage: {
        setItem,
        getItem: (key: string) => data.get(key) ?? null,
        removeItem: (key: string) => data.delete(key),
      },
    });
  });
  afterEach(() => {
    useStore.getState().resetEverything();
    useStore.setState({ userCompany: null });
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('persists immediately and restores the imported company when the store starts again', async () => {
    const { company, assumedPaths } = reviewFile();
    useStore.getState().setUserCompany(company, assumedPaths);
    const stored = loadPersisted()!;
    expect(stored).toMatchObject({ version: 5, companySource: 'user', demoScenarioId: null, userCompany: { company, assumedPaths } });
    expect(migratePersisted(JSON.parse(data.get(STORAGE_KEY)!))).toEqual(stored);
    vi.resetModules();
    const reloaded = (await import('../../src/services/store')).useStore.getState();
    expect(reloaded.company).toEqual(company);
    expect(reloaded.companySource).toBe('user');
    expect(reloaded.baselineResult.days[0].balance.cash).toBeDefined();
    expect(reloaded.baselineIssues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(selectCompanyProvenance(reloaded, 'costs.fuelPricePerGallon', 'synthetic-demo')).toBe('industry-assumption');
  });

  it('isolates scenario plans and keeps the imported company available after switching', () => {
    const { company, assumedPaths } = reviewFile();
    const sample = useStore.getState();
    sample.setDraftAction({ type: 'set-marketing-spend', monthlySpend: 100 });
    sample.setUserCompany(company, assumedPaths);
    const imported = useStore.getState();
    expect(imported.draftActions).toEqual([]);
    expect(imported.company.name).toBe(fixture.company.name);
    expect(scenarioKey(imported)).not.toBe(scenarioKey(sample));
    expect(selectIsSynthetic(imported)).toBe(false);
    imported.setDemoScenario('twin-90');
    expect(selectIsSynthetic(useStore.getState())).toBe(true);
    vi.runAllTimers();
    expect(loadPersisted()).toMatchObject({ companySource: 'demo', userCompany: { company, assumedPaths } });
    useStore.getState().activateUserCompany();
    expect(useStore.getState().company).toEqual(company);
    useStore.getState().resetEverything();
    expect(useStore.getState()).toMatchObject({ companySource: 'sample', userCompany: { company, assumedPaths } });
  });

  it('preserves assumption provenance until the user edits the field', () => {
    const { company, assumedPaths } = reviewFile();
    useStore.getState().setUserCompany(company, assumedPaths);
    const active = useStore.getState();
    expect(selectCompanyProvenance(active, 'finance.startingCash', 'synthetic-demo')).toBe('user-provided');
    expect(selectCompanyProvenance(active, 'costs.fuelPricePerGallon', 'synthetic-demo')).toBe('industry-assumption');
    active.setPatch('costs.fuelPricePerGallon', 4.25);
    const edited = useStore.getState();
    expect(selectCompanyProvenance(edited, 'costs.fuelPricePerGallon', 'industry-assumption')).toBe('user-provided');
    const exported = importCompany(exportCompany(edited.company, selectExportAssumedPaths(edited)));
    expect(exported).toMatchObject({ ok: true, assumedPaths: [], company: { costs: { fuelPricePerGallon: 4.25 } } });
    edited.clearPatch('costs.fuelPricePerGallon');
    expect(selectCompanyProvenance(useStore.getState(), 'costs.fuelPricePerGallon', 'synthetic-demo')).toBe('industry-assumption');
  });

  it('keeps the active company and saved plan when local storage refuses an import', () => {
    const { company, assumedPaths } = reviewFile();
    useStore.getState().setDemoScenario('twin-90');
    vi.runAllTimers();
    const before = useStore.getState();
    const previousSave = data.get(STORAGE_KEY);
    setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(() => before.setUserCompany(company, assumedPaths)).toThrow('could not save the company');
    expect(useStore.getState()).toBe(before);
    expect(data.get(STORAGE_KEY)).toBe(previousSave);
  });
});
