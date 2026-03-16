export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS prompt_stage INTEGER NOT NULL DEFAULT 0
  `);
}
