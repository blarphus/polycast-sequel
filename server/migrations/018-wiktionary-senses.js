export async function up(client) {
  await client.query(`
    CREATE TABLE wiktionary (
      id     SERIAL PRIMARY KEY,
      lang   VARCHAR(2)  NOT NULL,
      key    TEXT        NOT NULL,
      word   TEXT        NOT NULL,
      pos    VARCHAR(20) NOT NULL,
      senses JSONB       NOT NULL,
      forms  TEXT[],
      translations JSONB
    )
  `);
  await client.query(`
    CREATE INDEX idx_wiktionary_lookup ON wiktionary (lang, key)
  `);
}
