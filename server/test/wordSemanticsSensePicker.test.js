import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBestSensePrompt,
  buildExplainWordPrompt,
  explainWordInContext,
  isCompleteContextExplanation,
  markSelectedWord,
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

test('context explanation marks a selected word with accented Unicode boundaries', () => {
  const sentence = 'Fiambres describen sus últimas horas de vida.';

  assert.equal(
    markSelectedWord(sentence, 'últimas'),
    'Fiambres describen sus ~últimas~ horas de vida.',
  );

  const prompt = buildExplainWordPrompt({
    word: 'últimas',
    sentence,
    nativeLang: 'English',
    targetLang: 'Spanish',
  });
  assert.match(prompt, /The selected token is "últimas"/);
  assert.match(prompt, /sus ~últimas~ horas/);
  assert.match(prompt, /explain only what "últimas" specifically means/);
});

test('context explanation adds the current selection when another token is already marked', () => {
  assert.equal(
    markSelectedWord('~Fiambres~ describen sus últimas horas.', 'últimas'),
    '~Fiambres~ describen sus ~últimas~ horas.',
  );
});

test('context explanation accepts only complete sentences', () => {
  assert.equal(isCompleteContextExplanation('"Morir" means "to die."'), true);
  assert.equal(isCompleteContextExplanation('It means to die!'), true);
  assert.equal(isCompleteContextExplanation('"Morir" literally means "to die." Depending'), false);
  assert.equal(isCompleteContextExplanation(''), false);
});

test('context explanation retries a token-capped response with a larger limit and visible notice', async () => {
  const calls = [];
  const result = await explainWordInContext({
    word: 'morir',
    sentence: 'Siempre he tenido miedo a morir.',
    nativeLang: 'English',
    targetLang: 'Spanish',
    correlationId: 'explain-correlation-1',
  }, {
    generate: async (prompt, config, model) => {
      calls.push({ prompt, config, model });
      return calls.length === 1
        ? '"Morir" literally means "to die." Depending'
        : 'Here, "morir" means to die or cease living.';
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].config.maxOutputTokens, 900);
  assert.equal(calls[0].config.thinkingConfig.thinkingLevel, 'MINIMAL');
  assert.equal(calls[0].model, 'gemini-3.5-flash');
  assert.equal(calls[1].config.maxOutputTokens, 1400);
  assert.match(calls[1].prompt, /previous response ended before completing its sentence/);
  assert.equal(result.explanation, 'Here, "morir" means to die or cease living.');
  assert.equal(result.fallback_notices[0].code, 'context_explanation_completion_retry');
  assert.equal(result.fallback_notices[0].correlationId, 'explain-correlation-1');
});

test('context explanation refuses to display a second incomplete response', async () => {
  await assert.rejects(
    () => explainWordInContext({
      word: 'morir',
      sentence: 'Siempre he tenido miedo a morir.',
      nativeLang: 'English',
      targetLang: 'Spanish',
    }, {
      generate: async () => 'This response still ends without punctuation',
    }),
    /incomplete context explanation twice/,
  );
});
