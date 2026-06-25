import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSharedEntryKey,
  hashSharedDefinition,
  normalizeSharedDefinition,
  normalizeSharedWordKey,
  sharedEntryToEnrichment,
} from './sharedDictionaryEntries.js';

test('shared dictionary keys are definition-specific, not just word-specific', () => {
  const bankMoney = buildSharedEntryKey({
    word: 'banco',
    target_language: 'es',
    part_of_speech: 'noun',
    definition: 'financial institution',
  });
  const bankBench = buildSharedEntryKey({
    word: 'banco',
    target_language: 'es',
    part_of_speech: 'noun',
    definition: 'bench for sitting',
  });

  assert.equal(bankMoney.word_key, bankBench.word_key);
  assert.notEqual(bankMoney.definition_hash, bankBench.definition_hash);
});

test('shared dictionary key normalization is stable for case, accents, and whitespace', () => {
  assert.equal(normalizeSharedWordKey('  Más  '), 'mas');
  assert.equal(normalizeSharedDefinition(' A   Large   Cup '), 'a large cup');
  assert.equal(hashSharedDefinition(' A   Large   Cup '), hashSharedDefinition('a large cup'));
});

test('shared dictionary keys keep part of speech separate', () => {
  const noun = buildSharedEntryKey({
    word: 'light',
    target_language: 'en',
    part_of_speech: 'noun',
    definition: 'not heavy',
  });
  const adjective = buildSharedEntryKey({
    word: 'light',
    target_language: 'en',
    part_of_speech: 'adjective',
    definition: 'not heavy',
  });

  assert.notEqual(noun.part_of_speech_key, adjective.part_of_speech_key);
  assert.equal(noun.definition_hash, adjective.definition_hash);
});

test('shared entry payloads return cache-hit enrichment data', () => {
  const payload = sharedEntryToEnrichment({
    id: 'entry-1',
    word: 'aplastar',
    translation: 'crush',
    definition: 'to flatten by pressure',
    part_of_speech: 'verb',
    frequency: 7,
    frequency_count: 1234,
    example_sentence: 'Voy a aplastar la caja.',
    sentence_translation: 'I am going to crush the box.',
    image_url: '/api/dictionary/image/image-1',
    image_term: 'crush box',
    lemma: 'aplastar',
    forms: '["aplasta"]',
  });

  assert.equal(payload.shared_entry_id, 'entry-1');
  assert.equal(payload.compendium_hit, true);
  assert.equal(payload.image_url, '/api/dictionary/image/image-1');
  assert.deepEqual(payload.fallback_notices, []);
});
