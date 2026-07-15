import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.usebooks');
// ---------------------------------------------------------------------------
// hooks/useBooks.ts -- Manage the on-device EPUB + resumable CBZ OCR library.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { listBooks, addBook, deleteBook, type BookMeta } from '../utils/bookStore';
import { parseEpub, coverBlob } from '../utils/epub';
import { prepareCbzForOcr } from '../utils/cbz';
import {
  cancelComicOcr,
  COMIC_OCR_PROGRESS_EVENT,
  resumePendingComicOcr,
  retryComicOcr,
  startComicOcr,
  type ComicOcrProgressEvent,
} from '../utils/comicOcr';

export interface BookImportResult {
  id: string;
  format: 'epub' | 'comic';
  processing: boolean;
}

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

  useEffect(() => {
    void refresh().then(() => resumePendingComicOcr()).catch((err) => {
      runtimeLog.error('Failed to resume queued comic OCR:', err);
    });
  }, [refresh]);

  useEffect(() => {
    const handleProgress = (event: Event) => {
      const detail = (event as CustomEvent<ComicOcrProgressEvent>).detail;
      if (!detail) return;
      setBooks((current) => current.map((book) => (
        book.id === detail.bookId ? { ...book, ocr: detail.progress } : book
      )));
    };
    window.addEventListener(COMIC_OCR_PROGRESS_EVENT, handleProgress);
    return () => window.removeEventListener(COMIC_OCR_PROGRESS_EVENT, handleProgress);
  }, []);

  /** Parse + store an uploaded EPUB or supported CBZ. Returns the new book id. */
  const addFromFile = useCallback(async (file: File, comicLanguage?: 'en' | 'es'): Promise<BookImportResult> => {
    const id = `${Date.now()}-${Math.round(performance.now())}`;
    if (file.name.toLowerCase().endsWith('.cbz')) {
      if (!comicLanguage) {
        throw new Error('[cbz_ocr_language_required] Choose the language printed in this comic before uploading it.');
      }
      const { comic, cover } = await prepareCbzForOcr(file, comicLanguage);
      const meta: BookMeta = {
        id,
        title: comic.title,
        author: comic.author,
        cover,
        addedAt: Date.now(),
        format: 'comic',
        pageCount: comic.pages.length,
        language: comicLanguage,
        ocr: comic.ocr,
      };
      try {
        await addBook(meta, comic);
      } catch (error) {
        throw new Error(`[cbz_storage_failed] Polycast could not store this CBZ on the device: ${error instanceof Error ? error.message : String(error)}`);
      }
      await refresh();
      startComicOcr(id);
      return { id, format: 'comic', processing: true };
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
    return { id, format: 'epub', processing: false };
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    cancelComicOcr(id);
    await deleteBook(id);
    await refresh();
  }, [refresh]);

  const retryOcr = useCallback(async (id: string) => {
    await retryComicOcr(id);
  }, []);

  return { books, loading, error, refresh, addFromFile, remove, retryOcr };
}
