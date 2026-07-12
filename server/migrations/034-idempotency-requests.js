export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS idempotency_requests (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key UUID NOT NULL,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
      response_status INTEGER,
      response_body JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
      PRIMARY KEY (user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_requests_expiry ON idempotency_requests(expires_at);
  `);
}
