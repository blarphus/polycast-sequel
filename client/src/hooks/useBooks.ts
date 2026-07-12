import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.usebooks');
// ---------------------------------------------------------------------------
// hooks/useBooks.ts -- Manage the on-device EPUB library.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { listBooks, addBook, deleteBook, type BookMeta } from '../utils/bookStore';
import { parseEpub, coverBlob } from '../utils/epub';

export function useBooks() {
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
      setError('');
    } catch (err) {
      runtimeLog.error('Failed to load books:', err);
      setError('Could not open your book library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Parse + store an uploaded .epub file. Returns the new book id. */
  const addFromFile = useCallback(async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseEpub(bytes); // throws on invalid epub — surfaced to caller
    const id = `${Date.now()}-${Math.round(performance.now())}`;
    const meta: BookMeta = {
      id,
      title: parsed.title,
      author: parsed.author,
      cover: coverBlob(parsed),
      addedAt: Date.now(),
    };
    await addBook(meta, bytes);
    await refresh();
    return id;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteBook(id);
    await refresh();
  }, [refresh]);

  return { books, loading, error, refresh, addFromFile, remove };
}
