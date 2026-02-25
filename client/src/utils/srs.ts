// ---------------------------------------------------------------------------
// utils/srs.ts -- Anki-style SRS helpers (client-side)
// ---------------------------------------------------------------------------

import type { SavedWord, SrsAnswer } from '../api';

// Constants matching server/routes/dictionary.js
const LEARNING_STEPS = [60, 600];        // 1 min, 10 min
const GRADUATING_INTERVAL = 86400;       // 1 day
const EASY_GRADUATING_INTERVAL = 345600; // 4 days
const RELEARNING_STEP = 600;             // 10 min
const MIN_EASE = 1.3;
const LAPSE_INTERVAL_FACTOR = 0.1;
const MIN_REVIEW_INTERVAL = 86400;       // 1 day

/** True if the card is in learning or relearning phase. */
export function isLearning(card: SavedWord): boolean {
  return card.learning_step !== null || card.srs_interval === 0;
}

/**
 * Compute the number of seconds until next review for a given answer.
 * Mirrors the backend algorithm exactly.
 */
export function getNextDueSeconds(card: SavedWord, answer: SrsAnswer): number {
  const inLearning = isLearning(card);
  const isRelearning = card.learning_step !== null && card.srs_interval > 0;

  if (inLearning) {
    const step = card.learning_step ?? 0;

    switch (answer) {
      case 'again':
        return LEARNING_STEPS[0]; // 1 min
      case 'hard':
        return step === 0 ? 360 : LEARNING_STEPS[1]; // 6 min or 10 min
      case 'good':
        if (step >= LEARNING_STEPS.length - 1) {
          return isRelearning ? card.srs_interval : GRADUATING_INTERVAL;
        }
        return LEARNING_STEPS[step + 1];
      case 'easy':
        return EASY_GRADUATING_INTERVAL;
    }
  }

  // Review phase
  const oldInterval = card.srs_interval;
  const ease = card.ease_factor;

  switch (answer) {
    case 'again':
      return RELEARNING_STEP; // 10 min (enters relearning)
    case 'hard':
      return Math.max(Math.round(oldInterval * 1.2), MIN_REVIEW_INTERVAL);
    case 'good':
      return Math.max(Math.round(oldInterval * ease), MIN_REVIEW_INTERVAL);
    case 'easy':
      return Math.max(Math.round(oldInterval * ease * 1.3), MIN_REVIEW_INTERVAL);
  }
}

/** Format seconds into a human-readable duration string. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr`;
  if (seconds < 2592000) {
    const days = Math.round(seconds / 86400);
    return `${days} d`;
  }
  const months = Math.round(seconds / 2592000);
  return `${months} mo`;
}

/** Button time label combining next-due computation and formatting. */
export function getButtonTimeLabel(card: SavedWord, answer: SrsAnswer): string {
  return formatDuration(getNextDueSeconds(card, answer));
}

export interface DueStatus {
  label: string;
  urgency: 'new' | 'learning' | 'due' | 'upcoming';
}

/** Compute due-status info for Dictionary badges. */
export function getDueStatus(card: SavedWord): DueStatus {
  // New card: never reviewed
  if (card.srs_interval === 0 && card.learning_step === null && !card.last_reviewed_at) {
    return { label: 'New', urgency: 'new' };
  }

  // Learning / relearning
  if (card.learning_step !== null) {
    return { label: 'Learning', urgency: 'learning' };
  }

  // Has a due date
  if (card.due_at) {
    const now = Date.now();
    const due = new Date(card.due_at).getTime();

    if (due <= now) {
      return { label: 'Due now', urgency: 'due' };
    }

    const diffSeconds = Math.round((due - now) / 1000);
    return { label: `Due in ${formatDuration(diffSeconds)}`, urgency: 'upcoming' };
  }

  // Fallback: new card with no due_at
  return { label: 'New', urgency: 'new' };
}
