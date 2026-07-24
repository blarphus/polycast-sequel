import crypto from 'node:crypto';
import pool from '../db.js';
import { NotFoundError, ValidationError } from '../lib/httpErrors.js';
import {
  createStorageKey, isZipArchive, promoteClassBookUpload, removeStoredClassBook,
  removeTemporaryClassBook, storedBookPath,
} from './classBookStorage.js';
import { getAccessibleClassBook } from './classBookService.js';

function mapBook(row) {
  return {
    id: row.id, title: row.title, author: row.author,
    original_filename: row.original_filename, format: row.format,
    mime_type: row.mime_type, byte_size: Number(row.byte_size),
    language: row.language, created_at: row.created_at, source: 'personal',
  };
}

export async function listUserLibraryBooks(userId, { db = pool } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM user_library_books WHERE owner_user_id = $1 ORDER BY created_at DESC', [userId],
  );
  return rows.map(mapBook);
}

export async function addUserLibraryBook({ userId, file, title, author, language }, {
  db = pool, promoteUpload = promoteClassBookUpload,
  removeStored = removeStoredClassBook, inspectZip = isZipArchive,
} = {}) {
  if (!file?.path || !file?.originalname || !file?.size) {
    throw new ValidationError([{ path: 'body.book', message: 'Choose an EPUB file' }]);
  }
  const extension = file.originalname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension !== 'epub') {
    throw new ValidationError([{ path: 'body.book', message: 'Personal cloud storage accepts EPUB files; CBZ comics stay on the importing device' }]);
  }
  if (!await inspectZip(file.path)) {
    throw new ValidationError([{ path: 'body.book', message: 'The uploaded file is not a valid ZIP-based EPUB or CBZ archive' }]);
  }
  const id = crypto.randomUUID();
  const storageKey = createStorageKey(id, extension);
  const mimeType = 'application/epub+zip';
  let promoted = false;
  try {
    await promoteUpload(file.path, storageKey);
    promoted = true;
    const { rows } = await db.query(
      `INSERT INTO user_library_books (
         id, owner_user_id, title, author, original_filename, format,
         mime_type, byte_size, storage_key, language
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id, userId, title.trim(), author?.trim() || null, file.originalname,
        extension, mimeType, file.size, storageKey, language || null,
      ],
    );
    return mapBook(rows[0]);
  } catch (error) {
    if (promoted) await removeStored(storageKey, { ignoreMissing: true });
    else await removeTemporaryClassBook(file.path);
    throw error;
  }
}

export async function getUserLibraryBook(bookId, userId, { db = pool } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM user_library_books WHERE id = $1 AND owner_user_id = $2', [bookId, userId],
  );
  if (!rows[0]) throw new NotFoundError('Book not found', { code: 'library_book_not_found' });
  return { ...mapBook(rows[0]), storage_path: storedBookPath(rows[0].storage_key) };
}

export async function deleteUserLibraryBook(bookId, userId, {
  db = pool, removeStored = removeStoredClassBook,
} = {}) {
  const { rows } = await db.query(
    'DELETE FROM user_library_books WHERE id = $1 AND owner_user_id = $2 RETURNING storage_key', [bookId, userId],
  );
  if (!rows[0]) throw new NotFoundError('Book not found', { code: 'library_book_not_found' });
  await db.query("DELETE FROM library_book_progress WHERE user_id = $1 AND book_id = $2 AND source = 'personal'", [userId, bookId]);
  await removeStored(rows[0].storage_key, { ignoreMissing: true });
}

async function requireBookAccess(bookId, source, userId, db) {
  if (source === 'personal') await getUserLibraryBook(bookId, userId, { db });
  else await getAccessibleClassBook(bookId, userId, { db });
}

export async function getLibraryBookProgress(bookId, source, userId, { db = pool } = {}) {
  await requireBookAccess(bookId, source, userId, db);
  const { rows } = await db.query(
    'SELECT chapter_index, page_index FROM library_book_progress WHERE user_id = $1 AND book_id = $2 AND source = $3',
    [userId, bookId, source],
  );
  return rows[0] || null;
}

export async function setLibraryBookProgress(bookId, source, userId, chapterIndex, pageIndex, { db = pool } = {}) {
  await requireBookAccess(bookId, source, userId, db);
  const { rows } = await db.query(
    `INSERT INTO library_book_progress (user_id, book_id, source, chapter_index, page_index)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, book_id, source) DO UPDATE SET
       chapter_index = EXCLUDED.chapter_index, page_index = EXCLUDED.page_index, updated_at = NOW()
     RETURNING chapter_index, page_index`,
    [userId, bookId, source, chapterIndex, pageIndex],
  );
  return rows[0];
}
