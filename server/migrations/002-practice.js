/**
 * 002-practice — Quiz / practice session tables for the practice system.
 */
export async function up(client) {
  // Quiz sessions — one row per quiz attempt
  await client.query(`
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id         UUID REFERENCES videos(id) ON DELETE SET NULL,
      mode             VARCHAR(20) NOT NULL DEFAULT 'standalone',
      target_language  VARCHAR(10),
      question_count   INTEGER NOT NULL DEFAULT 0,
      correct_count    INTEGER NOT NULL DEFAULT 0,
      completed_at     TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user
      ON quiz_sessions (user_id);
  `);

  // Quiz answers — one row per question answered
  await client.query(`
    CREATE TABLE IF NOT EXISTS quiz_answers (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id       UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      question_index   INTEGER NOT NULL,
      question_type    VARCHAR(30) NOT NULL,
      input_mode       VARCHAR(20) NOT NULL DEFAULT 'free_type',
      prompt           TEXT NOT NULL,
      expected_answer  TEXT NOT NULL,
      user_answer      TEXT,
      is_correct       BOOLEAN,
      ai_feedback      TEXT,
      saved_word_id    UUID REFERENCES saved_words(id) ON DELETE SET NULL,
      answered_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_session
      ON quiz_answers (session_id);
  `);
}
