import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addUserLibraryBook, getLibraryBookProgress, listUserLibraryBooks, setLibraryBookProgress,
} from '../services/userLibraryBookService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const bookId = '22222222-2222-4222-8222-222222222222';

test('personal EPUB upload is owned by the authenticated profile and stored once', async () => {
  let promoted;
  const db = {
    async query(sql, values) {
      assert.match(sql, /INSERT INTO user_library_books/);
      assert.equal(values[1], userId);
      return { rows: [{
        id: values[0], owner_user_id: values[1], title: values[2], author: values[3],
        original_filename: values[4], format: 'epub', mime_type: 'application/epub+zip',
        byte_size: values[5], storage_key: values[6], language: values[7], created_at: new Date().toISOString(),
      }] };
    },
  };
  const result = await addUserLibraryBook({
    userId, file: { path: '/tmp/upload', originalname: 'novel.epub', size: 4096 },
    title: 'Novel', author: 'Writer', language: 'es',
  }, {
    db, inspectZip: async () => true,
    promoteUpload: async (from, key) => { promoted = { from, key }; },
    removeStored: async () => assert.fail('successful upload must remain stored'),
  });
  assert.equal(result.source, 'personal');
  assert.equal(result.byte_size, 4096);
  assert.equal(promoted.from, '/tmp/upload');
  assert.match(promoted.key, /^[a-f0-9-]+\.epub$/);
});

test('personal library listing is strictly scoped to one profile', async () => {
  let values;
  await listUserLibraryBooks(userId, { db: { query: async (_sql, params) => { values = params; return { rows: [] }; } } });
  assert.deepEqual(values, [userId]);
});

test('reading progress is keyed by profile, book, and source', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/SELECT \* FROM user_library_books/.test(sql)) {
        return { rows: [{
          id: bookId, title: 'Novel', author: null, original_filename: 'novel.epub',
          format: 'epub', mime_type: 'application/epub+zip', byte_size: 10,
          storage_key: `${bookId}.epub`, language: 'es', created_at: new Date().toISOString(),
        }] };
      }
      if (/INSERT INTO library_book_progress/.test(sql)) return { rows: [{ chapter_index: 3, page_index: 7 }] };
      return { rows: [{ chapter_index: 3, page_index: 7 }] };
    },
  };
  const saved = await setLibraryBookProgress(bookId, 'personal', userId, 3, 7, { db });
  const loaded = await getLibraryBookProgress(bookId, 'personal', userId, { db });
  assert.deepEqual(saved, { chapter_index: 3, page_index: 7 });
  assert.deepEqual(loaded, { chapter_index: 3, page_index: 7 });
  const writes = calls.filter(({ sql }) => /INSERT INTO library_book_progress/.test(sql));
  assert.deepEqual(writes[0].values, [userId, bookId, 'personal', 3, 7]);
});
