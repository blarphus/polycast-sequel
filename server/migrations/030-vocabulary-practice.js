/**
 * Vocabulary-first practice sessions and shared session XP.
 * Mixed Quiz data is intentionally removed by product decision.
 */
export async function up(client) {
  await client.query('DROP TABLE IF EXISTS quiz_answers CASCADE;');
  await client.query('DROP TABLE IF EXISTS quiz_sessions CASCADE;');

  await client.query(`
    CREATE TABLE IF NOT EXISTS learning_sessions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind             TEXT NOT NULL CHECK (kind IN ('flashcards', 'vocabulary')),
      target_language  VARCHAR(10),
      source_video_id  UUID REFERENCES videos(id) ON DELETE SET NULL,
      total_items      INTEGER NOT NULL DEFAULT 0,
      answered_count   INTEGER NOT NULL DEFAULT 0,
      correct_count    INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
      awarded_xp       INTEGER NOT NULL DEFAULT 0,
      diagnostics      JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at     TIMESTAMPTZ
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_learning_sessions_user_started
      ON learning_sessions (user_id, started_at DESC);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS vocabulary_practice_exercises (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id       UUID NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL,
      kind             TEXT NOT NULL CHECK (kind IN (
        'meaning_choice', 'word_choice', 'pair_match', 'context_choice',
        'context_type', 'listen_meaning', 'listen_type'
      )),
      saved_word_id    UUID REFERENCES saved_words(id) ON DELETE SET NULL,
      prompt           JSONB NOT NULL,
      answer           JSONB NOT NULL,
      response         JSONB,
      retry_of         UUID REFERENCES vocabulary_practice_exercises(id) ON DELETE SET NULL,
      is_correct       BOOLEAN,
      answered_at      TIMESTAMPTZ,
      UNIQUE (session_id, position)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_vocabulary_exercises_session
      ON vocabulary_practice_exercises (session_id, position);
  `);

  await client.query(`
    ALTER TABLE daily_learning_progress
      ADD COLUMN IF NOT EXISTS rewarded_sessions INTEGER NOT NULL DEFAULT 0;
  `);
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS progression_accent TEXT NOT NULL DEFAULT 'indigo';
  `);
  await client.query('ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_source_check;');
  await client.query(`
    ALTER TABLE xp_events
      ADD CONSTRAINT xp_events_source_check
      CHECK (source IN ('word_add', 'wild_recall', 'session_complete'));
  `);
  await client.query(`
    ALTER TABLE xp_events
      ADD COLUMN IF NOT EXISTS learning_session_id UUID REFERENCES learning_sessions(id) ON DELETE SET NULL;
  `);
  await client.query(`
    ALTER TABLE wild_recall_challenges
      ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
  `);
}
