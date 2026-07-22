import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.hooks.usebooks');
// ---------------------------------------------------------------------------
// hooks/useBooks.ts -- Manage profile books plus resumable local CBZ OCR caches.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { listBooks, addBook, deleteBook, getStoredBook, updateBookMeta, type BookMeta } from '../utils/bookStore';
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
      const legacyEpubs = localBooks.filter((book) => book.format === 'epub' && book.source !== 'class');
      for (const legacy of legacyEpubs) {
        try {
          const stored = await getStoredBook(legacy.id);
          if (!stored || stored.format === 'comic') continue;
          const file = new File(
            [stored.bytes as BlobPart],
            legacy.originalFilename || `${legacy.title}.epub`,
            { type: 'application/epub+zip' },
          );
          await uploadUserLibraryBook(file, {
            title: legacy.title, author: legacy.author, language: legacy.language,
          });
          await deleteBook(legacy.id);
        } catch (err) {
          emitFallbackDiagnostic({
            code: 'legacy_epub_cloud_migration_failed',
            severity: 'warning',
            title: 'Book still stored on this device',
            message: `“${legacy.title}” could not be moved to your profile library yet.`,
            detail: err instanceof Error ? err.message : String(err),
          }, { source: 'web.library', operation: 'migrate-legacy-epub' });
        }
      }
      const legacyComics = localBooks.filter((book) => (
        book.format === 'comic' && book.source !== 'class' && book.source !== 'server'
      ));
      for (const legacy of legacyComics) {
        let uploadedId: string | null = null;
        try {
          const stored = await getStoredBook(legacy.id);
          if (!stored || stored.format !== 'comic' || !stored.comic.archive) continue;
          const language = legacy.language || stored.comic.language;
          if (language !== 'en' && language !== 'es') {
            throw new Error('[legacy_cbz_language_missing] Choose English or Spanish before this comic can move to your profile.');
          }
          const file = new File(
            [stored.comic.archive],
            legacy.originalFilename || stored.comic.sourceFileName || `${legacy.title}.cbz`,
            { type: 'application/vnd.comicbook+zip' },
          );
          const uploaded = await uploadUserLibraryBook(file, {
            title: legacy.title, author: legacy.author, language,
          });
          uploadedId = uploaded.id;
          const { comic, cover } = await prepareCbzForOcr(file, language);
          await addBook({
            ...legacy,
            id: uploaded.id,
            cover,
            addedAt: new Date(uploaded.created_at).getTime(),
            source: 'server',
            serverBookId: uploaded.id,
            originalFilename: uploaded.original_filename,
            byteSize: uploaded.byte_size,
            ocr: comic.ocr,
            pageCount: comic.pages.length,
          }, comic);
          await deleteBook(legacy.id);
          startComicOcr(uploaded.id);
        } catch (err) {
          if (uploadedId) {
            try {
              await deleteBook(legacy.id);
            } catch (cleanupError) {
              try {
                await updateBookMeta(legacy.id, { source: 'server', serverBookId: uploadedId });
              } catch (markError) {
                emitFallbackDiagnostic({
                  code: 'legacy_cbz_migration_cleanup_failed', severity: 'warning',
                  title: 'Old comic cache could not be marked',
                  message: 'The CBZ is safely in your profile, but this browser may try to migrate its old cache again.',
                  detail: `cleanup=${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}; mark=${markError instanceof Error ? markError.message : String(markError)}`,
                }, { source: 'web.library', operation: 'finalize-legacy-cbz-migration' });
              }
            }
          }
          emitFallbackDiagnostic({
            code: 'legacy_cbz_cloud_migration_failed',
            severity: 'warning',
            title: uploadedId ? 'Comic uploaded; OCR cache unavailable' : 'Comic still stored on this device',
            message: uploadedId
              ? `“${legacy.title}” is in your profile library, but its browser OCR cache could not be prepared.`
              : `“${legacy.title}” could not be moved to your profile library yet.`,
            detail: err instanceof Error ? err.message : String(err),
          }, { source: 'web.library', operation: 'migrate-legacy-cbz' });
        }
      }
      const cachedClassEpubs = localBooks.filter((book) => book.format === 'epub' && book.source === 'class');
      await Promise.all(cachedClassEpubs.map((book) => deleteBook(book.id)));
      if (legacyEpubs.length || legacyComics.length || cachedClassEpubs.length) {
        localBooks = await listBooks();
        serverBooks = await getUserLibraryBooks();
      }
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
      setBooks([...remote, ...visibleLocal]
        .sort((a, b) => b.addedAt - a.addedAt));
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
      const uploaded = await uploadUserLibraryBook(file, {
        title: comic.title,
        author: comic.author,
        language: comicLanguage,
      });
      const meta: BookMeta = {
        id: uploaded.id,
        title: comic.title,
        author: comic.author,
        cover,
        addedAt: new Date(uploaded.created_at).getTime(),
        format: 'comic',
        pageCount: comic.pages.length,
        language: comicLanguage,
        ocr: comic.ocr,
        source: 'server',
        serverBookId: uploaded.id,
        originalFilename: uploaded.original_filename,
        byteSize: uploaded.byte_size,
      };
      try {
        await addBook(meta, comic);
      } catch (error) {
        emitFallbackDiagnostic({
          code: 'cbz_ocr_cache_failed',
          severity: 'warning',
          title: 'Comic uploaded; OCR cache unavailable',
          message: `“${comic.title}” is saved to your profile, but this browser could not prepare its text cache.`,
          detail: error instanceof Error ? error.message : String(error),
        }, { source: 'web.library', operation: 'cache-profile-cbz-for-ocr' });
        await refresh();
        return { id: uploaded.id, format: 'comic', processing: false };
      }
      await refresh();
      startComicOcr(uploaded.id);
      return { id: uploaded.id, format: 'comic', processing: true };
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
