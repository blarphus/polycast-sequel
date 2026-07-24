import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStudentWordStage,
  MASTERED_INTERVAL_SECONDS,
  serializeStudentWord,
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

test('teacher student-word payload exposes scheduling and dictionary detail fields', () => {
  const payload = serializeStudentWord({
    id: 'word-1',
    word: 'hacer',
    translation: 'to make',
    definition: 'to do or make',
    part_of_speech: 'verb',
    image_url: 'https://example.com/hacer.png',
    sentence_context: 'Ella hace pan.',
    surface_form: 'hace',
    forms: '["hacer","hace"]',
    example_sentence: 'Hago la cena.',
    frequency: 10,
    frequency_count: 1234,
    lemma_frequency_rank: 12,
    srs_interval: 600,
    due_at: '2026-07-24T12:00:00Z',
    last_reviewed_at: '2026-07-23T12:00:00Z',
    created_at: '2026-07-20T12:00:00Z',
    correct_count: 4,
    incorrect_count: 1,
    learning_step: null,
  });

  assert.equal(payload.definition, 'to do or make');
  assert.equal(payload.surface_form, 'hace');
  assert.equal(payload.forms, '["hacer","hace"]');
  assert.equal(payload.due_at, '2026-07-24T12:00:00Z');
  assert.equal(payload.frequency, 10);
  assert.equal(payload.correct_count, 4);
  assert.equal(payload.srs_stage, 'review');
});
