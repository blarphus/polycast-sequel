export async function up(client) {
  await client.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, target_language
               ORDER BY priority DESC,
                        frequency_count DESC NULLS LAST,
                        frequency DESC NULLS LAST,
                        lemma_frequency_rank ASC NULLS LAST,
                        sense_rank ASC NULLS LAST,
                        created_at ASC,
                        id
             ) - 1 AS position
      FROM saved_words
      WHERE srs_interval = 0
        AND learning_step IS NULL
        AND last_reviewed_at IS NULL
    )
    UPDATE saved_words sw
       SET queue_position = ranked.position
      FROM ranked
     WHERE sw.id = ranked.id
       AND sw.queue_position IS DISTINCT FROM ranked.position
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS saved_words_schedule_dirty_update ON saved_words;
    CREATE TRIGGER saved_words_schedule_dirty_update
      AFTER UPDATE OF
        target_language, priority, frequency_count, frequency,
        lemma_frequency_rank, sense_rank, srs_interval, learning_step,
        last_reviewed_at, introduced_date, relearning_date
      ON saved_words
      FOR EACH ROW
      WHEN (
        OLD.target_language IS DISTINCT FROM NEW.target_language
        OR OLD.priority IS DISTINCT FROM NEW.priority
        OR OLD.frequency_count IS DISTINCT FROM NEW.frequency_count
        OR OLD.frequency IS DISTINCT FROM NEW.frequency
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
