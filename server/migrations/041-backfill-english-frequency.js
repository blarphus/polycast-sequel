import { lookupEmbeddedFrequency } from '../lib/embeddedFrequencyCatalog.js';
import { bandForLemmaRank } from '../lib/frequencyCatalog.js';

async function backfillTable(client, table) {
  const { rows } = await client.query(
    `SELECT id, COALESCE(NULLIF(BTRIM(lemma), ''), BTRIM(word)) AS lemma
       FROM ${table}
      WHERE target_language = 'en'`,
  );
  for (const row of rows) {
    const entry = lookupEmbeddedFrequency('en', row.lemma, bandForLemmaRank);
    if (!entry) continue;
    await client.query(
      `UPDATE ${table}
          SET catalog_lemma_key = $2,
              lemma_frequency_rank = $3,
              lemma_occurrences_per_billion = $4,
              frequency_count = $4,
              frequency = $5,
              frequency_confidence = $6,
              frequency_sources = $7::jsonb
        WHERE id = $1`,
      [
        row.id,
        entry.catalog_lemma_key,
        entry.lemma_rank,
        entry.lemma_occurrences_per_billion,
        entry.frequency_band,
        entry.frequency_confidence,
        JSON.stringify(entry.frequency_sources),
      ],
    );
  }
}

export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words ALTER COLUMN frequency_count TYPE BIGINT;
    ALTER TABLE shared_dictionary_entries ALTER COLUMN frequency_count TYPE BIGINT;
  `);
  await backfillTable(client, 'saved_words');
  await backfillTable(client, 'shared_dictionary_entries');
}
