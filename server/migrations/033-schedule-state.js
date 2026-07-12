export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_schedule_state (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      schedule_version BIGINT NOT NULL DEFAULT 0,
      scheduled_version BIGINT NOT NULL DEFAULT -1,
      local_day DATE,
      dirty_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      scheduled_at TIMESTAMPTZ
    );

    CREATE OR REPLACE FUNCTION mark_user_schedule_dirty() RETURNS trigger AS $$
    DECLARE affected_user UUID;
    BEGIN
      affected_user := COALESCE(NEW.user_id, OLD.user_id);
      INSERT INTO user_schedule_state (user_id, schedule_version, dirty_at)
      VALUES (affected_user, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET schedule_version = user_schedule_state.schedule_version + 1,
            dirty_at = NOW();
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS saved_words_schedule_dirty ON saved_words;
    CREATE TRIGGER saved_words_schedule_dirty
      AFTER INSERT OR DELETE OR UPDATE OF
        word, target_language, frequency, frequency_count, priority,
        srs_interval, learning_step, last_reviewed_at, introduced_date, relearning_date
      ON saved_words
      FOR EACH ROW EXECUTE FUNCTION mark_user_schedule_dirty();

    CREATE OR REPLACE FUNCTION mark_user_preferences_schedule_dirty() RETURNS trigger AS $$
    BEGIN
      INSERT INTO user_schedule_state (user_id, schedule_version, dirty_at)
      VALUES (NEW.id, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET schedule_version = user_schedule_state.schedule_version + 1,
            dirty_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS users_schedule_dirty ON users;
    CREATE TRIGGER users_schedule_dirty
      AFTER UPDATE OF target_language, daily_new_limit ON users
      FOR EACH ROW
      WHEN (OLD.target_language IS DISTINCT FROM NEW.target_language OR OLD.daily_new_limit IS DISTINCT FROM NEW.daily_new_limit)
      EXECUTE FUNCTION mark_user_preferences_schedule_dirty();

    INSERT INTO user_schedule_state (user_id, schedule_version, scheduled_version, dirty_at)
    SELECT id, 1, -1, NOW() FROM users
    ON CONFLICT (user_id) DO NOTHING;
  `);
}
