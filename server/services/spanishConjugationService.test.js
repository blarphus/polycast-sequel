import assert from 'node:assert/strict';
import test from 'node:test';
import { conjugateSpanishVerb } from './spanishConjugationService.js';

test('builds labeled tables for spelling-changing Spanish verbs', () => {
  const result = conjugateSpanishVerb('sacar');
  const table = result.variants[0].conjugation;

  assert.deepEqual(table.Impersonal, {
    Infinitivo: 'sacar',
    Gerundio: 'sacando',
    Participio: 'sacado',
  });
  assert.deepEqual(table.Indicativo.Presente, ['saco', 'sacas', 'saca', 'sacamos', 'sacáis', 'sacan']);
  assert.deepEqual(table.Indicativo.PreteritoIndefinido, ['saqué', 'sacaste', 'sacó', 'sacamos', 'sacasteis', 'sacaron']);
});

test('keeps reflexive pronouns attached to the correct conjugations', () => {
  const result = conjugateSpanishVerb('fijarse');
  assert.deepEqual(
    result.variants[0].conjugation.Indicativo.Presente,
    ['me fijo', 'te fijas', 'se fija', 'nos fijamos', 'os fijáis', 'se fijan'],
  );
});
