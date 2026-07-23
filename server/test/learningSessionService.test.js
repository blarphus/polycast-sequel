import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { __test } from '../services/learningSessionService.js';
import {
  GEMINI_FLASH_LITE_MODEL,
  GEMINI_FLASH_LITE_THINKING_LEVEL,
} from '../lib/gemini.js';

const words = [
  { id: '1', word: 'abatir', lemma: 'abatir', forms: '["abatido"]', translation: 'to bring down', sentence_context: 'El sospechoso fue abatido.', image_url: '/image/abatir', target_language: 'es' },
  { id: '2', word: 'entorno', lemma: 'entorno', forms: null, translation: 'environment', sentence_context: 'El entorno cambió.', target_language: 'es' },
  { id: '3', word: 'medio', lemma: 'medio', forms: '["medios"]', translation: 'means', sentence_context: 'Es el mejor medio.', target_language: 'es' },
  { id: '4', word: 'acepción', lemma: 'acepción', forms: '["acepciones"]', translation: 'meaning', sentence_context: 'Tiene una acepción precisa.', target_language: 'es' },
  { id: '5', word: 'servicio', lemma: 'servicio', forms: '["servicios"]', translation: 'service', sentence_context: 'El servicio funciona.', target_language: 'es' },
];

test('practice exercises cover vocabulary interactions without grammar generation', () => {
  const kinds = ['meaning_choice', 'word_choice', 'pair_match', 'context_choice', 'context_type', 'listen_meaning', 'listen_type'];
  for (const kind of kinds) {
    const exercise = __test.makeExercise(kind, words[0], words, 'es', 'La tormenta puede abatir árboles viejos.');
    assert.ok(exercise, `${kind} should be generated`);
    assert.equal(exercise.kind, kind);
    assert.equal(exercise.savedWordId, words[0].id);
  }
});

test('context blanks accept the generated sentence and never reuse the saved source sentence', () => {
  assert.equal(__test.blankSentence('La tormenta puede abatir árboles viejos.', words[0]), 'La tormenta puede _____ árboles viejos.');
  assert.equal(__test.ensureFreshPracticeSentence('El sospechoso fue abatido.', words[0]), null);
  const exercise = __test.makeExercise('context_type', words[0], words, 'es', 'La tormenta puede abatir árboles viejos.');
  assert.equal(__test.responseIsCorrect(exercise.answer, { text: 'abatido' }), true);
  assert.equal(__test.responseIsCorrect(exercise.answer, { text: 'otro' }), false);
  assert.equal(exercise.prompt.meaning, 'to bring down');
  assert.equal(exercise.prompt.imageUrl, '/image/abatir');
});

test('practice fallbacks retain the backend failure reason for the learner', () => {
  assert.equal(
    __test.fallbackReason(new Error('Gemini request failed (503): temporarily unavailable\ntry again')),
    'Gemini request failed (503): temporarily unavailable try again',
  );
});

test('practice sentence generation uses Flash Lite and retries an empty token-capped response', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        candidates: [{ content: {}, finishReason: 'MAX_TOKENS' }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'La tormenta logró abatir tres árboles secos.' }] } }],
    }), { status: 200 });
  };

  try {
    assert.equal(
      await __test.generatePracticeSentence(words[0], 'es', 'en'),
      'La tormenta logró abatir tres árboles secos.',
    );
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.match(request.url, new RegExp(`/models/${GEMINI_FLASH_LITE_MODEL}:generateContent$`));
      assert.equal(request.body.generationConfig.maxOutputTokens, 256);
      assert.deepEqual(request.body.generationConfig.thinkingConfig, {
        thinkingLevel: GEMINI_FLASH_LITE_THINKING_LEVEL,
      });
      const prompt = request.body.contents[0].parts[0].text;
      assert.match(prompt, /familiar to a 14-year-old/);
      assert.match(prompt, /A2-B1/);
      assert.match(prompt, /accent marks/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('practice sentence generation retries a rejected reused sentence once', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const text = calls === 1
      ? words[0].sentence_context
      : 'La tormenta logró abatir tres árboles secos.';
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }), { status: 200 });
  };

  try {
    assert.equal(
      await __test.generatePracticeSentence(words[0], 'es', 'en'),
      'La tormenta logró abatir tres árboles secos.',
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('fresh practice sentences are plain target-language text, not JSON payloads', () => {
  assert.equal(
    __test.ensureFreshPracticeSentence('La sopa está hirviendo dentro de la olla grande.', { ...words[0], word: 'olla', sentence_context: null }),
    'La sopa está hirviendo dentro de la olla grande.',
  );
});

test('choice and pair answers are deterministic after generation', () => {
  const choice = __test.makeExercise('meaning_choice', words[0], words, 'es');
  assert.equal(__test.responseIsCorrect(choice.answer, { optionId: choice.answer.optionId }), true);
  assert.equal(__test.responseIsCorrect(choice.answer, { optionId: crypto.randomUUID() }), false);
  const pairs = __test.makeExercise('pair_match', words[0], words, 'es');
  assert.equal(__test.responseIsCorrect(pairs.answer, { pairs: [...pairs.answer.pairs].reverse() }), true);
});
