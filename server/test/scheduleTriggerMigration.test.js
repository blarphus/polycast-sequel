import assert from 'node:assert/strict';
import test from 'node:test';
import { up } from '../migrations/042-only-dirty-schedule-on-real-changes.js';

test('schedule trigger ignores no-op updates but still tracks real scheduling changes', async () => {
  const statements = [];
  await up({ query: async (text) => { statements.push(text); } });
  const sql = statements.join('\n');

  assert.match(sql, /AFTER INSERT OR DELETE ON saved_words/);
  assert.match(sql, /AFTER UPDATE OF[\s\S]*srs_interval/);
  assert.match(sql, /OLD\.srs_interval IS DISTINCT FROM NEW\.srs_interval/);
  assert.match(sql, /OLD\.lemma_frequency_rank IS DISTINCT FROM NEW\.lemma_frequency_rank/);
});
