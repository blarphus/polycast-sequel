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
