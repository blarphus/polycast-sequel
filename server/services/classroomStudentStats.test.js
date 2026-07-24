import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStudentWordStage,
  MASTERED_INTERVAL_SECONDS,
} from './classroomService.js';

test('student mastery uses a 21-day interval measured in seconds', () => {
  const reviewed = { learning_step: null, last_reviewed_at: '2026-07-24T12:00:00Z' };

  assert.equal(classifyStudentWordStage({ ...reviewed, srs_interval: 600 }), 'review');
  assert.equal(
    classifyStudentWordStage({ ...reviewed, srs_interval: MASTERED_INTERVAL_SECONDS - 1 }),
    'review',
  );
  assert.equal(
    classifyStudentWordStage({ ...reviewed, srs_interval: MASTERED_INTERVAL_SECONDS }),
    'mastered',
  );
});

test('student word stage keeps new and learning cards separate from mastery', () => {
  assert.equal(classifyStudentWordStage({
    srs_interval: 0, learning_step: null, last_reviewed_at: null,
  }), 'new');
  assert.equal(classifyStudentWordStage({
    srs_interval: MASTERED_INTERVAL_SECONDS, learning_step: 1, last_reviewed_at: '2026-07-24T12:00:00Z',
  }), 'learning');
});
