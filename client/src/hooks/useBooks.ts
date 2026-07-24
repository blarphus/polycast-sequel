import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.usebooks');
// ---------------------------------------------------------------------------
// hooks/useBooks.ts -- Manage cloud EPUBs and on-device CBZ comics.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { listBooks, addBook, deleteBook, getStoredBook, type BookMeta } from '../utils/bookStore';
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
import { downloadClassroomBook, type ClassBook } from '../api/classroom';
import {
  deleteUserLibraryBook,
  getUserLibraryBooks,
  uploadUserLibraryBook,
} from '../api/libraryBooks';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';

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
      let localBooks = await listBooks();
      let serverBooks = await getUserLibraryBooks();
      const publishBooks = () => {
        const localByServerId = new Map(
          localBooks
            .filter((book) => book.source === 'server')
            .map((book) => [book.serverBookId || book.id, book]),
        );
        const remote = serverBooks.map((book): BookMeta => ({
          ...(book.format === 'cbz' ? localByServerId.get(book.id) : undefined),
          id: book.id,
          title: book.title,
          author: book.author || '',
          cover: book.format === 'cbz' ? localByServerId.get(book.id)?.cover || null : null,
          addedAt: new Date(book.created_at).getTime(),
          format: book.format === 'cbz' ? 'comic' : 'epub',
          language: book.language || undefined,
          source: 'server',
          serverBookId: book.id,
          originalFilename: book.original_filename,
          byteSize: book.byte_size,
        }));
        const visibleLocal = localBooks.filter((book) => book.source !== 'server');
        setBooks([...remote, ...visibleLocal].sort((a, b) => b.addedAt - a.addedAt));
      };

      // Personal EPUBs are server-owned. Retain personal CBZs on this device;
      // older device-only EPUB entries are obsolete and can be removed.
      const legacyLocalBooks = localBooks.filter((book) => (
        book.source !== 'class' && book.source !== 'server'
        && book.format !== 'comic'
      ));
      for (const legacy of legacyLocalBooks) {
        try {
          await deleteBook(legacy.id);
        } catch (err) {
          emitFallbackDiagnostic({
            code: 'legacy_local_book_cleanup_failed',
            severity: 'warning',
            title: 'Local book could not be removed',
            message: `“${legacy.title}” is an obsolete device-only entry and could not be cleared from this browser.`,
            detail: err instanceof Error ? err.message : String(err),
          }, { source: 'web.library', operation: 'remove-legacy-local-book' });
        }
      }
      const cachedClassEpubs = localBooks.filter((book) => book.format === 'epub' && book.source === 'class');
      await Promise.all(cachedClassEpubs.map((book) => deleteBook(book.id)));
      if (legacyLocalBooks.length || cachedClassEpubs.length) {
        localBooks = await listBooks();
        serverBooks = await getUserLibraryBooks();
      }
      publishBooks();
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
    if (file.name.toLowerCase().endsWith('.cbz')) {
      if (!comicLanguage) {
        throw new Error('[cbz_ocr_language_required] Choose the language printed in this comic before uploading it.');
      }
      const { comic, cover } = await prepareCbzForOcr(file, comicLanguage);
      const id = globalThis.crypto.randomUUID();
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
        source: 'personal',
        originalFilename: file.name,
        byteSize: file.size,
      };
      await addBook(meta, comic);
      await refresh();
      startComicOcr(id);
      return { id, format: 'comic', processing: true };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseEpub(bytes); // throws on invalid epub — surfaced to caller
    const uploaded = await uploadUserLibraryBook(file, {
      title: parsed.title,
      author: parsed.author,
      language: parsed.language === 'en' || parsed.language === 'es' ? parsed.language : undefined,
    });
    await refresh();
    return { id: uploaded.id, format: 'epub', processing: false };
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    cancelComicOcr(id);
    const book = books.find((candidate) => candidate.id === id);
    if (book?.source === 'server') {
      await deleteUserLibraryBook(id);
      await deleteBook(id).catch((error) => {
        emitFallbackDiagnostic({
          code: 'cbz_local_cache_cleanup_failed', severity: 'warning',
          title: 'Book removed; browser cache remains',
          message: 'The profile book was deleted, but this browser could not clear its processing cache.',
          detail: error instanceof Error ? error.message : String(error),
        }, { source: 'web.library', operation: 'clear-deleted-book-cache' });
      });
    } else await deleteBook(id);
    await refresh();
  }, [books, refresh]);

  const retryOcr = useCallback(async (id: string) => {
    await retryComicOcr(id);
  }, []);

  const addFromClass = useCallback(async (
    classBook: ClassBook,
    onProgress?: (fraction: number) => void,
  ): Promise<BookImportResult> => {
    if (classBook.format === 'pdf') {
      throw new Error('[class_book_format_invalid] PDFs open from the classroom Documents tab rather than the book reader.');
    }
    const existing = await getStoredBook(classBook.id);
    if (existing) {
      return {
        id: classBook.id,
        format: existing.format === 'comic' ? 'comic' : 'epub',
        processing: existing.format === 'comic' && existing.comic.ocr?.status !== 'ready',
      };
    }

    const blob = await downloadClassroomBook(classBook, onProgress);
    const addedAt = new Date(classBook.created_at).getTime() || Date.now();
    const sourceMeta = {
      source: 'class' as const,
      classBookId: classBook.id,
      classroomId: classBook.classroom_id,
      classroomName: classBook.classroom_name,
      originalFilename: classBook.original_filename,
    };

    if (classBook.format === 'cbz') {
      if (!classBook.language) {
        throw new Error('[class_book_language_missing] This shared CBZ does not identify whether its text is English or Spanish.');
      }
      const file = new File([blob], classBook.original_filename, { type: classBook.mime_type });
      const { comic, cover } = await prepareCbzForOcr(file, classBook.language);
      const meta: BookMeta = {
        id: classBook.id,
        title: classBook.title || comic.title,
        author: classBook.author || comic.author,
        cover,
        addedAt,
        format: 'comic',
        pageCount: comic.pages.length,
        language: classBook.language,
        ocr: comic.ocr,
        ...sourceMeta,
      };
      await addBook(meta, comic);
      await refresh();
      startComicOcr(classBook.id);
      return { id: classBook.id, format: 'comic', processing: true };
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = parseEpub(bytes);
    const meta: BookMeta = {
      id: classBook.id,
      title: classBook.title || parsed.title,
      author: classBook.author || parsed.author,
      cover: coverBlob(parsed),
      addedAt,
      format: 'epub',
      language: classBook.language || (parsed.language === 'en' || parsed.language === 'es' ? parsed.language : undefined),
      ...sourceMeta,
    };
    await addBook(meta, bytes);
    await refresh();
    return { id: classBook.id, format: 'epub', processing: false };
  }, [refresh]);

  return { books, loading, error, refresh, addFromFile, addFromClass, remove, retryOcr };
}
