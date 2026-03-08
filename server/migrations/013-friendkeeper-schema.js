export async function up(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS friendkeeper`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS friendkeeper.contacts (
      id                        TEXT PRIMARY KEY,
      first_name                TEXT,
      last_name                 TEXT,
      display_name              TEXT,
      phone_numbers             JSONB DEFAULT '[]',
      email_addresses           JSONB DEFAULT '[]',
      thumbnail_image_data      TEXT,
      last_communication_date   TIMESTAMPTZ,
      last_communication_type   TEXT,
      last_outgoing_contact_date TIMESTAMPTZ,
      total_message_count       INTEGER DEFAULT 0,
      total_call_count          INTEGER DEFAULT 0,
      total_facetime_count      INTEGER DEFAULT 0,
      total_whatsapp_count      INTEGER DEFAULT 0,
      total_whatsapp_call_count INTEGER DEFAULT 0,
      updated_at                TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS friendkeeper.communication_events (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id TEXT NOT NULL REFERENCES friendkeeper.contacts(id) ON DELETE CASCADE,
      date       TIMESTAMPTZ NOT NULL,
      type       TEXT NOT NULL,
      is_from_me BOOLEAN NOT NULL DEFAULT FALSE,
      duration   REAL,
      preview    TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS fk_events_contact_id_idx
      ON friendkeeper.communication_events (contact_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS fk_events_date_idx
      ON friendkeeper.communication_events (date DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS friendkeeper.sync_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}
