// ---------------------------------------------------------------------------
// utils/srs.ts -- Anki-style SRS helpers (client-side)
// ---------------------------------------------------------------------------

import type { SavedWord, SrsAnswer } from '../api/dictionary';

// Constants matching server/routes/dictionary.js
const LEARNING_STEPS = [60, 600];        // 1 min, 10 min
const GRADUATING_INTERVAL = 86400;       // 1 day
// const EASY_GRADUATING_INTERVAL = 345600; // 4 days -- unused since the rating
//   collapsed to a binary correct/incorrect (good/again only). Flagged for
//   deletion in a future audit.
const MIN_EASE = 1.3;
const MIN_REVIEW_INTERVAL = 86400;       // 1 day

function roundedDayInterval(seconds: number): number {
  return Math.max(Math.round(seconds / MIN_REVIEW_INTERVAL), 1) * MIN_REVIEW_INTERVAL;
}

/** True if the card is in learning or relearning phase. */
function isRelearning(card: SavedWord): boolean {
  return card.learning_step !== null && card.srs_interval > 0;
}

function isNewLearning(card: SavedWord): boolean {
  return !isRelearning(card) && (card.learning_step !== null || card.srs_interval === 0);
}

export interface NextReviewState {
  srsInterval: number;
  easeFactor: number;
  learningStep: number | null;
  dueSeconds: number;
}

/** Mirror the server scheduler so optimistic/requeued cards never retain stale queue state. */
export function computeNextReviewState(card: SavedWord, answer: SrsAnswer): NextReviewState {
  let srsInterval = card.srs_interval;
  let easeFactor = card.ease_factor;
  let learningStep = card.learning_step;
  let dueSeconds = MIN_REVIEW_INTERVAL;

  if (isRelearning(card)) {
    const step = card.learning_step ?? 0;
    if (answer === 'again') {
      learningStep = 0;
      dueSeconds = LEARNING_STEPS[0];
    } else if (step >= LEARNING_STEPS.length - 1) {
      // good on the last relearning step — graduate back out at the stored interval.
      learningStep = null;
      dueSeconds = card.srs_interval;
    } else {
      // good — advance to the next relearning step.
      learningStep = step + 1;
      dueSeconds = LEARNING_STEPS[step + 1];
    }
  } else if (isNewLearning(card)) {
    const step = card.learning_step ?? 0;
    if (answer === 'again') {
      learningStep = 0;
      dueSeconds = LEARNING_STEPS[0];
    } else if (step >= LEARNING_STEPS.length - 1) {
      // good on the last step — graduate.
      learningStep = null;
      srsInterval = GRADUATING_INTERVAL;
      dueSeconds = GRADUATING_INTERVAL;
    } else {
      // good — advance to the next learning step.
      learningStep = step + 1;
      dueSeconds = LEARNING_STEPS[step + 1];
    }
  } else if (answer === 'again') {
    easeFactor = Math.max(easeFactor - 0.20, MIN_EASE);
    srsInterval = MIN_REVIEW_INTERVAL;
    learningStep = 0;
    dueSeconds = LEARNING_STEPS[0];
  } else {
    // good — grow the interval by the ease factor.
    srsInterval = roundedDayInterval(card.srs_interval * easeFactor);
    dueSeconds = srsInterval;
  }

  return { srsInterval, easeFactor, learningStep, dueSeconds };
}

/**
 * Compute the number of seconds until next review for a given answer.
 * Mirrors the backend algorithm exactly.
 */
export function getNextDueSeconds(card: SavedWord, answer: SrsAnswer): number {
  return computeNextReviewState(card, answer).dueSeconds;
}

export function nextPromptStage(card: SavedWord, answer: SrsAnswer): number {
  const stage = Math.min(card.prompt_stage ?? 0, 3);
  if (answer === 'again') return Math.max(stage - 1, 0);
  return Math.min(stage + 1, 3);
}

export function applyAnswerLocally(card: SavedWord, answer: SrsAnswer, now = new Date()): SavedWord {
  const next = computeNextReviewState(card, answer);
  const dueAt = new Date(now);
  if (next.dueSeconds < MIN_REVIEW_INTERVAL) {
    dueAt.setTime(now.getTime() + next.dueSeconds * 1000);
  } else {
    dueAt.setHours(0, 0, 0, 0);
    dueAt.setDate(dueAt.getDate() + Math.max(Math.round(next.dueSeconds / MIN_REVIEW_INTERVAL), 1));
  }
  return {
    ...card,
    srs_interval: next.srsInterval,
    ease_factor: next.easeFactor,
    learning_step: next.learningStep,
    due_at: dueAt.toISOString(),
    last_reviewed_at: now.toISOString(),
    correct_count: card.correct_count + (answer === 'again' ? 0 : 1),
    incorrect_count: card.incorrect_count + (answer === 'again' ? 1 : 0),
    prompt_stage: nextPromptStage(card, answer),
    introduced_date: card.introduced_date || (isNewLearning(card) ? localDateKey(now) : null),
    relearning_date: answer === 'again' ? localDateKey(now) : null,
  };
}

export type StudyQueueBucket = 'new' | 'learning' | 'review';

export function isNewCard(card: SavedWord): boolean {
  return card.srs_interval === 0 && card.learning_step === null && !card.last_reviewed_at;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Classify a card by its direct status in the current local study day. */
export function getStudyQueueBucket(card: SavedWord, now = new Date()): StudyQueueBucket {
  const today = localDateKey(now);
  if (card.relearning_date === today) return 'learning';
  if (isNewCard(card) || card.introduced_date === today) return 'new';
  return 'review';
}

/** Count distinct cards still present in each queue, never steps or completed cards. */
export function getStudyQueueCounts(cards: SavedWord[], now = new Date()) {
  const counts = { new: 0, learning: 0, review: 0 };
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const bucket = getStudyQueueBucket(card, now);
    if (bucket === 'new') counts.new += 1;
    else if (bucket === 'learning') counts.learning += 1;
    else counts.review += 1;
  }
  return counts;
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
  const isNew = card.srs_interval === 0 && card.learning_step === null && !card.last_reviewed_at;
  const statusDate = card.due_at || (isNew ? card.projected_due_at : null);

  // Has a due date — cards become due at midnight of their due date
  if (statusDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(statusDate);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate <= today) {
      return { label: isNew ? 'New today' : 'Due now', urgency: isNew ? 'new' : 'due' };
    }

    const diffDays = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
    const label = diffDays === 1
      ? (isNew ? 'New tomorrow' : 'Due tomorrow')
      : `${isNew ? 'New' : 'Due'} in ${diffDays} d`;
    return { label, urgency: isNew ? 'new' : 'upcoming' };
  }

  // New card without due_at should be rare after the scheduler pass, but keep
  // it visible instead of pretending it is due.
  if (card.srs_interval === 0 && card.learning_step === null && !card.last_reviewed_at) {
    return { label: 'Unscheduled', urgency: 'upcoming' };
  }

  // Learning / relearning without due_at
  if (card.learning_step !== null) {
    return { label: 'Due now', urgency: 'due' };
  }

  // Fallback: new card with no due_at
  return { label: 'New', urgency: 'new' };
}
