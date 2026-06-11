import test from 'node:test';
import assert from 'node:assert/strict';
import { applySrsReview, validTimeZone, MAX_PROMPT_STAGE } from './srsUpdate.js';

test('validTimeZone accepts IANA zones and rejects invalid values', () => {
  assert.equal(validTimeZone('America/Chicago'), 'America/Chicago');
  assert.equal(validTimeZone('not/a-zone'), 'UTC');
});

test('day intervals are stored at local midnight in the supplied timezone', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return {
          rows: [{
            srs_interval: 86400,
            ease_factor: 2.5,
            learning_step: null,
            prompt_stage: 0,
          }],
        };
      }
      return { rows: [{ id: 'card-1' }] };
    },
  };

  await applySrsReview(db, 'card-1', 'user-1', 'good', 'America/Chicago');

  assert.match(queries[1].sql, /date_trunc\('day', NOW\(\) AT TIME ZONE \$10\)/);
  assert.equal(queries[1].params[9], 'America/Chicago');
  assert.equal(queries[1].params[10], 3);
  assert.equal(queries[1].params[11], 'good');
});

// ---------------------------------------------------------------------------
// Stage 4+ ladder
// ---------------------------------------------------------------------------

function makeFakeDb({ existingPromptStage = 3, existingStageSentences = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        // First call: SELECT * FROM saved_words
        return {
          rows: [{
            id: 'card-1',
            user_id: 'user-1',
            prompt_stage: existingPromptStage,
            stage_sentences: existingStageSentences,
            srs_interval: 0,
            learning_step: null,
            ease_factor: 2.5,
          }],
        };
      }
      return { rows: [{ id: 'card-1', prompt_stage: 4, stage_sentences: existingStageSentences }] };
    },
  };
}

test('climbing to stage 4 fires the onAdvanceToNewStage hook', async () => {
  const db = makeFakeDb({ existingPromptStage: 3 });
  let hookCalls = 0;
  let lastNewStage = null;

  await applySrsReview(db, 'card-1', 'user-1', 'good', 'UTC', {
    onAdvanceToNewStage: ({ newStage }) => {
      hookCalls += 1;
      lastNewStage = newStage;
    },
  });

  // Give the microtask queue a tick to drain the fire-and-forget promise.
  await new Promise((r) => setImmediate(r));

  assert.equal(hookCalls, 1, 'hook should fire exactly once');
  assert.equal(lastNewStage, 4);
});

test('hook is skipped when stage_sentences already has an entry for newStage', async () => {
  const db = makeFakeDb({
    existingPromptStage: 3,
    existingStageSentences: [
      { stage: 3, example: 'a', translation: 'a' },
      { stage: 4, example: 'b', translation: 'b' },
    ],
  });
  let hookCalls = 0;

  await applySrsReview(db, 'card-1', 'user-1', 'good', 'UTC', {
    onAdvanceToNewStage: () => { hookCalls += 1; },
  });
  await new Promise((r) => setImmediate(r));

  assert.equal(hookCalls, 0, 're-promotion should not re-generate');
});

test('hook is not fired for stage 0→1→2→3 advances (no per-stage generation needed)', async () => {
  const db = makeFakeDb({ existingPromptStage: 2 });
  let hookCalls = 0;

  await applySrsReview(db, 'card-1', 'user-1', 'good', 'UTC', {
    onAdvanceToNewStage: () => { hookCalls += 1; },
  });
  await new Promise((r) => setImmediate(r));

  assert.equal(hookCalls, 0, 'stages 0-3 are unchanged and do not need new sentences');
});

test('failing (again) on a high stage does NOT fire the hook', async () => {
  const db = makeFakeDb({
    existingPromptStage: 5,
    existingStageSentences: [
      { stage: 3, example: 'a', translation: 'a' },
      { stage: 4, example: 'b', translation: 'b' },
      { stage: 5, example: 'c', translation: 'c' },
    ],
  });
  let hookCalls = 0;

  await applySrsReview(db, 'card-1', 'user-1', 'again', 'UTC', {
    onAdvanceToNewStage: () => { hookCalls += 1; },
  });
  await new Promise((r) => setImmediate(r));

  assert.equal(hookCalls, 0, 'downward stage movement should not trigger generation');
});

test('stage advance respects the soft upper cap', async () => {
  const db = makeFakeDb({
    existingPromptStage: MAX_PROMPT_STAGE,
    existingStageSentences: [
      { stage: MAX_PROMPT_STAGE, example: 'a', translation: 'a' },
    ],
  });
  let hookCalls = 0;
  let lastNewStage = null;

  await applySrsReview(db, 'card-1', 'user-1', 'good', 'UTC', {
    onAdvanceToNewStage: ({ newStage }) => {
      hookCalls += 1;
      lastNewStage = newStage;
    },
  });
  await new Promise((r) => setImmediate(r));

  // The cap means we don't move past MAX_PROMPT_STAGE — and we don't fire
  // the hook because the new stage already has an entry (and the cap is
  // already at its boundary).
  assert.equal(lastNewStage, null);
  assert.equal(hookCalls, 0);
});

test('hook errors are swallowed and do not crash the review', async () => {
  const db = makeFakeDb({ existingPromptStage: 3 });

  const result = await applySrsReview(db, 'card-1', 'user-1', 'good', 'UTC', {
    onAdvanceToNewStage: async () => {
      throw new Error('Gemini exploded');
    },
  });
  await new Promise((r) => setImmediate(r));

  assert.ok(result, 'review response should still be returned');
  assert.equal(result.id, 'card-1');
});

