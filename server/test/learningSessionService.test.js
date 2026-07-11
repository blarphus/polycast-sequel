import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { __test } from '../services/learningSessionService.js';

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

test('choice and pair answers are deterministic after generation', () => {
  const choice = __test.makeExercise('meaning_choice', words[0], words, 'es');
  assert.equal(__test.responseIsCorrect(choice.answer, { optionId: choice.answer.optionId }), true);
  assert.equal(__test.responseIsCorrect(choice.answer, { optionId: crypto.randomUUID() }), false);
  const pairs = __test.makeExercise('pair_match', words[0], words, 'es');
  assert.equal(__test.responseIsCorrect(pairs.answer, { pairs: [...pairs.answer.pairs].reverse() }), true);
});
