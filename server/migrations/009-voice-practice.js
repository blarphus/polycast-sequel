/**
 * 009-voice-practice — summary-only session storage + sentence card cache
 * for realtime voice translation practice.
 */
export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS voice_sentence_cards (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_type         VARCHAR(32) NOT NULL,
      source_ref_id       TEXT,
      target_language     VARCHAR(10) NOT NULL,
      native_language     VARCHAR(10) NOT NULL,
      target_sentence     TEXT NOT NULL,
      native_prompt       TEXT NOT NULL,
      difficulty          VARCHAR(10),
      focus_words_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
      assignment_priority BOOLEAN NOT NULL DEFAULT false,
      content_hash        TEXT NOT NULL UNIQUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_voice_sentence_cards_langs
      ON voice_sentence_cards (target_language, native_language);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS voice_practice_sessions (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      native_language       VARCHAR(10) NOT NULL,
      target_language       VARCHAR(10) NOT NULL,
      cefr_level            VARCHAR(5),
      source_mode           VARCHAR(32) NOT NULL DEFAULT 'mixed_priority',
      prompt_count          INTEGER NOT NULL DEFAULT 0,
      answered_count        INTEGER NOT NULL DEFAULT 0,
      correct_count         INTEGER NOT NULL DEFAULT 0,
      partial_count         INTEGER NOT NULL DEFAULT 0,
      incorrect_count       INTEGER NOT NULL DEFAULT 0,
      skipped_count         INTEGER NOT NULL DEFAULT 0,
      duration_seconds      INTEGER NOT NULL DEFAULT 0,
      feedback_language_mode VARCHAR(12) NOT NULL DEFAULT 'native',
      source_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      issue_counts_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
      sentences_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
      completed_at          TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_voice_practice_sessions_user
      ON voice_practice_sessions (user_id, created_at DESC);
  `);
}
