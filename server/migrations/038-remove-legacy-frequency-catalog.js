export async function up(client) {
  await client.query(`
    DROP INDEX IF EXISTS saved_words_user_sense_unique;

    ALTER TABLE saved_words
      DROP COLUMN IF EXISTS lemma_id,
      DROP COLUMN IF EXISTS sense_id;

    ALTER TABLE shared_dictionary_entries
      DROP COLUMN IF EXISTS lemma_id,
      DROP COLUMN IF EXISTS sense_id;

    DROP TABLE IF EXISTS sense_rankings;
    DROP TABLE IF EXISTS lemma_frequency_rankings;
    DROP TABLE IF EXISTS dictionary_senses;
    DROP TABLE IF EXISTS dictionary_lemmas;

    CREATE UNIQUE INDEX saved_words_user_wiktionary_sense_unique
      ON saved_words (
        user_id, target_language, catalog_wiktionary_id,
        catalog_sense_index, catalog_gloss_index
      )
      WHERE catalog_wiktionary_id IS NOT NULL;

    CREATE UNIQUE INDEX saved_words_user_provisional_sense_unique
      ON saved_words (user_id, target_language, catalog_provisional_sense_id)
      WHERE catalog_provisional_sense_id IS NOT NULL;
  `);
}
