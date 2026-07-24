import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBestSensePrompt,
  parseBestSenseReply,
} from '../services/wordSemanticsService.js';

test('normal sense selection asks Gemini for no generated definition', () => {
  const prompt = buildBestSensePrompt(
    'hace',
    'Cuando un conductor hace sonar el claxon.',
    'Spanish',
    'English',
    [
      { pos: 'verb', gloss: 'to make or create', source: 'wikt' },
      { pos: 'verb', gloss: 'to do', source: 'wikt' },
    ],
  );

  assert.match(prompt, /PICK \| TRANSLATION/);
  assert.doesNotMatch(prompt, /PICK \| TRANSLATION \| DEFINITION/);
  assert.doesNotMatch(prompt, /learner-facing definition/i);
});

test('sense selection parser returns only the selected sense and translation', () => {
  assert.deepEqual(
    parseBestSenseReply('0 | to make', {
      word: 'hace',
      targetLang: 'Spanish',
      nativeLang: 'English',
      senseCount: 2,
    }),
    { index: 0, translation: 'to make' },
  );
  assert.deepEqual(
    parseBestSenseReply('hacer | to make', {
      word: 'hace',
      targetLang: 'Spanish',
      nativeLang: 'English',
      senseCount: 2,
    }),
    { base: 'hacer', translation: 'to make' },
  );
});

test('sense selection rejects the retired generated-definition response shape', () => {
  assert.throws(
    () => parseBestSenseReply('0 | to make | To produce something.', {
      word: 'hace',
      targetLang: 'Spanish',
      nativeLang: 'English',
      senseCount: 2,
    }),
    /exactly PICK and TRANSLATION/,
  );
});
