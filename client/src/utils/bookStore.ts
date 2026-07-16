// ---------------------------------------------------------------------------
// utils/bookStore.ts -- On-device book library (IndexedDB).
//
// EPUB bytes are too large for localStorage (~5MB cap), so books live in
// IndexedDB. Light metadata + cover are in the `books` store (for a fast
// library grid); EPUB bytes or compact comic documents are in `data`; reading position in
// `progress`. Per-device only — no server sync.
// ---------------------------------------------------------------------------

import type { ComicDocument, ComicOcrProgress } from './cbz';
import type { ComicTextLine } from './comicPrototypeManifest';

const DB_NAME = 'polycast-books';
const DB_VERSION = 2;

export type BookFormat = 'epub' | 'comic';

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  cover: Blob | null;
  addedAt: number;
  format?: BookFormat;
  pageCount?: number;
  language?: 'en' | 'es';
  notice?: string;
  ocr?: ComicOcrProgress;
  source?: 'personal' | 'class';
  classBookId?: string;
  classroomId?: string;
  classroomName?: string;
  originalFilename?: string;
}

export interface BookProgress {
  bookId: string;
  chapterIndex: number;
  pageIndex: number;
}

export type StoredBookData =
  | { id: string; format?: 'epub'; bytes: Uint8Array }
  | { id: string; format: 'comic'; comic: ComicDocument };

export interface ComicPageRecord {
  id: string;
  bookId: string;
  pageIndex: number;
  entryName: string;
  width: number;
  height: number;
  lines: ComicTextLine[];
  recognizedText: string;
  meanConfidence: number | null;
  completedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bookId' });
      if (!db.objectStoreNames.contains('comicPages')) {
        const pages = db.createObjectStore('comicPages', { keyPath: 'id' });
        pages.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export function listBooks(): Promise<BookMeta[]> {
  return tx<BookMeta[]>('books', 'readonly', (s) => s.getAll() as IDBRequest<BookMeta[]>)
    .then((books) => books.sort((a, b) => b.addedAt - a.addedAt));
}

export function getBookMeta(id: string): Promise<BookMeta | null> {
  return tx<BookMeta | undefined>('books', 'readonly', (s) => s.get(id))
    .then((book) => book ?? null);
}

export function getBookData(id: string): Promise<Uint8Array | null> {
  return getStoredBook(id).then((row) => (row && row.format !== 'comic' ? row.bytes : null));
}

export function getStoredBook(id: string): Promise<StoredBookData | null> {
  return tx<StoredBookData | undefined>('data', 'readonly', (s) => s.get(id))
    .then((row) => row ?? null);
}

export async function addBook(meta: BookMeta, data: Uint8Array | ComicDocument): Promise<void> {
  const row: StoredBookData = data instanceof Uint8Array
    ? { id: meta.id, format: 'epub', bytes: data }
    : { id: meta.id, format: 'comic', comic: data };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['books', 'data'], 'readwrite');
    transaction.objectStore('books').put(meta);
    transaction.objectStore('data').put(row);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Book import transaction was aborted.')); };
  });
}

export async function updateBookMeta(id: string, patch: Partial<BookMeta>): Promise<BookMeta> {
  const current = await tx<BookMeta | undefined>('books', 'readonly', (s) => s.get(id));
  if (!current) throw new Error(`[book_meta_missing] Book metadata no longer exists for ${id}.`);
  const next = { ...current, ...patch, id: current.id };
  await tx('books', 'readwrite', (s) => s.put(next));
  return next;
}

export function putComicPageResult(result: ComicPageRecord): Promise<void> {
  return tx('comicPages', 'readwrite', (s) => s.put(result)).then(() => undefined);
}

export function getComicPageResult(bookId: string, pageIndex: number): Promise<ComicPageRecord | null> {
  return tx<ComicPageRecord | undefined>('comicPages', 'readonly', (s) => s.get(`${bookId}:${pageIndex}`))
    .then((result) => result ?? null);
}

function deleteComicPages(bookId: string): Promise<void> {
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('comicPages', 'readwrite');
    const store = transaction.objectStore('comicPages');
    const request = store.index('bookId').openKeyCursor(IDBKeyRange.only(bookId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  }));
}

export async function deleteBook(id: string): Promise<void> {
  await tx('books', 'readwrite', (s) => s.delete(id));
  await tx('data', 'readwrite', (s) => s.delete(id));
  await tx('progress', 'readwrite', (s) => s.delete(id));
  await deleteComicPages(id);
}

export function getProgress(bookId: string): Promise<BookProgress | null> {
  return tx<BookProgress | undefined>('progress', 'readonly', (s) => s.get(bookId))
    .then((p) => p ?? null);
}

export function setProgress(progress: BookProgress): Promise<void> {
  return tx('progress', 'readwrite', (s) => s.put(progress)).then(() => undefined);
}
