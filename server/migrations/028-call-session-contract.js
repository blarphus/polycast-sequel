/**
 * 028-call-session-contract — Track call sessions from ringing through end.
 */
export async function up(client) {
  await client.query(`
    ALTER TABLE calls
      ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'video',
      ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ended_reason VARCHAR(40);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_calls_active_participants
      ON calls (caller_id, callee_id, status)
      WHERE ended_at IS NULL AND status IN ('ringing', 'active');
  `);
}
