import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/post-oak-company.json';
import { importCompany } from '../../src/services/company-files';
import { loadPersisted, STORAGE_KEY } from '../../src/services/persistence';
import { listSavedReviews, saveReview, SAVED_REVIEWS_KEY } from '../../src/services/saved-reviews';
import { currentReviewSnapshot, selectCompanyProvenance, useStore } from '../../src/services/store';

describe('saved client reviews', () => {
  let data: Map<string, string>;
  let setItem: ReturnType<typeof vi.fn<(key: string, value: string) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    data = new Map();
    setItem = vi.fn((key, value) => { data.set(key, value); });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem,
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

  it('restores the company, comparison, notes and inputs after switching to another company', () => {
    const imported = importCompany(JSON.stringify(fixture));
    if (!imported.ok) throw new Error('The company fixture should import.');
    const { company } = imported;
    const store = useStore.getState();
    store.setUserCompany(company, ['costs.fuelPricePerGallon']);
    store.setHorizonMonths(3);
    store.setDraftAction({ type: 'set-marketing-spend', monthlySpend: 250 });
    store.adoptDraft();
    store.setDraftAction({ type: 'set-marketing-spend', monthlySpend: 450 }, 12);
    store.setPatch('finance.startingCash', 45000);
    store.addShock({ type: 'weather', state: 'rainout', fromDay: 1, toDay: 3 });
    store.setSelectedDay(5);
    store.setView('financials');
    vi.runAllTimers();

    const snapshot = currentReviewSnapshot(useStore.getState());
    const saved = saveReview({ name: 'Post Oak spring options', notes: 'Ask about availability in March.', snapshot });
    store.setActiveReviewId(saved.id);
    store.setUserCompany({ ...company, name: 'Second client' }, []);
    saveReview({ name: 'Second client', notes: '', snapshot: currentReviewSnapshot(useStore.getState()) });
    const reviews = listSavedReviews();
    expect(reviews).toHaveLength(2);
    const prior = reviews.find((review) => review.id === saved.id)!;
    expect(prior.notes).toBe('Ask about availability in March.');
    store.activateReview(prior.id, prior.snapshot);

    const reopened = useStore.getState();
    expect(reopened.activeReviewId).toBe(saved.id);
    expect(reopened.company.name).toBe(company.name);
    expect(reopened.company.finance.startingCash).toBe(45000);
    expect(reopened.editedPaths.has('finance.startingCash')).toBe(true);
    expect(selectCompanyProvenance(reopened, 'costs.fuelPricePerGallon', 'synthetic-demo')).toBe('industry-assumption');
    expect(currentReviewSnapshot(reopened)).toEqual(snapshot);
    expect(loadPersisted()).toEqual({ ...snapshot, activeReviewId: saved.id });
  });

  it('keeps existing client work when local storage refuses to open another review', () => {
    const snapshot = currentReviewSnapshot(useStore.getState());
    const saved = saveReview({ name: 'First option', notes: '', snapshot });
    useStore.getState().setView('optimize');
    vi.runAllTimers();
    const current = useStore.getState();
    const previous = data.get(STORAGE_KEY);
    setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(() => current.activateReview(saved.id, saved.snapshot)).toThrow('could not save the working session');
    expect(useStore.getState()).toBe(current);
    expect(data.get(STORAGE_KEY)).toBe(previous);
    setItem.mockImplementation((key, value) => { data.set(key, value); });
  });

  it('keeps an unrelated company out of a sample review when saving and reopening it', () => {
    const imported = importCompany(JSON.stringify(fixture));
    if (!imported.ok) throw new Error('The company fixture should import.');
    const store = useStore.getState();
    store.setUserCompany(imported.company, []);
    store.setDemoScenario(null);
    const snapshot = currentReviewSnapshot(useStore.getState());
    expect(snapshot).toMatchObject({ companySource: 'sample', userCompany: null });
    const saved = saveReview({ name: 'Sample walkthrough', notes: '', snapshot });

    store.setUserCompany({ ...imported.company, name: 'Another client' }, []);
    store.activateReview(saved.id, saved.snapshot);
    expect(currentReviewSnapshot(useStore.getState())).toEqual(snapshot);
    expect(useStore.getState().userCompany?.company.name).toBe('Another client');
  });

  it('keeps the original review on a failed or conflicting save', () => {
    const snapshot = currentReviewSnapshot(useStore.getState());
    const original = saveReview({ name: 'Post Oak review', notes: 'Original', snapshot });
    const bytes = data.get(SAVED_REVIEWS_KEY);
    expect(() => saveReview({ name: 'post oak review', notes: 'Duplicate', snapshot })).toThrow('already has that name');
    expect(() => saveReview({ name: original.name, notes: 'Stale', snapshot }, { ...original, savedAt: '2000-01-01' })).toThrow('updated in another tab');
    setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(() => saveReview({ name: original.name, notes: 'Could not save', snapshot }, original)).toThrow('could not save the review');
    expect(data.get(SAVED_REVIEWS_KEY)).toBe(bytes);
    setItem.mockImplementation((key, value) => { data.set(key, value); });
  });

  it('applies confirmed review inputs to both plans and replaces only the what-if changes', () => {
    const store = useStore.getState();
    store.setHorizonMonths(3);
    const adopted = { type: 'set-marketing-spend', monthlySpend: 250 } as const;
    store.setDraftAction(adopted);
    store.adoptDraft();
    store.setDraftAction({ type: 'set-marketing-spend', monthlySpend: 450 });
    const option = { type: 'set-policy', patch: { routing: 'zoned' } } as const;

    store.applyGuidedDecision({ 'finance.startingCash': 40_000 }, option);
    vi.runAllTimers();

    const state = useStore.getState();
    expect(state.company.finance.startingCash).toBe(40_000);
    expect(state.baselineActions).toEqual([{ day: 0, action: adopted }]);
    expect(state.draftActions).toEqual([{ day: 0, action: option }]);
    expect(state.baselineIssues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(state.draftIssues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
