export async function up(client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION mark_user_schedule_dirty() RETURNS trigger AS $$
    DECLARE affected_user UUID;
    BEGIN
      affected_user := COALESCE(NEW.user_id, OLD.user_id);
      -- During ON DELETE CASCADE the parent users row is already disappearing.
      -- Do not recreate child schedule state for that deletion; ordinary word
      -- mutations still mark the existing user dirty.
      IF EXISTS (SELECT 1 FROM users WHERE id = affected_user) THEN
        INSERT INTO user_schedule_state (user_id, schedule_version, dirty_at)
        VALUES (affected_user, 1, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET schedule_version = user_schedule_state.schedule_version + 1,
              dirty_at = NOW();
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;
  `);
}
