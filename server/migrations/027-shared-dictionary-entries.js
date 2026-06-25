export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS shared_dictionary_entries (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      target_language    VARCHAR(10) NOT NULL,
      word_key           TEXT NOT NULL,
      word               TEXT NOT NULL,
      part_of_speech_key TEXT NOT NULL DEFAULT '',
      part_of_speech     TEXT,
      definition_hash    TEXT NOT NULL,
      definition         TEXT NOT NULL,
      translation        TEXT NOT NULL DEFAULT '',
      frequency          INTEGER,
      frequency_count    INTEGER,
      example_sentence   TEXT,
      sentence_translation TEXT,
      image_url          TEXT,
      image_term         TEXT,
      lemma              TEXT,
      forms              TEXT,
      definition_source  TEXT,
      matched_gloss      TEXT,
      source_sense_index INTEGER,
      use_count          INTEGER NOT NULL DEFAULT 1,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (target_language, word_key, part_of_speech_key, definition_hash)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_shared_dictionary_entries_lookup
      ON shared_dictionary_entries (target_language, word_key, part_of_speech_key, definition_hash);
  `);

  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS shared_entry_id UUID REFERENCES shared_dictionary_entries(id) ON DELETE SET NULL;
  `);

  await client.query(`
    ALTER TABLE stream_post_words
      ADD COLUMN IF NOT EXISTS shared_entry_id UUID REFERENCES shared_dictionary_entries(id) ON DELETE SET NULL;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_words_shared_entry_id
      ON saved_words (shared_entry_id)
      WHERE shared_entry_id IS NOT NULL;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_stream_post_words_shared_entry_id
      ON stream_post_words (shared_entry_id)
      WHERE shared_entry_id IS NOT NULL;
  `);
}
