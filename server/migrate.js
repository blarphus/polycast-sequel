/**
 * Run database migrations. Creates tables if they do not already exist.
 */
export async function migrate(pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username      VARCHAR(40)  UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name  VARCHAR(80),
        created_at    TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // Case-insensitive username index for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username_lower
        ON users (LOWER(username));
    `);

    // Calls table
    await client.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        caller_id        UUID REFERENCES users(id),
        callee_id        UUID REFERENCES users(id),
        status           VARCHAR(20) DEFAULT 'completed',
        started_at       TIMESTAMPTZ DEFAULT NOW(),
        ended_at         TIMESTAMPTZ,
        duration_seconds INTEGER
      );
    `);

    // Friendships table
    await client.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(requester_id, recipient_id)
      );
    `);

    // Add language preference columns
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS native_language VARCHAR(10) DEFAULT NULL;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS target_language VARCHAR(10) DEFAULT NULL;
    `);

    // Saved words table (personal dictionary)
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_words (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        word             VARCHAR(200) NOT NULL,
        translation      TEXT NOT NULL DEFAULT '',
        definition       TEXT NOT NULL DEFAULT '',
        target_language  VARCHAR(10),
        sentence_context TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, word, target_language)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_words_user_id ON saved_words (user_id);
    `);

    // Allow multiple definitions per word (drop old unique constraint)
    await client.query(`
      ALTER TABLE saved_words DROP CONSTRAINT IF EXISTS saved_words_user_id_word_target_language_key;
    `);

    // Add enrichment columns to saved_words
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS frequency INTEGER DEFAULT NULL;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS example_sentence TEXT DEFAULT NULL;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS part_of_speech VARCHAR(50) DEFAULT NULL;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;`);

    // Lemmatization columns
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS lemma TEXT DEFAULT NULL;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS forms TEXT DEFAULT NULL;`);

    // SRS (spaced repetition) columns on saved_words
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS srs_interval INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ DEFAULT NULL;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ DEFAULT NULL;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS correct_count INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS incorrect_count INTEGER DEFAULT 0;`);

    // Anki-style SRS columns
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS ease_factor REAL DEFAULT 2.5;`);
    await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS learning_step INTEGER DEFAULT NULL;`);

    // Reset legacy srs_interval values (old 1-9 ladder → new seconds-based system)
    await client.query(`UPDATE saved_words SET srs_interval = 0 WHERE srs_interval BETWEEN 1 AND 9;`);

    // Transcript entries table (stores completed sentences from calls)
    await client.query(`
      CREATE TABLE IF NOT EXISTS transcript_entries (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        call_id    UUID REFERENCES calls(id) ON DELETE CASCADE,
        user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
        text       TEXT NOT NULL,
        language   VARCHAR(10),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transcript_entries_call_id
        ON transcript_entries (call_id);
    `);

    // Messages table (DM chat)
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body        TEXT NOT NULL,
        read_at     TIMESTAMPTZ DEFAULT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
        ON messages (receiver_id) WHERE read_at IS NULL;
    `);

    await client.query('COMMIT');
    console.log('Database migrations completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}
