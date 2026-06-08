/**
 * 021-image-cache — store flashcard image bytes in our own table instead of
 * replaying third-party stock-photo links (Pixabay `/get/...` URLs are
 * temporary and rot over time, leaving blank flashcards). enrichWord now caches
 * the chosen image here and stores `/api/dictionary/image/<id>` as the word's
 * image_url, so the picture never depends on an upstream link again.
 */
export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cached_images (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data         BYTEA NOT NULL,
      content_type TEXT  NOT NULL,
      source_url   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
