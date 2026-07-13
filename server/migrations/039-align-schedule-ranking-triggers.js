export async function up(client) {
  await client.query(`
    DROP TRIGGER IF EXISTS saved_words_schedule_dirty ON saved_words;
    CREATE TRIGGER saved_words_schedule_dirty
      AFTER INSERT OR DELETE OR UPDATE OF
        target_language, priority, lemma_frequency_rank, sense_rank,
        srs_interval, learning_step, last_reviewed_at, introduced_date, relearning_date
      ON saved_words
      FOR EACH ROW EXECUTE FUNCTION mark_user_schedule_dirty();
  `);
}
