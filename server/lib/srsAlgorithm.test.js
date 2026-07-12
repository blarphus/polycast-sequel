import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextReview } from './srsAlgorithm.js';
import { MAX_PROMPT_STAGE, SRS_GOLDEN_FIXTURES } from './generated/srsContract.js';

const reviewCard = {
  srs_interval: 30 * 86400,
  ease_factor: 2.5,
  learning_step: null,
};

test('a failed review enters the 1-minute relearning step', () => {
  const failed = computeNextReview(reviewCard, 'again');
  assert.equal(failed.learning_step, 0);
  assert.equal(failed.due_seconds, 60);
  assert.equal(failed.srs_interval, 86400);
});

test('failing again while relearning returns to the 1-minute step', () => {
  const failedAgain = computeNextReview({ ...reviewCard, learning_step: 0 }, 'again');
  assert.equal(failedAgain.learning_step, 0);
  assert.equal(failedAgain.due_seconds, 60);
});

test('one good answer advances a relearning card to the 10-minute step', () => {
  const advanced = computeNextReview({ ...reviewCard, srs_interval: 86400, learning_step: 0 }, 'good');
  assert.equal(advanced.learning_step, 1);
  assert.equal(advanced.due_seconds, 600);
});

test('good on the final relearning step graduates the card', () => {
  const graduated = computeNextReview({ ...reviewCard, srs_interval: 86400, learning_step: 1 }, 'good');
  assert.equal(graduated.learning_step, null);
  assert.equal(graduated.due_seconds, 86400);
});

test('good on a graduated review grows the interval by the ease factor', () => {
  const reviewed = computeNextReview(reviewCard, 'good');
  assert.equal(reviewed.learning_step, null);
  // 30 days * 2.5 ease = 75 days
  assert.equal(reviewed.srs_interval, 75 * 86400);
  assert.equal(reviewed.due_seconds, 75 * 86400);
});

test('canonical SRS golden fixtures match the server algorithm', () => {
  for (const fixture of SRS_GOLDEN_FIXTURES) {
    const actual = computeNextReview(fixture.card, fixture.answer);
    const currentStage = Math.min(Math.max(fixture.card.prompt_stage, 0), MAX_PROMPT_STAGE);
    const promptStage = fixture.answer === 'again'
      ? Math.max(currentStage - 1, 0)
      : Math.min(currentStage + 1, MAX_PROMPT_STAGE);

    assert.deepEqual(
      { ...actual, prompt_stage: promptStage },
      fixture.expected,
      fixture.name,
    );
  }
});
