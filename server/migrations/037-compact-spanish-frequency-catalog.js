export async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS unaccent;

    ALTER TABLE frequency_catalog_versions
      ADD COLUMN IF NOT EXISTS languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS build_run_id UUID;

    CREATE TABLE compact_lemma_rankings (
      catalog_version_id UUID NOT NULL REFERENCES frequency_catalog_versions(id) ON DELETE CASCADE,
      language VARCHAR(10) NOT NULL,
      lemma_key TEXT NOT NULL,
      canonical_lemma TEXT NOT NULL,
      lemma_rank INTEGER NOT NULL,
      occurrences_per_billion BIGINT,
      zipf NUMERIC(8, 3),
      frequency_band SMALLINT NOT NULL CHECK (frequency_band BETWEEN 1 AND 10),
      confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unavailable')),
      percentile NUMERIC(9, 8),
      sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (catalog_version_id, language, lemma_key),
      UNIQUE (catalog_version_id, language, lemma_rank)
    );
    CREATE INDEX compact_lemma_rankings_lookup
      ON compact_lemma_rankings (language, lemma_key, catalog_version_id);

    CREATE TABLE compact_sense_rankings (
      catalog_version_id UUID NOT NULL REFERENCES frequency_catalog_versions(id) ON DELETE CASCADE,
      wiktionary_id INTEGER NOT NULL REFERENCES wiktionary(id) ON DELETE CASCADE,
      sense_index INTEGER NOT NULL CHECK (sense_index >= 0),
      gloss_index INTEGER NOT NULL CHECK (gloss_index >= 0),
      sense_order INTEGER NOT NULL CHECK (sense_order > 0),
      sense_rank INTEGER NOT NULL CHECK (sense_rank > 0),
      PRIMARY KEY (catalog_version_id, wiktionary_id, sense_index, gloss_index),
      UNIQUE (catalog_version_id, sense_rank)
    );

    CREATE TABLE catalog_provisional_lemmas (
      id BIGSERIAL PRIMARY KEY,
      language VARCHAR(10) NOT NULL,
      lemma_key TEXT NOT NULL,
      canonical_lemma TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (language, lemma_key)
    );

    CREATE TABLE catalog_provisional_senses (
      id BIGSERIAL PRIMARY KEY,
      lemma_id BIGINT NOT NULL REFERENCES catalog_provisional_lemmas(id) ON DELETE CASCADE,
      part_of_speech TEXT NOT NULL DEFAULT '',
      definition TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      sense_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (lemma_id, part_of_speech, definition_hash)
    );
    CREATE INDEX catalog_provisional_senses_lookup
      ON catalog_provisional_senses (lemma_id, part_of_speech, definition_hash);

    CREATE TABLE frequency_catalog_build_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      version TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'rolled_back')),
      requested_languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_language VARCHAR(10),
      current_phase TEXT,
      message TEXT,
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
      catalog_version_id UUID REFERENCES frequency_catalog_versions(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX frequency_catalog_build_runs_latest
      ON frequency_catalog_build_runs (created_at DESC);

    CREATE TABLE frequency_catalog_language_progress (
      build_id UUID NOT NULL REFERENCES frequency_catalog_build_runs(id) ON DELETE CASCADE,
      language VARCHAR(10) NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'rolled_back')),
      phase TEXT NOT NULL DEFAULT 'queued',
      phase_completed BIGINT NOT NULL DEFAULT 0,
      phase_total BIGINT,
      overall_completed BIGINT NOT NULL DEFAULT 0,
      overall_total BIGINT,
      throughput_per_second NUMERIC(16, 3),
      eta_seconds BIGINT,
      counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      phases JSONB NOT NULL DEFAULT '{}'::jsonb,
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
      message TEXT,
      phase_started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (build_id, language)
    );
    CREATE INDEX frequency_catalog_language_progress_latest
      ON frequency_catalog_language_progress (language, updated_at DESC);

    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS catalog_lemma_key TEXT,
      ADD COLUMN IF NOT EXISTS catalog_wiktionary_id INTEGER REFERENCES wiktionary(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS catalog_sense_index INTEGER,
      ADD COLUMN IF NOT EXISTS catalog_gloss_index INTEGER,
      ADD COLUMN IF NOT EXISTS catalog_provisional_sense_id BIGINT REFERENCES catalog_provisional_senses(id) ON DELETE SET NULL;
    CREATE INDEX saved_words_compact_catalog_lookup
      ON saved_words (user_id, target_language, catalog_lemma_key, catalog_wiktionary_id,
                      catalog_sense_index, catalog_gloss_index);

    ALTER TABLE shared_dictionary_entries
      ADD COLUMN IF NOT EXISTS catalog_lemma_key TEXT,
      ADD COLUMN IF NOT EXISTS catalog_wiktionary_id INTEGER REFERENCES wiktionary(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS catalog_sense_index INTEGER,
      ADD COLUMN IF NOT EXISTS catalog_gloss_index INTEGER,
      ADD COLUMN IF NOT EXISTS catalog_provisional_sense_id BIGINT REFERENCES catalog_provisional_senses(id) ON DELETE SET NULL;
    CREATE INDEX shared_entries_compact_catalog_lookup
      ON shared_dictionary_entries (target_language, catalog_lemma_key, catalog_wiktionary_id,
                                    catalog_sense_index, catalog_gloss_index);
  `);
}
