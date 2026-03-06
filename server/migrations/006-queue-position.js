export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS queue_position INTEGER DEFAULT NULL
  `);
}
