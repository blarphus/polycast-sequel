/**
 * 001-baseline — all DDL that existed before the migration runner was introduced.
 * On fresh databases this creates everything from scratch.
 * On existing databases the runner detects the `users` table and marks this as already applied.
 */
export async function up(client) {
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

  // Language preference columns
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS native_language VARCHAR(10) DEFAULT NULL;`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS target_language VARCHAR(10) DEFAULT NULL;`);

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

  await client.query(`CREATE INDEX IF NOT EXISTS idx_saved_words_user_id ON saved_words (user_id);`);

  // Allow multiple definitions per word (drop old unique constraint)
  await client.query(`ALTER TABLE saved_words DROP CONSTRAINT IF EXISTS saved_words_user_id_word_target_language_key;`);

  // Enrichment columns on saved_words
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS frequency INTEGER DEFAULT NULL;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS example_sentence TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS part_of_speech VARCHAR(50) DEFAULT NULL;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;`);

  // Lemmatization columns
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS lemma TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS forms TEXT DEFAULT NULL;`);

  // SRS (spaced repetition) columns
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS srs_interval INTEGER DEFAULT 0;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ DEFAULT NULL;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ DEFAULT NULL;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS correct_count INTEGER DEFAULT 0;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS incorrect_count INTEGER DEFAULT 0;`);

  // Anki-style SRS columns
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS ease_factor REAL DEFAULT 2.5;`);
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS learning_step INTEGER DEFAULT NULL;`);

  // Raw SUBTLEX corpus occurrence count
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS frequency_count INTEGER DEFAULT NULL;`);

  // Reset legacy srs_interval values
  await client.query(`UPDATE saved_words SET srs_interval = 0 WHERE srs_interval BETWEEN 1 AND 9;`);

  // Daily new-card limit per user
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_new_limit INTEGER DEFAULT 5;`);

  // Transcript entries table
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

  // Account type column
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(10) DEFAULT 'student';`);

  // CEFR placement level
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cefr_level VARCHAR(2) DEFAULT NULL;`);
  await client.query(`UPDATE users SET account_type = 'teacher' WHERE account_type IS NULL;`);

  // Per-language CEFR levels
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cefr_levels JSONB DEFAULT '{}';`);
  await client.query(`
    UPDATE users
    SET cefr_levels = jsonb_set('{}', ARRAY[target_language], to_jsonb(cefr_level))
    WHERE cefr_level IS NOT NULL
      AND target_language IS NOT NULL
      AND (cefr_levels IS NULL OR cefr_levels = '{}');
  `);

  // Classroom students table
  await client.query(`
    CREATE TABLE IF NOT EXISTS classroom_students (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(teacher_id, student_id)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_classroom_students_teacher
      ON classroom_students (teacher_id);
  `);

  // Stream posts
  await client.query(`
    CREATE TABLE IF NOT EXISTS stream_posts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type            VARCHAR(20) NOT NULL,
      title           TEXT,
      body            TEXT,
      attachments     JSONB DEFAULT '[]',
      target_language VARCHAR(10),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Stream post words
  await client.query(`
    CREATE TABLE IF NOT EXISTS stream_post_words (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id        UUID NOT NULL REFERENCES stream_posts(id) ON DELETE CASCADE,
      word           TEXT NOT NULL,
      translation    TEXT DEFAULT '',
      definition     TEXT DEFAULT '',
      part_of_speech VARCHAR(50),
      position       INTEGER,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Student known words
  await client.query(`
    CREATE TABLE IF NOT EXISTS stream_word_known (
      student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_word_id UUID NOT NULL REFERENCES stream_post_words(id) ON DELETE CASCADE,
      PRIMARY KEY (student_id, post_word_id)
    );
  `);

  // Word list completions
  await client.query(`
    CREATE TABLE IF NOT EXISTS stream_word_list_completions (
      student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id      UUID NOT NULL REFERENCES stream_posts(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (student_id, post_id)
    );
  `);

  // Priority flag on saved_words
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS priority BOOLEAN DEFAULT false;`);

  // Lesson items
  await client.query(`ALTER TABLE stream_posts ADD COLUMN IF NOT EXISTS lesson_items JSONB DEFAULT '[]';`);

  // Stream topics
  await client.query(`
    CREATE TABLE IF NOT EXISTS stream_topics (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      position   INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Topic assignment and position on stream posts
  await client.query(`ALTER TABLE stream_posts ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES stream_topics(id) ON DELETE SET NULL;`);
  await client.query(`ALTER TABLE stream_posts ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;`);

  // image_term columns
  await client.query(`ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS image_term TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS image_term TEXT DEFAULT NULL;`);

  // Enrichment columns on stream_post_words
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS frequency INTEGER DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS frequency_count INTEGER DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS example_sentence TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS lemma TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_post_words ADD COLUMN IF NOT EXISTS forms TEXT DEFAULT NULL;`);

  // Videos table
  await client.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      youtube_id       VARCHAR(20) UNIQUE NOT NULL,
      title            TEXT NOT NULL,
      channel          TEXT NOT NULL,
      language         VARCHAR(10) NOT NULL DEFAULT 'en',
      duration_seconds INTEGER,
      transcript       JSONB DEFAULT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Transcript lifecycle columns
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_status VARCHAR(20) NOT NULL DEFAULT 'missing';`);
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_source VARCHAR(20) NOT NULL DEFAULT 'none';`);
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_last_error TEXT DEFAULT NULL;`);
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_attempts INTEGER NOT NULL DEFAULT 0;`);
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_updated_at TIMESTAMPTZ DEFAULT NULL;`);
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS cefr_level VARCHAR(2) DEFAULT NULL;`);
  await client.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_progress INTEGER NOT NULL DEFAULT 0;`);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_videos_transcript_status
      ON videos (transcript_status);
  `);

  // Backfill status for legacy rows
  await client.query(`
    UPDATE videos
    SET transcript_status = 'ready',
        transcript_source = CASE WHEN transcript_source = 'none' THEN 'manual' ELSE transcript_source END
    WHERE transcript IS NOT NULL AND transcript_status = 'missing';
  `);

  // Class session scheduling columns
  await client.query(`ALTER TABLE stream_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_posts ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT NULL;`);
  await client.query(`ALTER TABLE stream_posts ADD COLUMN IF NOT EXISTS recurrence JSONB DEFAULT NULL;`);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_stream_posts_scheduled_at
      ON stream_posts (scheduled_at) WHERE type = 'class_session';
  `);

  // Group calls table
  await client.query(`
    CREATE TABLE IF NOT EXISTS group_calls (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id      UUID NOT NULL REFERENCES stream_posts(id) ON DELETE CASCADE,
      session_date DATE NOT NULL,
      status       VARCHAR(10) NOT NULL DEFAULT 'active',
      started_at   TIMESTAMPTZ DEFAULT NOW(),
      ended_at     TIMESTAMPTZ
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_group_calls_active
      ON group_calls (post_id, session_date) WHERE status = 'active';
  `);

  // Group call participants
  await client.query(`
    CREATE TABLE IF NOT EXISTS group_call_participants (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_call_id UUID NOT NULL REFERENCES group_calls(id) ON DELETE CASCADE,
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at     TIMESTAMPTZ DEFAULT NOW(),
      left_at       TIMESTAMPTZ
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_group_call_participants_unique
      ON group_call_participants (group_call_id, user_id) WHERE left_at IS NULL;
  `);

  // Seed default English videos (only if table is empty)
  const { rows: existingVideos } = await client.query('SELECT 1 FROM videos LIMIT 1');
  if (existingVideos.length === 0) {
    await client.query(`
      INSERT INTO videos (youtube_id, title, channel, language, duration_seconds) VALUES
        ('7_LPdttKXPc', 'How The Economic Machine Works', 'Principles by Ray Dalio', 'en', 1844),
        ('dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up', 'Rick Astley', 'en', 213),
        ('YbJOTdZBX1g', 'How to Learn a Language in Record Time', 'Nathaniel Drew', 'en', 780),
        ('HAnw168huqA', 'Learn English With TV Series', 'English with Lucy', 'en', 900),
        ('UIp6_0kct_U', 'A Beginners Guide to Quantum Computing', 'IBM Technology', 'en', 1068)
      ON CONFLICT (youtube_id) DO NOTHING;
    `);
  }
}
