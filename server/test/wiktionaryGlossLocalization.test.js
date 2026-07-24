import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeWiktionaryGloss } from '../services/wordSemanticsService.js';

test('localizes an English Wiktionary gloss into the profile native language', async () => {
  const calls = [];
  const translated = await localizeWiktionaryGloss(
    'A male parent.',
    'es',
    async (...args) => {
      calls.push(args);
      return 'Un progenitor masculino.';
    },
  );

  assert.equal(translated, 'Un progenitor masculino.');
  assert.deepEqual(calls, [['A male parent.', 'en', 'es']]);
});

test('keeps English profile definitions on the zero-overhead path', async () => {
  let called = false;
  const definition = await localizeWiktionaryGloss(
    'A male parent.',
    'en-US',
    async () => {
      called = true;
      return 'unexpected';
    },
  );

  assert.equal(definition, 'A male parent.');
  assert.equal(called, false);
});
