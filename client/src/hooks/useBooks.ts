import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.usebooks');
// ---------------------------------------------------------------------------
// hooks/useBooks.ts -- Manage the on-device EPUB + prototype CBZ library.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { listBooks, addBook, deleteBook, type BookMeta } from '../utils/bookStore';
import { parseEpub, coverBlob } from '../utils/epub';
import { parseCbzPrototype } from '../utils/cbz';

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

  /** Parse + store an uploaded EPUB or supported CBZ. Returns the new book id. */
  const addFromFile = useCallback(async (file: File): Promise<string> => {
    const id = `${Date.now()}-${Math.round(performance.now())}`;
    if (file.name.toLowerCase().endsWith('.cbz')) {
      const comic = await parseCbzPrototype(file);
      const firstPage = comic.pages[0];
      const cover = new Blob([firstPage.image as BlobPart], { type: firstPage.mimeType });
      const meta: BookMeta = {
        id,
        title: comic.title,
        author: comic.author,
        cover,
        addedAt: Date.now(),
        format: 'comic',
        pageCount: comic.pages.length,
        notice: comic.prototypeNotice,
      };
      await addBook(meta, comic);
      await refresh();
      return id;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseEpub(bytes); // throws on invalid epub — surfaced to caller
    const meta: BookMeta = {
      id,
      title: parsed.title,
      author: parsed.author,
      cover: coverBlob(parsed),
      addedAt: Date.now(),
      format: 'epub',
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
