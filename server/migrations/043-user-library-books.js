/** Durable profile-owned EPUBs and per-profile reading positions. */
export async function up(client) {
  await client.query(`
    CREATE TABLE user_library_books (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      author TEXT,
      original_filename TEXT NOT NULL,
      format VARCHAR(8) NOT NULL CHECK (format = 'epub'),
      mime_type TEXT NOT NULL,
      byte_size BIGINT NOT NULL CHECK (byte_size > 0),
      storage_key TEXT NOT NULL UNIQUE,
      language VARCHAR(8),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_user_library_books_owner_created
      ON user_library_books (owner_user_id, created_at DESC);

    CREATE TABLE library_book_progress (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id UUID NOT NULL,
      source VARCHAR(12) NOT NULL CHECK (source IN ('personal', 'class')),
      chapter_index INTEGER NOT NULL DEFAULT 0 CHECK (chapter_index >= 0),
      page_index INTEGER NOT NULL DEFAULT 0 CHECK (page_index >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, book_id, source)
    );
  `);
}
