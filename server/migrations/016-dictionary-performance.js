export async function up(client) {
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_words_user_target_created_desc
      ON saved_words (user_id, target_language, created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_words_due_active
      ON saved_words (user_id, target_language, due_at ASC, created_at ASC)
      WHERE due_at IS NOT NULL;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_words_new_queue
      ON saved_words (user_id, target_language, queue_position ASC, priority DESC, frequency DESC, created_at ASC)
      WHERE due_at IS NULL AND last_reviewed_at IS NULL;
  `);
}
