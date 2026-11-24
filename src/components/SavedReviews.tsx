import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { listSavedReviews, saveReview, type SavedReview } from '@/services/saved-reviews';
import { currentReviewSnapshot, selectHasUserWork, useStore, validateReviewSnapshot } from '@/services/store';
import { Button, Notice } from './ui';

const fieldClass = 'mt-1 block w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink';
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ReviewDialog({ close, onOpened }: { close: () => void; onOpened?: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [library, setLibrary] = useState(() => {
    try {
      return { reviews: listSavedReviews(), problem: '' };
    } catch (error) {
      return { reviews: [], problem: errorMessage(error, 'Saved reviews could not be read.') };
    }
  });
  const activeId = useStore((state) => state.activeReviewId);
  const companyName = useStore((state) => state.company.name);
  const active = library.reviews.find((review) => review.id === activeId);
  const [name, setName] = useState(active?.name ?? companyName);
  const [notes, setNotes] = useState(active?.notes ?? '');
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState(library.problem);
  const [opening, setOpening] = useState<SavedReview | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function save(asNew = false) {
    setOpening(null);
    setProblem('');
    setMessage('');
    try {
      const state = useStore.getState();
      validateReviewSnapshot(state);
      const saved = saveReview({ name, notes, snapshot: currentReviewSnapshot(state) }, asNew ? undefined : active);
      state.setActiveReviewId(saved.id);
      setLibrary({ reviews: listSavedReviews(), problem: '' });
      setName(saved.name);
      setMessage(`Saved ${saved.name}.`);
    } catch (error) {
      setProblem(errorMessage(error, 'The review could not be saved.'));
    }
  }

  function open(id: string, confirmed = false) {
    setProblem('');
    setMessage('');
    try {
      const latest = listSavedReviews();
      const target = latest.find((review) => review.id === id);
      if (!target) throw new Error('This review is no longer available.');
      const current = useStore.getState();
      const { selectedDay: _day, view: _view, ...snapshot } = currentReviewSnapshot(current);
      const currentSaved = latest.find((review) => review.id === current.activeReviewId);
      const isChanged = currentSaved
        ? !samePlan(snapshot, currentSaved.snapshot) || name !== currentSaved.name || notes !== currentSaved.notes
        : selectHasUserWork(current) || current.companySource === 'user' || name !== companyName || notes !== '';
      if (isChanged && !confirmed) {
        setOpening(target);
        return;
      }
      current.activateReview(target.id, target.snapshot);
      close();
      onOpened?.();
    } catch (error) {
      setProblem(errorMessage(error, 'The review could not be opened.'));
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-auto rounded-xl border border-line bg-surface text-ink shadow-xl backdrop:bg-black/35"
      onCancel={(event) => { event.preventDefault(); close(); }}
    >
      <div className="space-y-5 p-4 sm:p-6">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">Client reviews</h2>
            <p className="mt-1 text-sm text-muted">Keep the company, comparison, and notes together in this browser.</p>
          </div>
          <Button size="sm" onClick={close}>Close</Button>
        </header>
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); save(); }} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Save current review</h3>
            <p className="break-words text-[13px] text-muted">{companyName}</p>
          </div>
          <label className="block text-[13px] font-medium">
            Review name
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
          </label>
          <label className="block text-[13px] font-medium">
            Notes <span className="font-normal text-muted">(optional)</span>
            <textarea rows={3} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" type="submit">{active ? 'Save changes' : 'Save review'}</Button>
            {active && <Button onClick={() => save(true)}>Save as new review</Button>}
          </div>
        </form>
        {problem && <Notice tone="error">{problem}</Notice>}
        {message && <p role="status" className="text-sm text-good">{message}</p>}
        {opening && (
          <Notice tone="warn">
            <p>Open “{opening.name}”? Unsaved changes to this review will be replaced.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setOpening(null)}>Keep working</Button>
              <Button size="sm" variant="danger" onClick={() => open(opening.id, true)}>Open and replace</Button>
            </div>
          </Notice>
        )}
        <section className="space-y-2 border-t border-line pt-4" aria-label="Saved reviews">
          <h3 className="text-sm font-semibold">Saved reviews</h3>
          {library.reviews.length === 0 ? <p className="text-sm text-muted">Your saved reviews will appear here.</p> : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {library.reviews.map((review) => (
                <li key={review.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 break-words">
                    <p className="text-sm font-medium">{review.name}</p>
                    <p className="text-[12px] text-muted">{dateLabel.format(new Date(review.savedAt))}{review.id === activeId && ' · Open'}</p>
                  </div>
                  <Button size="sm" ariaLabel={`Open ${review.name}`} onClick={() => open(review.id)}>Open</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </dialog>
  );
}

function samePlan(snapshot: Omit<SavedReview['snapshot'], 'view' | 'selectedDay'>, saved: SavedReview['snapshot']): boolean {
  const { selectedDay: _day, view: _view, activeReviewId: _id, ...savedPlan } = saved;
  return JSON.stringify(snapshot) === JSON.stringify(savedPlan);
}

export function SavedReviews({ onOpened }: { onOpened?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Client reviews</Button>
      {open && <ReviewDialog close={() => setOpen(false)} onOpened={onOpened} />}
    </>
  );
}
