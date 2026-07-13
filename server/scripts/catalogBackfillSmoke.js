import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import pool from '../db.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for catalog backfill smoke testing');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const username = `cat-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
const catalogVersion = `catalog-smoke-${suffix}`;

try {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (username, password_hash, target_language, native_language)
     VALUES ($1, 'not-a-real-hash', 'en', 'es') RETURNING id`,
    [username],
  );
  await pool.query(
    `INSERT INTO wiktionary (lang, key, word, pos, senses, forms, translations)
     VALUES
       ('en', 'the', 'the', 'article', $1::jsonb, ARRAY['the'], '[]'::jsonb),
       ('en', 'run', 'run', 'verb', $2::jsonb, ARRAY['run', 'runs', 'running', 'ran'], '[]'::jsonb)`,
    [
      JSON.stringify([{ id: `en-the-${suffix}`, glosses: ['definite article'] }]),
      JSON.stringify([{ id: `en-run-${suffix}`, glosses: ['move quickly'] }]),
    ],
  );
  await pool.query(
    `INSERT INTO saved_words (
       user_id, word, lemma, forms, translation, definition,
       target_language, part_of_speech, queue_position
     ) VALUES
       ($1, 'the', 'the', '["the"]', 'el', 'definite article', 'en', 'article', 4),
       ($1, 'running', 'run', '["run","running"]', 'correr', 'move quickly', 'en', 'verb', 9),
       ($1, 'florped', 'florp', '["florp","florped"]', 'inventado',
        'perform an imaginary action', 'en', 'verb', 12)`,
    [user.id],
  );

  execFileSync(process.execPath, [
    'scripts/buildFrequencyCatalog.js',
    '--version', catalogVersion,
    '--activate',
    '--max-entries-per-source', '500',
  ], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    stdio: 'pipe',
  });

  const { rows } = await pool.query(
    `SELECT sw.word, sw.lemma, sw.queue_position, sw.lemma_frequency_rank,
            sw.sense_rank, sw.lemma_id, sw.sense_id, v.version,
            ds.provisional
       FROM saved_words sw
       JOIN frequency_catalog_versions v ON v.id = sw.rank_version_id
       JOIN dictionary_senses ds ON ds.id = sw.sense_id
      WHERE sw.user_id = $1
      ORDER BY sw.queue_position`,
    [user.id],
  );
  assert.deepEqual(rows.map((row) => row.word), ['the', 'run', 'florp']);
  assert.deepEqual(rows.map((row) => row.queue_position), [4, 9, 12]);
  assert.ok(rows.every((row) => row.lemma_id && row.sense_id && row.lemma_frequency_rank && row.sense_rank));
  assert.ok(rows.every((row) => row.version === catalogVersion));
  assert.equal(rows[0].provisional, false);
  assert.equal(rows[1].provisional, false);
  assert.equal(rows[2].provisional, true);

  const { rows: [duplicates] } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM dictionary_senses ds
       JOIN dictionary_lemmas dl ON dl.id = ds.lemma_id
      WHERE dl.language = 'en' AND dl.lemma_key IN ('the', 'run') AND ds.provisional`,
  );
  assert.equal(duplicates.count, 0);
  console.log(JSON.stringify({
    event: 'catalog_backfill_smoke_passed',
    catalogVersion,
    existingWordsBackfilled: rows.length,
    queuePositions: rows.map((row) => row.queue_position),
    provisionalSenses: rows.filter((row) => row.provisional).length,
  }));
} finally {
  await pool.end();
}
