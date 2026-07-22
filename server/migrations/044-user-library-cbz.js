/** Allow profile-owned CBZ archives alongside EPUBs. */
export async function up(client) {
  await client.query(`
    ALTER TABLE user_library_books
      DROP CONSTRAINT user_library_books_format_check;
    ALTER TABLE user_library_books
      ADD CONSTRAINT user_library_books_format_check
      CHECK (format IN ('epub', 'cbz'));
  `);
}
