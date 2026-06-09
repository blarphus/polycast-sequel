/**
 * 022-reset-word-tts-audio — the cached per-word TTS clip (saved_words.tts_audio)
 * used to be the full example sentence, which made flashcard fronts and the word
 * popup read out the whole sentence instead of the word. The audio route now
 * synthesizes just the word, so clear the stale sentence clips; they regenerate
 * lazily (as the word) on next playback.
 */
export async function up(client) {
  await client.query(`UPDATE saved_words SET tts_audio = NULL WHERE tts_audio IS NOT NULL;`);
}
