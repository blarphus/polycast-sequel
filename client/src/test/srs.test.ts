import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedWord } from '../api/dictionary';
import {
  applyAnswerLocally,
  computeNextReviewState,
  getDueStatus,
  getStudyQueueBucket,
  getStudyQueueCounts,
} from '../utils/srs';

function card(overrides: Partial<SavedWord> = {}): SavedWord {
  return {
    id: 'card-1',
    word: 'supo',
    translation: 'found out',
    definition: '',
    target_language: 'es',
    sentence_context: null,
    created_at: '2026-06-01T12:00:00.000Z',
    frequency: null,
    frequency_count: null,
    example_sentence: 'Ella ~supo~ la verdad.',
    sentence_translation: 'She ~found out~ the truth.',
    part_of_speech: null,
    srs_interval: 0,
    due_at: null,
    last_reviewed_at: null,
    correct_count: 0,
    incorrect_count: 0,
    ease_factor: 2.5,
    learning_step: null,
    image_url: null,
    lemma: null,
    forms: null,
    prompt_stage: 0,
    priority: false,
    image_term: null,
    queue_position: null,
    introduced_date: null,
    relearning_date: null,
    ...overrides,
  };
}

describe('Anki-style study queues', () => {
  const today = new Date('2026-06-11T15:00:00.000Z');

  it('does not call a card relearning merely because a scheduler step survived overnight', () => {
    const overdueLearning = card({
      srs_interval: 86_400,
      learning_step: 0,
      last_reviewed_at: '2026-06-10T15:00:00.000Z',
    });

    expect(getStudyQueueBucket(overdueLearning, today)).toBe('review');
  });

  it('moves failed blue and green cards into red', () => {
    const failedNew = applyAnswerLocally(card(), 'again', today);
    const failedReview = applyAnswerLocally(card({
      id: 'card-2',
      srs_interval: 86_400,
      last_reviewed_at: '2026-06-10T15:00:00.000Z',
    }), 'again', today);

    expect(getStudyQueueBucket(failedNew, today)).toBe('learning');
    expect(getStudyQueueBucket(failedReview, today)).toBe('learning');
    expect(getStudyQueueCounts([failedNew, failedReview], today)).toEqual({
      new: 0,
      learning: 2,
      review: 0,
    });
  });

  it('advances a red relearning card to the 10-minute step after one correct answer', () => {
    const relearning = card({
      srs_interval: 86_400,
      learning_step: 0,
      last_reviewed_at: today.toISOString(),
      relearning_date: '2026-06-11',
    });
    const next = computeNextReviewState(relearning, 'good');
    const advanced = applyAnswerLocally(relearning, 'good', today);

    expect(next.learningStep).toBe(1);
    expect(next.dueSeconds).toBe(600);
    expect(getStudyQueueBucket(advanced, today)).toBe('review');
    expect(getStudyQueueCounts([advanced], today)).toEqual({ new: 0, learning: 0, review: 1 });
  });

  it('graduates a relearning card after the final 10-minute step', () => {
    const relearning = card({
      srs_interval: 86_400,
      learning_step: 1,
      last_reviewed_at: today.toISOString(),
      relearning_date: '2026-06-11',
    });
    const next = computeNextReviewState(relearning, 'good');
    const graduated = applyAnswerLocally(relearning, 'good', today);

    expect(next.learningStep).toBeNull();
    expect(next.dueSeconds).toBe(86_400);
    expect(getStudyQueueBucket(graduated, today)).toBe('review');
  });

  it('counts distinct cards once and ignores duplicate queue entries', () => {
    const firstStep = card({ learning_step: 0, last_reviewed_at: today.toISOString(), relearning_date: '2026-06-11' });
    const secondStep = card({ id: 'card-2', learning_step: 1, last_reviewed_at: today.toISOString(), relearning_date: '2026-06-11' });

    expect(getStudyQueueCounts([firstStep, secondStep, firstStep], today)).toEqual({
      new: 0,
      learning: 2,
      review: 0,
    });
  });

  it('keeps the red count unchanged when a relearning card is failed again', () => {
    const relearning = card({
      srs_interval: 86_400,
      learning_step: 0,
      last_reviewed_at: today.toISOString(),
      relearning_date: '2026-06-11',
    });
    const failedAgain = applyAnswerLocally(relearning, 'again', today);

    expect(getStudyQueueCounts([relearning], today)).toEqual({ new: 0, learning: 1, review: 0 });
    expect(getStudyQueueCounts([failedAgain], today)).toEqual({ new: 0, learning: 1, review: 0 });
  });

  it('counts ordinary new-card learning as blue, not red', () => {
    const learningNewCard = applyAnswerLocally(card(), 'good', today);

    expect(learningNewCard.learning_step).toBe(1);
    expect(getStudyQueueBucket(learningNewCard, today)).toBe('new');
    expect(getStudyQueueCounts([learningNewCard], today)).toEqual({ new: 1, learning: 0, review: 0 });
  });

  it('resets a failed one-month review to a one-day post-relearning interval', () => {
    const monthlyReview = card({
      srs_interval: 30 * 86_400,
      last_reviewed_at: '2026-05-11T15:00:00.000Z',
    });
    const failed = computeNextReviewState(monthlyReview, 'again');

    expect(failed.learningStep).toBe(0);
    expect(failed.dueSeconds).toBe(60);
    expect(failed.srsInterval).toBe(86_400);
  });

  it('schedules day intervals at local midnight instead of 24 hours later', () => {
    const lateReview = new Date(2026, 5, 11, 22, 30, 0);
    const finalLearningStep = card({
      learning_step: 1,
      last_reviewed_at: lateReview.toISOString(),
    });
    const graduated = applyAnswerLocally(finalLearningStep, 'good', lateReview);
    const due = new Date(graduated.due_at!);

    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(5);
    expect(due.getDate()).toBe(12);
    expect(due.getHours()).toBe(0);
    expect(due.getMinutes()).toBe(0);
  });

  it('keeps minute learning steps as exact elapsed times', () => {
    const now = new Date(2026, 5, 11, 22, 30, 0);
    const failed = applyAnswerLocally(card(), 'again', now);

    expect(new Date(failed.due_at!).getTime() - now.getTime()).toBe(60_000);
  });
});

describe('dictionary due status labels', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses projected queue dates for never-reviewed new cards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 12, 0, 0));

    expect(getDueStatus(card({ projected_due_at: '2026-06-11T00:00:00' }))).toEqual({
      label: 'New today',
      urgency: 'new',
    });
    expect(getDueStatus(card({ projected_due_at: '2026-06-12T00:00:00' }))).toEqual({
      label: 'New tomorrow',
      urgency: 'new',
    });
    expect(getDueStatus(card({ projected_due_at: '2026-06-14T00:00:00' }))).toEqual({
      label: 'New in 3 d',
      urgency: 'new',
    });
  });

  it('keeps unscheduled as a fallback when no projected date is available', () => {
    expect(getDueStatus(card())).toEqual({ label: 'Unscheduled', urgency: 'upcoming' });
  });
});
