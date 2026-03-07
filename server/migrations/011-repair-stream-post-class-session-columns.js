export async function up(client) {
  await client.query(`
    ALTER TABLE stream_posts
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL;
  `);

  await client.query(`
    ALTER TABLE stream_posts
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT NULL;
  `);

  await client.query(`
    ALTER TABLE stream_posts
      ADD COLUMN IF NOT EXISTS recurrence JSONB DEFAULT NULL;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_stream_posts_scheduled_at
      ON stream_posts (scheduled_at) WHERE type = 'class_session';
  `);
}
