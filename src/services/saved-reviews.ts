import { migratePersisted, type PersistedState } from './persistence';

export const SAVED_REVIEWS_KEY = 'business-ops-simulator:client-reviews';
const REVIEW_LIBRARY_VERSION = 1;

export interface SavedReview {
  id: string;
  name: string;
  notes: string;
  savedAt: string;
  snapshot: PersistedState;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReview(value: unknown): SavedReview {
  if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' ||
      !value.name.trim() || typeof value.notes !== 'string' || typeof value.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.savedAt))) {
    throw new Error('A saved review could not be read.');
  }
  const snapshot = migratePersisted(value.snapshot);
  if (!snapshot) throw new Error(`The review “${value.name}” could not be read.`);
  return { id: value.id, name: value.name, notes: value.notes, savedAt: value.savedAt, snapshot };
}

export function listSavedReviews(): SavedReview[] {
  const raw = window.localStorage.getItem(SAVED_REVIEWS_KEY);
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== REVIEW_LIBRARY_VERSION || !Array.isArray(value.reviews)) {
    throw new Error('The saved review library could not be read.');
  }
  return value.reviews.map(parseReview).sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export function saveReview({ name, notes, snapshot }: Pick<SavedReview, 'name' | 'notes' | 'snapshot'>,
  previous?: Pick<SavedReview, 'id' | 'savedAt'>,
): SavedReview {
  const title = name.trim();
  if (!title || title.length > 120) throw new Error('Enter a review name of 1 to 120 characters.');
  if (notes.length > 4000) throw new Error('Keep review notes within 4,000 characters.');
  const reviews = listSavedReviews();
  if (previous && !reviews.some((review) => review.id === previous.id && review.savedAt === previous.savedAt)) {
    throw new Error('This review was updated in another tab. Reopen the latest saved copy before making changes.');
  }
  if (reviews.some((review) => review.id !== previous?.id && review.name.toLowerCase() === title.toLowerCase())) {
    throw new Error('A review already has that name. Give this review a different name.');
  }
  const saved: SavedReview = {
    id: previous?.id ?? crypto.randomUUID(),
    name: title,
    notes,
    savedAt: new Date().toISOString(),
    snapshot,
  };
  try {
    window.localStorage.setItem(SAVED_REVIEWS_KEY, JSON.stringify({
      version: REVIEW_LIBRARY_VERSION,
      reviews: [saved, ...reviews.filter((review) => review.id !== saved.id)],
    }));
  } catch {
    throw new Error('This browser could not save the review. Check that local storage is available and has room.');
  }
  return saved;
}
