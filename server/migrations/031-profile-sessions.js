export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
      ON auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

    CREATE TABLE IF NOT EXISTS profile_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS profile_session_accounts (
      profile_session_id UUID NOT NULL REFERENCES profile_sessions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (profile_session_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_profile_sessions_expiry
      ON profile_sessions(expires_at) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_profile_session_accounts_user
      ON profile_session_accounts(user_id);
  `);
}
