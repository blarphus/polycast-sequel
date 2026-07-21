import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupFrequencyCatalog } from '../lib/frequencyCatalog.js';

test('English frequency lookup uses the committed embedded ranking without a database catalog', async () => {
  const db = { query: async () => { throw new Error('embedded English lookup must not query the database'); } };
  const { entry, diagnostics } = await lookupFrequencyCatalog({ db, language: 'en-US', lemma: 'morning' });

  assert.equal(entry.canonical_lemma, 'morning');
  assert.equal(entry.lemma_rank, 470);
  assert.equal(entry.frequency_band, 10);
  assert.ok(entry.lemma_occurrences_per_billion > 200_000);
  assert.equal(entry.frequency_sources[0].id, 'wordfreq-snapshot');
  assert.deepEqual(diagnostics, []);
});

test('Spanish visibly falls back to its committed snapshot when the materialized catalog is absent', async () => {
  let queries = 0;
  const db = {
    async query() {
      queries += 1;
      return { rows: [] };
    },
  };
  const { entry, diagnostics } = await lookupFrequencyCatalog({ db, language: 'es', lemma: 'mañana' });

  assert.equal(entry.canonical_lemma, 'mañana');
  assert.ok(entry.lemma_rank > 0);
  assert.ok(queries >= 2, 'catalog miss and visible diagnostic persistence should query the database');
  assert.equal(diagnostics[0].code, 'frequency_catalog_embedded_fallback');
});
