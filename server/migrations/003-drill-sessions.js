/**
 * 003-drill-sessions — Conjugation drill session tracking for leaderboard.
 */
export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS drill_sessions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tense_key        VARCHAR(30) NOT NULL,
      verb_filter      VARCHAR(15) NOT NULL DEFAULT 'all',
      question_count   INTEGER NOT NULL DEFAULT 20,
      correct_count    INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_drill_sessions_user
      ON drill_sessions (user_id);
  `);
}
