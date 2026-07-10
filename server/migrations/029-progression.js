/**
 * Account-wide progression for daily word goals and Wild Recall.
 */
export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS daily_word_goal INTEGER NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS total_xp INTEGER NOT NULL DEFAULT 0;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS daily_learning_progress (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      local_date DATE NOT NULL,
      word_adds INTEGER NOT NULL DEFAULT 0,
      wild_recall_answered INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, local_date)
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS xp_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('word_add', 'wild_recall')),
      amount INTEGER NOT NULL DEFAULT 0,
      saved_word_id UUID REFERENCES saved_words(id) ON DELETE SET NULL,
      local_date DATE NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wild_recall_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_word_id UUID NOT NULL REFERENCES saved_words(id) ON DELETE CASCADE,
      options JSONB NOT NULL,
      correct_option_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
      retry_on DATE,
      answered_at TIMESTAMPTZ,
      correct BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wild_recall_one_pending_per_user
      ON wild_recall_challenges (user_id) WHERE status = 'pending';
  `);
}
