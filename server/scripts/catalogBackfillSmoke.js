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
     VALUES ($1, 'not-a-real-hash', 'es', 'en') RETURNING id`,
    [username],
  );
  const { rows: sourceRows } = await pool.query(
    `INSERT INTO wiktionary (lang, key, word, pos, senses, forms, translations)
     VALUES
       ('es', 'el', 'el', 'article', $1::jsonb, ARRAY['el'], '[]'::jsonb),
       ('es', 'correr', 'correr', 'verb', $2::jsonb, ARRAY['correr', 'corriendo', 'corrió'], '[]'::jsonb),
       ('es', 'correr', 'correr', 'verb', $3::jsonb, ARRAY['correr'], '[]'::jsonb),
       ('es', '¿ ?', '¿ ?', 'symbol', $4::jsonb, ARRAY['¿ ?'], '[]'::jsonb)
     RETURNING id`,
    [
      JSON.stringify([{ glosses: ['definite article'] }]),
      JSON.stringify([{ glosses: ['move quickly'] }]),
      JSON.stringify([{ glosses: ['dash quickly'] }]),
      JSON.stringify([{ glosses: ['opening and closing question marks'] }]),
    ],
  );
  await pool.query(
    `INSERT INTO saved_words (
       user_id, word, lemma, forms, translation, definition,
       target_language, part_of_speech, queue_position
     ) VALUES
       ($1, 'el', 'el', '["el"]', 'the', 'definite article', 'es', 'article', 4),
       ($1, 'corriendo', 'correr', '["correr","corriendo"]', 'run', 'move quickly', 'es', 'verb', 9),
       ($1, 'florpando', 'florpar', '["florpar","florpando"]', 'invented',
        'perform an imaginary action', 'es', 'verb', 12)`,
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
            sw.sense_rank, sw.catalog_lemma_key, sw.catalog_wiktionary_id,
            sw.catalog_sense_index, sw.catalog_gloss_index,
            sw.catalog_provisional_sense_id, v.version
       FROM saved_words sw
       JOIN frequency_catalog_versions v ON v.id = sw.rank_version_id
      WHERE sw.user_id = $1
      ORDER BY sw.queue_position`,
    [user.id],
  );
  assert.deepEqual(rows.map((row) => row.word), ['el', 'correr', 'florpar']);
  assert.deepEqual(rows.map((row) => row.queue_position), [4, 9, 12]);
  assert.ok(rows.every((row) => row.catalog_lemma_key && row.lemma_frequency_rank && row.sense_rank));
  assert.ok(rows.every((row) => row.version === catalogVersion));
  assert.ok(rows[0].catalog_wiktionary_id);
  assert.ok(rows[1].catalog_wiktionary_id);
  assert.equal(rows[2].catalog_wiktionary_id, null);
  assert.ok(rows[2].catalog_provisional_sense_id);

  const { rows: [compactCounts] } = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COUNT(DISTINCT (wiktionary_id, sense_index, gloss_index))::int AS distinct_count
       FROM compact_sense_rankings csr
       JOIN frequency_catalog_versions v ON v.id = csr.catalog_version_id
      WHERE v.version = $1 AND csr.wiktionary_id = ANY($2::int[])`,
    [catalogVersion, sourceRows.map((row) => row.id)],
  );
  assert.equal(compactCounts.count, 4);
  assert.equal(compactCounts.distinct_count, 4);

  const { rows: [progress] } = await pool.query(
    `SELECT status, current_language, current_phase
       FROM frequency_catalog_build_runs WHERE version = $1`,
    [catalogVersion],
  );
  assert.equal(progress.status, 'succeeded');
  assert.equal(progress.current_language, 'es');
  assert.equal(progress.current_phase, 'activation');

  console.log(JSON.stringify({
    event: 'compact_spanish_catalog_backfill_smoke_passed',
    catalogVersion,
    existingWordsBackfilled: rows.length,
    queuePositions: rows.map((row) => row.queue_position),
    provisionalSenses: rows.filter((row) => row.catalog_provisional_sense_id).length,
  }));
} finally {
  await pool.end();
}
