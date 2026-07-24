import assert from 'node:assert/strict';
import test from 'node:test';
import { createDictionaryWordService } from './dictionaryWordService.js';

function scriptedDb(results) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      const result = results.shift();
      assert.ok(result, `Unexpected query: ${text}`);
      return result;
    },
  };
}

test('dictionary word save creates, schedules, and awards through one service pipeline', async () => {
  const db = scriptedDb([
    { rows: [] },
    { rows: [{ id: 'word-1', word: 'hola' }] },
    { rows: [{ id: 'word-1', word: 'hola', next_review_date: '2026-07-12' }] },
  ]);
  const mutationCalls = [];
  const service = createDictionaryWordService({
    db,
    scheduleMutation: async (input) => {
      mutationCalls.push(input);
      return { result: await input.mutate(db), schedule: { diagnostic: null } };
    },
    awardSaveXp: async () => ({ xpEarned: 5 }),
  });

  const result = await service.save('user-1', { word: 'hola', surface_form: 'Hola' }, {
    timeZone: 'America/Chicago', correlationId: 'correlation-1',
  });

  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    id: 'word-1', word: 'hola', next_review_date: '2026-07-12',
    created: true, _created: true, xpEarned: 5,
  });
  assert.equal(result.diagnostic, null);
  assert.equal(mutationCalls[0].correlationId, 'correlation-1');
  assert.equal(mutationCalls[0].timeZone, 'America/Chicago');
  assert.equal(db.calls[1].values[12], '["hola"]');
});

test('dictionary word save reuses an existing definition without awarding duplicate XP', async () => {
  const db = scriptedDb([
    { rows: [{ id: 'word-1', word: 'hola', forms: null }] },
  ]);
  let awards = 0;
  let scheduleMutations = 0;
  const service = createDictionaryWordService({
    db,
    scheduleMutation: async () => {
      scheduleMutations += 1;
      return { result: null, schedule: { diagnostic: null } };
    },
    awardSaveXp: async () => { awards += 1; return {}; },
  });

  const result = await service.save('user-1', { word: 'hola' }, {
    timeZone: 'UTC', correlationId: 'correlation-2',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.created, false);
  assert.equal(awards, 0);
  assert.equal(scheduleMutations, 0);
  assert.equal(db.calls.length, 1);
});

test('dictionary word update rejects an empty patch before querying', async () => {
  const db = scriptedDb([]);
  const service = createDictionaryWordService({ db });
  await assert.rejects(
    () => service.update('user-1', 'word-1', {}),
    (error) => error.code === 'request_validation_failed' && error.status === 400,
  );
  assert.equal(db.calls.length, 0);
});

test('dictionary headword edits invalidate the cached pronunciation', async () => {
  const db = scriptedDb([{ rows: [{ id: 'word-1', word: 'sacar' }] }]);
  const service = createDictionaryWordService({ db });

  const updated = await service.update('user-1', 'word-1', { word: 'sacar' });

  assert.equal(updated.word, 'sacar');
  assert.match(db.calls[0].text, /word = \$3/);
  assert.match(db.calls[0].text, /tts_audio = NULL/);
});

test('dictionary word deletion reports a typed not-found error', async () => {
  const db = scriptedDb([{ rowCount: 0 }]);
  const service = createDictionaryWordService({
    db,
    scheduleMutation: async (input) => ({
      result: await input.mutate(db),
      schedule: { diagnostic: null },
    }),
  });
  await assert.rejects(
    () => service.remove('user-1', 'word-1'),
    (error) => error.code === 'dictionary_word_not_found' && error.status === 404,
  );
});
