export async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE INDEX IF NOT EXISTS idx_saved_words_group_page
      ON saved_words(user_id, target_language, word);

    CREATE INDEX IF NOT EXISTS idx_saved_words_new_queue
      ON saved_words(user_id, target_language, queue_position)
      WHERE srs_interval = 0 AND learning_step IS NULL AND last_reviewed_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_saved_words_review_due
      ON saved_words(user_id, target_language, due_at)
      WHERE last_reviewed_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_saved_words_folded_word
      ON saved_words USING gin (
        (translate(LOWER(word), 'áàâãäåéèêëíìîïóòôõöúùûüñçýÿ', 'aaaaaaeeeeiiiiooooouuuuncyy')) gin_trgm_ops
      );

    CREATE INDEX IF NOT EXISTS idx_saved_words_folded_translation
      ON saved_words USING gin (
        (translate(LOWER(translation), 'áàâãäåéèêëíìîïóòôõöúùûüñçýÿ', 'aaaaaaeeeeiiiiooooouuuuncyy')) gin_trgm_ops
      );
  `);
}
