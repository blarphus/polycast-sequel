import test from 'node:test';
import assert from 'node:assert/strict';
import { up } from '../migrations/049-backfill-spanish-frequency-families.js';

test('Spanish family migration rewrites saved and shared dictionary rankings', async () => {
  const updates = [];
  const client = {
    async query(text, params = []) {
      if (/FROM saved_words\s+WHERE LOWER\(SPLIT_PART/.test(text)) {
        return {
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            lemma: 'fijarse',
            surface_form: 'fijarse',
            part_of_speech: 'verb',
            forms: JSON.stringify([
              'fijarse', 'fijarme', 'fijarte', 'fijándose',
              'fíjate', 'fíjese', 'fijaos', 'fíjense',
            ]),
          }],
        };
      }
      if (/FROM shared_dictionary_entries\s+WHERE LOWER\(SPLIT_PART/.test(text)) {
        return {
          rows: [{
            id: '22222222-2222-4222-8222-222222222222',
            lemma: 'remoto',
            surface_form: 'remoto',
            part_of_speech: 'adjective',
            forms: JSON.stringify(['remoto', 'remota', 'remotos', 'remotas']),
          }],
        };
      }
      if (/UPDATE (saved_words|shared_dictionary_entries)\s+SET lemma_frequency_rank/.test(text)) {
        updates.push({ text, params });
        return { rowCount: 1, rows: [] };
      }
      if (/SELECT user_id\s+FROM user_schedule_state/.test(text)) return { rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };

  await up(client);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].params[1][0] >= 1400 && updates[0].params[1][0] <= 2200, true);
  assert.equal(updates[0].params[3][0], 8);
  assert.equal(updates[1].params[1][0] > 0, true);
  assert.match(updates[0].params[5][0], /bounded-inflection-family/);
});
