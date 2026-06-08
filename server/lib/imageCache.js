import pool from '../db.js';

/**
 * Persist image bytes in the cached_images table and return the new row id.
 * The caller stores `/api/dictionary/image/<id>` as the word's image_url so the
 * flashcard serves our own copy and never depends on a third-party link.
 */
export async function storeImageBytes(buffer, contentType, sourceUrl = null) {
  const { rows } = await pool.query(
    `INSERT INTO cached_images (data, content_type, source_url)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [buffer, contentType, sourceUrl],
  );
  return rows[0].id;
}

/**
 * Fetch cached image bytes by id, or null if not found.
 */
export async function getImageBytes(id) {
  const { rows } = await pool.query(
    `SELECT data, content_type FROM cached_images WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}
