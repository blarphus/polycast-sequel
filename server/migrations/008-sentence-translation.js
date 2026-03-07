/**
 * 008-sentence-translation — Add sentence_translation column for native-language
 * translations of example sentences (shown on flashcard backs).
 */
export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS sentence_translation TEXT;
  `);

  await client.query(`
    ALTER TABLE stream_post_words
      ADD COLUMN IF NOT EXISTS sentence_translation TEXT;
  `);
}
