export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS introduced_date DATE DEFAULT NULL
  `);

  // Backfill: cards that have been reviewed get their first review date
  await client.query(`
    UPDATE saved_words
    SET introduced_date = last_reviewed_at::date
    WHERE last_reviewed_at IS NOT NULL
      AND introduced_date IS NULL
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_words_introduced_date
      ON saved_words (user_id, target_language, introduced_date)
      WHERE introduced_date IS NOT NULL
  `);
}
