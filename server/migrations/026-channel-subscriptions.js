export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS channel_subscriptions (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lang       VARCHAR(10) NOT NULL,
      handle     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, lang, handle)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_user_lang
      ON channel_subscriptions (user_id, lang);
  `);
}
