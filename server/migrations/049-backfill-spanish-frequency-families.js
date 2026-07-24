import { rankSpanishFrequencyFamily } from '../lib/spanishFrequencyFamilies.js';
import { ensureScheduleCurrent } from '../lib/dictionaryScheduleQueries.js';

async function backfillTable(client, table) {
  const { rows } = await client.query(
    `SELECT id,
            COALESCE(NULLIF(BTRIM(lemma), ''), BTRIM(word)) AS lemma,
            word AS surface_form,
            forms,
            part_of_speech
       FROM ${table}
      WHERE LOWER(SPLIT_PART(COALESCE(target_language, ''), '-', 1)) = 'es'
      ORDER BY id`,
  );
  const ranked = [];
  for (const row of rows) {
    const ranking = rankSpanishFrequencyFamily({
      lemma: row.lemma,
      surfaceForm: row.surface_form,
      forms: row.forms,
      partOfSpeech: row.part_of_speech,
    });
    if (!ranking) continue;
    ranked.push({ id: row.id, ...ranking });
  }
  let updated = 0;
  const batchSize = 500;
  for (let offset = 0; offset < ranked.length; offset += batchSize) {
    const batch = ranked.slice(offset, offset + batchSize);
    const { rowCount } = await client.query(
      `UPDATE ${table}
          SET lemma_frequency_rank = incoming.lemma_rank,
              lemma_occurrences_per_billion = incoming.occurrences,
              frequency_count = incoming.occurrences,
              frequency = incoming.frequency_band,
              frequency_confidence = incoming.confidence,
              frequency_sources = incoming.sources
         FROM UNNEST(
           $1::uuid[], $2::int[], $3::bigint[], $4::int[], $5::text[], $6::jsonb[]
         ) AS incoming(id, lemma_rank, occurrences, frequency_band, confidence, sources)
        WHERE ${table}.id = incoming.id
          AND (
            ${table}.lemma_frequency_rank IS DISTINCT FROM incoming.lemma_rank
            OR ${table}.lemma_occurrences_per_billion IS DISTINCT FROM incoming.occurrences
            OR ${table}.frequency IS DISTINCT FROM incoming.frequency_band
            OR ${table}.frequency_confidence IS DISTINCT FROM incoming.confidence
            OR ${table}.frequency_sources IS DISTINCT FROM incoming.sources
          )`,
      [
        batch.map((row) => row.id),
        batch.map((row) => row.lemma_rank),
        batch.map((row) => row.occurrences_per_billion),
        batch.map((row) => row.frequency_band),
        batch.map((row) => row.confidence),
        batch.map((row) => JSON.stringify(row.sources)),
      ],
    );
    updated += rowCount || 0;
  }
  return { total: rows.length, updated };
}

export async function up(client) {
  const saved = await backfillTable(client, 'saved_words');
  const shared = await backfillTable(client, 'shared_dictionary_entries');

  await client.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, target_language
               ORDER BY priority DESC,
                        lemma_frequency_rank ASC NULLS LAST,
                        frequency DESC NULLS LAST,
                        frequency_count DESC NULLS LAST,
                        sense_rank ASC NULLS LAST,
                        created_at ASC,
                        id
             ) - 1 AS position
        FROM saved_words
       WHERE srs_interval = 0
         AND learning_step IS NULL
         AND last_reviewed_at IS NULL
    )
    UPDATE saved_words sw
       SET queue_position = ranked.position
      FROM ranked
     WHERE sw.id = ranked.id
       AND sw.queue_position IS DISTINCT FROM ranked.position
  `);

  const { rows: dirtySchedules } = await client.query(
    `SELECT user_id
       FROM user_schedule_state
      WHERE schedule_version IS DISTINCT FROM scheduled_version
      ORDER BY user_id`,
  );
  for (const { user_id: userId } of dirtySchedules) {
    await ensureScheduleCurrent(client, userId, 'UTC', { withinTransaction: true });
  }

  await client.query(
    `UPDATE frequency_catalog_versions
        SET diagnostics = diagnostics || $1::jsonb
      WHERE status = 'active'
        AND languages @> '["es"]'::jsonb`,
    [JSON.stringify([{
      code: 'spanish_frequency_family_backfill_completed',
      severity: 'info',
      pipeline: 'frequency_backfill',
      stage: 'saved-dictionaries',
      language: 'es',
      selectedAction: 'apply-bounded-inflection-family-ranking',
      detail: `saved=${saved.updated}/${saved.total}; shared=${shared.updated}/${shared.total}`,
      occurredAt: new Date().toISOString(),
    }])],
  );
}
