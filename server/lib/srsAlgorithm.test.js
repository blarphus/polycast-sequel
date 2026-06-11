import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextReview } from './srsAlgorithm.js';

const reviewCard = {
  srs_interval: 30 * 86400,
  ease_factor: 2.5,
  learning_step: null,
};

test('a failed review enters the single 10-minute relearning step', () => {
  const failed = computeNextReview(reviewCard, 'again');
  assert.equal(failed.learning_step, 0);
  assert.equal(failed.due_seconds, 600);
  assert.equal(failed.srs_interval, 86400);
});

test('failing again while relearning stays on the 10-minute step', () => {
  const failedAgain = computeNextReview({ ...reviewCard, learning_step: 0 }, 'again');
  assert.equal(failedAgain.learning_step, 0);
  assert.equal(failedAgain.due_seconds, 600);
});

test('one good answer graduates a relearning card', () => {
  const graduated = computeNextReview({ ...reviewCard, srs_interval: 86400, learning_step: 0 }, 'good');
  assert.equal(graduated.learning_step, null);
  assert.equal(graduated.due_seconds, 86400);
});

test('easy on the single relearning step schedules two days', () => {
  const graduated = computeNextReview({ ...reviewCard, srs_interval: 86400, learning_step: 0 }, 'easy');
  assert.equal(graduated.learning_step, null);
  assert.equal(graduated.srs_interval, 172800);
  assert.equal(graduated.due_seconds, 172800);
});
