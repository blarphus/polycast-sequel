import assert from 'node:assert/strict';
import test from 'node:test';
import { createDictionaryStudyService } from './dictionaryStudyService.js';

test('study queue reorder is one transaction and releases its connection', async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(text) {
      statements.push(text);
      return text.startsWith('UPDATE') ? { rowCount: 1 } : {};
    },
    release() { released = true; },
  };
  const service = createDictionaryStudyService({ db: { connect: async () => client } });
  await service.reorder('user-1', [
    { id: 'word-1', queue_position: 0 },
    { id: 'word-2', queue_position: 1 },
  ]);
  assert.deepEqual(statements.map((sql) => sql.split(' ')[0]), ['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT']);
  assert.equal(released, true);
});

test('study queue reorder rolls back and exposes a missing word', async () => {
  const statements = [];
  const client = {
    async query(text) {
      statements.push(text);
      return text.startsWith('UPDATE') ? { rowCount: 0 } : {};
    },
    release() {},
  };
  const service = createDictionaryStudyService({ db: { connect: async () => client } });
  await assert.rejects(
    () => service.reorder('user-1', [{ id: 'missing', queue_position: 0 }]),
    (error) => error.status === 404 && error.code === 'dictionary_word_not_found',
  );
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('study review keeps idempotency, SRS, and session accounting in one pipeline', async () => {
  const calls = [];
  const service = createDictionaryStudyService({
    db: { name: 'db' },
    reviewCard: async (_db, wordId, userId, answer, timeZone) => {
      calls.push({ operation: 'review', wordId, userId, answer, timeZone });
      return { id: wordId, srs_stage: 2 };
    },
    recordReview: async (_db, userId, sessionId, correct) => {
      calls.push({ operation: 'record', userId, sessionId, correct });
    },
    refreshSchedule: async (options) => {
      calls.push({ operation: 'schedule', options });
      return { diagnostic: null };
    },
    idempotentMutation: async (_db, options, mutation) => {
      calls.push({ operation: 'idempotency', options });
      return { ...(await mutation()), replayed: false };
    },
  });
  const result = await service.review('user-1', 'word-1', {
    answer: 'good', timeZone: 'UTC', learningSessionId: 'session-1', idempotencyKey: 'key-1',
  });
  assert.equal(result.status, 200);
  assert.equal(calls[0].options.key, 'key-1');
  assert.equal(calls[1].operation, 'review');
  assert.deepEqual(calls[2], { operation: 'record', userId: 'user-1', sessionId: 'session-1', correct: true });
  assert.equal(calls[3].operation, 'schedule');
  assert.equal(calls[3].options.source, 'mutation');
});
