import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankSpanishFrequencyFamily,
  spanishFamilyTokens,
} from './spanishFrequencyFamilies.js';

test('pronominal families keep only forms with explicit attached clitics', () => {
  const tokens = spanishFamilyTokens({
    lemma: 'fijarse',
    partOfSpeech: 'verb',
    forms: [
      'fijarse', 'fijarme', 'fijarte', 'fijándose', 'fíjate', 'fíjense',
      'fija', 'fijo', 'fijamos',
    ],
  });

  assert.deepEqual(tokens, [
    'fijarse', 'fijarme', 'fijarte', 'fijándose', 'fíjate', 'fíjense',
  ]);
});

test('fijarse receives the same bounded family treatment as other pronominal verbs', () => {
  const ranking = rankSpanishFrequencyFamily({
    lemma: 'fijarse',
    partOfSpeech: 'verb',
    forms: [
      'fijarse', 'fijarme', 'fijarte', 'fijándose', 'fijándome',
      'fijándote', 'fíjate', 'fíjese', 'fijaos', 'fíjense', 'fijémonos',
    ],
  });

  assert.equal(ranking.frequency_band, 8);
  assert.ok(ranking.lemma_rank >= 1400 && ranking.lemma_rank <= 2200);
  assert.ok(ranking.occurrences_per_billion >= 10_000);
  assert.equal(ranking.sources.length, 2);
  assert.ok(ranking.sources.every((source) => source.aggregation === 'bounded-inflection-family'));
});

test('the ambiguity guard prevents a homograph from dominating a verb family', () => {
  const ranking = rankSpanishFrequencyFamily({
    lemma: 'comer',
    partOfSpeech: 'verb',
    forms: ['como', 'comes', 'come', 'comemos', 'coméis', 'comen', 'comí', 'comió', 'comieron'],
  });

  assert.ok(ranking.lemma_rank > 200);
  assert.ok(ranking.sources.every((source) => source.excluded_ambiguous_forms >= 1));
});

test('short-stem pronominal verbs are handled by the general clitic rule', () => {
  const ranking = rankSpanishFrequencyFamily({
    lemma: 'darse',
    partOfSpeech: 'verb',
    forms: ['darse', 'darme', 'darte', 'dándose', 'dándome', 'date', 'dese', 'daos', 'dense', 'démonos'],
  });

  assert.equal(ranking.frequency_band, 8);
  assert.ok(ranking.sources.some((source) => source.matched_forms >= 8));
});
