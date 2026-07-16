/**
 * 040-classroom-books — durable class-owned EPUB/CBZ metadata.
 *
 * The large archive bytes live on the service's persistent disk. PostgreSQL
 * stores ownership and access metadata so one shared file can be exposed to
 * every current classroom member without duplicating it per student.
 */

export async function up(client) {
  await client.query(`
    CREATE TABLE classroom_books (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      classroom_id      UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      uploaded_by       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      title             TEXT NOT NULL,
      author            TEXT,
      original_filename TEXT NOT NULL,
      format            VARCHAR(8) NOT NULL CHECK (format IN ('epub', 'cbz', 'pdf')),
      mime_type         TEXT NOT NULL,
      byte_size         BIGINT NOT NULL CHECK (byte_size > 0),
      storage_key       TEXT NOT NULL UNIQUE,
      language          VARCHAR(8),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_classroom_books_classroom_created
      ON classroom_books (classroom_id, created_at DESC);
  `);
}
