export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS relearning_date DATE DEFAULT NULL
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_words_relearning_date
      ON saved_words (user_id, target_language, relearning_date)
      WHERE relearning_date IS NOT NULL
  `);
}
