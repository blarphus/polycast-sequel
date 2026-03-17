export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ios_voip_devices (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token     TEXT NOT NULL UNIQUE,
      apns_environment VARCHAR(20) NOT NULL DEFAULT 'production',
      bundle_id        TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ios_voip_devices_user_id
      ON ios_voip_devices (user_id, apns_environment, updated_at DESC);
  `);
}
