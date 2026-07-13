export async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE frequency_catalog_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      version TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'active', 'retired', 'failed')),
      source_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
      built_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX frequency_catalog_one_active
      ON frequency_catalog_versions ((status)) WHERE status = 'active';

    CREATE TABLE dictionary_lemmas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      language VARCHAR(10) NOT NULL,
      lemma_key TEXT NOT NULL,
      canonical_lemma TEXT NOT NULL,
      provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (language, lemma_key)
    );

    CREATE TABLE dictionary_senses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lemma_id UUID NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
      part_of_speech TEXT NOT NULL DEFAULT '',
      definition TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      source_sense_id TEXT NOT NULL,
      source_order INTEGER NOT NULL DEFAULT 0,
      provisional BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source, source_sense_id)
    );
    CREATE INDEX dictionary_senses_lemma_order
      ON dictionary_senses (lemma_id, source_order, id) WHERE active;
    CREATE INDEX dictionary_senses_definition
      ON dictionary_senses (lemma_id, part_of_speech, definition_hash) WHERE active;

    CREATE TABLE lemma_frequency_rankings (
      catalog_version_id UUID NOT NULL REFERENCES frequency_catalog_versions(id) ON DELETE CASCADE,
      lemma_id UUID NOT NULL REFERENCES dictionary_lemmas(id) ON DELETE CASCADE,
      language VARCHAR(10) NOT NULL,
      lemma_rank INTEGER NOT NULL,
      occurrences_per_billion BIGINT,
      zipf NUMERIC(6, 3),
      frequency_band SMALLINT NOT NULL CHECK (frequency_band BETWEEN 1 AND 10),
      confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unavailable')),
      percentile NUMERIC(7, 6),
      sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (catalog_version_id, lemma_id),
      UNIQUE (catalog_version_id, language, lemma_rank)
    );

    CREATE TABLE sense_rankings (
      catalog_version_id UUID NOT NULL REFERENCES frequency_catalog_versions(id) ON DELETE CASCADE,
      sense_id UUID NOT NULL REFERENCES dictionary_senses(id) ON DELETE CASCADE,
      language VARCHAR(10) NOT NULL,
      lemma_rank INTEGER NOT NULL,
      sense_order INTEGER NOT NULL,
      sense_rank BIGINT NOT NULL,
      PRIMARY KEY (catalog_version_id, sense_id),
      UNIQUE (catalog_version_id, language, sense_rank)
    );
    CREATE INDEX sense_rankings_order ON sense_rankings (catalog_version_id, sense_rank);

    CREATE TABLE fallback_diagnostics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      correlation_id TEXT NOT NULL,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      pipeline TEXT,
      stage TEXT,
      source TEXT NOT NULL,
      operation TEXT NOT NULL,
      language TEXT,
      entity_type TEXT,
      entity_id TEXT,
      selected_action TEXT,
      message TEXT NOT NULL,
      detail TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fallback_diagnostics_correlation ON fallback_diagnostics (correlation_id, occurred_at DESC);
    CREATE INDEX fallback_diagnostics_entity ON fallback_diagnostics (entity_type, entity_id, occurred_at DESC);

    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS lemma_id UUID REFERENCES dictionary_lemmas(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS sense_id UUID REFERENCES dictionary_senses(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS rank_version_id UUID REFERENCES frequency_catalog_versions(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS lemma_frequency_rank INTEGER,
      ADD COLUMN IF NOT EXISTS sense_rank BIGINT,
      ADD COLUMN IF NOT EXISTS lemma_occurrences_per_billion BIGINT,
      ADD COLUMN IF NOT EXISTS frequency_confidence TEXT,
      ADD COLUMN IF NOT EXISTS frequency_sources JSONB,
      ADD COLUMN IF NOT EXISTS ranking_diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb;
    CREATE UNIQUE INDEX saved_words_user_sense_unique
      ON saved_words (user_id, target_language, sense_id) WHERE sense_id IS NOT NULL;
    CREATE INDEX saved_words_catalog_order
      ON saved_words (user_id, target_language, priority DESC, sense_rank ASC NULLS LAST);

    ALTER TABLE shared_dictionary_entries
      ADD COLUMN IF NOT EXISTS lemma_id UUID REFERENCES dictionary_lemmas(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS sense_id UUID REFERENCES dictionary_senses(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS rank_version_id UUID REFERENCES frequency_catalog_versions(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS lemma_frequency_rank INTEGER,
      ADD COLUMN IF NOT EXISTS sense_rank BIGINT,
      ADD COLUMN IF NOT EXISTS lemma_occurrences_per_billion BIGINT,
      ADD COLUMN IF NOT EXISTS frequency_confidence TEXT,
      ADD COLUMN IF NOT EXISTS frequency_sources JSONB;

    ALTER TABLE wiktionary
      ADD COLUMN IF NOT EXISTS source_entry_id TEXT;
  `);
}
