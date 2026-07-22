export async function up(client) {
  await client.query(`
    DROP TRIGGER IF EXISTS saved_words_schedule_dirty ON saved_words;
    DROP TRIGGER IF EXISTS saved_words_schedule_dirty_insert_delete ON saved_words;
    DROP TRIGGER IF EXISTS saved_words_schedule_dirty_update ON saved_words;

    CREATE TRIGGER saved_words_schedule_dirty_insert_delete
      AFTER INSERT OR DELETE ON saved_words
      FOR EACH ROW EXECUTE FUNCTION mark_user_schedule_dirty();

    CREATE TRIGGER saved_words_schedule_dirty_update
      AFTER UPDATE OF
        target_language, priority, lemma_frequency_rank, sense_rank,
        srs_interval, learning_step, last_reviewed_at, introduced_date, relearning_date
      ON saved_words
      FOR EACH ROW
      WHEN (
        OLD.target_language IS DISTINCT FROM NEW.target_language
        OR OLD.priority IS DISTINCT FROM NEW.priority
        OR OLD.lemma_frequency_rank IS DISTINCT FROM NEW.lemma_frequency_rank
        OR OLD.sense_rank IS DISTINCT FROM NEW.sense_rank
        OR OLD.srs_interval IS DISTINCT FROM NEW.srs_interval
        OR OLD.learning_step IS DISTINCT FROM NEW.learning_step
        OR OLD.last_reviewed_at IS DISTINCT FROM NEW.last_reviewed_at
        OR OLD.introduced_date IS DISTINCT FROM NEW.introduced_date
        OR OLD.relearning_date IS DISTINCT FROM NEW.relearning_date
      )
      EXECUTE FUNCTION mark_user_schedule_dirty();
  `);
}
