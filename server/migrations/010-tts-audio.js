/**
 * 010-tts-audio — cache OpenAI TTS audio on saved_words
 */
export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words ADD COLUMN IF NOT EXISTS tts_audio BYTEA;
  `);
}
