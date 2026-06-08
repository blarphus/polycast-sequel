// ---------------------------------------------------------------------------
// utils/bookStore.ts -- On-device EPUB library (IndexedDB).
//
// EPUB bytes are too large for localStorage (~5MB cap), so books live in
// IndexedDB. Light metadata + cover are in the `books` store (for a fast
// library grid); the raw epub bytes are in `data`; reading position in
// `progress`. Per-device only — no server sync.
// ---------------------------------------------------------------------------

const DB_NAME = 'polycast-books';
const DB_VERSION = 1;

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  cover: Blob | null;
  addedAt: number;
}

export interface BookProgress {
  bookId: string;
  chapterIndex: number;
  pageIndex: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bookId' });
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

export function getBookData(id: string): Promise<Uint8Array | null> {
  return tx<{ id: string; bytes: Uint8Array } | undefined>('data', 'readonly', (s) => s.get(id))
    .then((row) => row?.bytes ?? null);
}

export async function addBook(meta: BookMeta, bytes: Uint8Array): Promise<void> {
  await tx('books', 'readwrite', (s) => s.put(meta));
  await tx('data', 'readwrite', (s) => s.put({ id: meta.id, bytes }));
}

export async function deleteBook(id: string): Promise<void> {
  await tx('books', 'readwrite', (s) => s.delete(id));
  await tx('data', 'readwrite', (s) => s.delete(id));
  await tx('progress', 'readwrite', (s) => s.delete(id));
}

export function getProgress(bookId: string): Promise<BookProgress | null> {
  return tx<BookProgress | undefined>('progress', 'readonly', (s) => s.get(bookId))
    .then((p) => p ?? null);
}

export function setProgress(progress: BookProgress): Promise<void> {
  return tx('progress', 'readwrite', (s) => s.put(progress)).then(() => undefined);
}
