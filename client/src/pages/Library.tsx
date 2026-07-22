import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.library');
// ---------------------------------------------------------------------------
// pages/Library.tsx -- EPUB + full, on-device CBZ OCR library.
// ---------------------------------------------------------------------------

import '../styles/epub.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooks } from '../hooks/useBooks';
import type { BookMeta } from '../utils/bookStore';
import { BookOpenIcon, PlusIcon, TrashIcon } from '../components/icons';
import { getClassBooks, type ClassBook } from '../api/classroom';

interface LibraryEntry {
  book: BookMeta;
  classBook: ClassBook | null;
  downloaded: boolean;
}

function formatEta(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `about ${hours}h${remainder ? ` ${remainder}m` : ''}`;
}

function languageLabel(language: string | undefined) {
  if (language === 'en') return 'English';
  if (language === 'es') return 'Spanish';
  return null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function BookCard({ book, classBook, downloaded, downloadProgress, onOpen, onDelete, onRetryOcr }: {
  book: BookMeta;
  classBook: ClassBook | null;
  downloaded: boolean;
  downloadProgress?: number;
  onOpen: () => void;
  onDelete?: () => void;
  onRetryOcr: () => void;
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const ocr = book.ocr;
  const processing = !!ocr && ocr.status !== 'ready' && ocr.status !== 'error';

  useEffect(() => {
    if (!book.cover) return;
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [book.cover]);

  return (
    <div className={`epub-card${processing ? ' epub-card--processing' : ''}${ocr?.status === 'error' ? ' epub-card--ocr-error' : ''}`} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className={`epub-card-cover${processing ? ' epub-card-cover--processing' : ''}`}>
        {coverUrl
          ? <img src={coverUrl} alt={book.title} loading="lazy" />
          : <div className="epub-card-cover--placeholder"><BookOpenIcon size={32} /><span>{book.title}</span></div>}
      </div>
      <div className="epub-card-meta">
        <div className="epub-card-title" title={book.title}>{book.title}</div>
        <div className="epub-card-author" title={book.author}>{book.author}</div>
        {classBook && (
          <div className="epub-card-class-source">
            <span>From {classBook.classroom_name}</span>
            <span>{formatBytes(classBook.byte_size)}{downloaded ? ' · downloaded' : ' · online'}</span>
          </div>
        )}
        {book.format === 'comic' && (
          <div className="epub-card-format">
            CBZ · {book.pageCount ?? 0} pages
            {languageLabel(book.language) ? ` · ${languageLabel(book.language)}` : ''}
            {ocr?.status === 'ready' ? ' · text ready' : ''}
          </div>
        )}
        {ocr && ocr.status !== 'ready' && ocr.status !== 'error' && (
          <div className="comic-ocr-card-status" aria-live="polite">
            <div className="comic-ocr-card-label">
              <strong>Completed page {ocr.processedPages}/{ocr.totalPages}</strong>
              <span>{Math.round(ocr.overallProgress * 100)}%</span>
            </div>
            <div
              className="comic-ocr-progress-track"
              role="progressbar"
              aria-label={`Comic OCR: completed page ${ocr.processedPages} of ${ocr.totalPages}`}
              aria-valuemin={0}
              aria-valuemax={ocr.totalPages}
              aria-valuenow={ocr.processedPages + ocr.pageProgress}
            >
              <span style={{ width: `${Math.max(1, ocr.overallProgress * 100)}%` }} />
            </div>
            <div className="comic-ocr-card-stage">{ocr.stage}</div>
            {formatEta(ocr.estimatedSecondsRemaining) && (
              <div className="comic-ocr-card-eta">Estimated remaining: {formatEta(ocr.estimatedSecondsRemaining)}</div>
            )}
          </div>
        )}
        {ocr?.status === 'error' && (
          <div className="comic-ocr-card-error" role="alert">
            <strong>[{ocr.diagnosticCode || 'cbz_ocr_failed'}]</strong>
            <span>{ocr.diagnosticMessage}</span>
            {ocr.diagnosticDetail && <small>{ocr.diagnosticDetail}</small>}
            <button type="button" onClick={(event) => { event.stopPropagation(); onRetryOcr(); }}>Retry OCR</button>
          </div>
        )}
        {downloadProgress !== undefined && (
          <div className="comic-ocr-card-status" aria-live="polite">
            <div className="comic-ocr-card-label">
              <strong>Downloading from class</strong>
              <span>{Math.round(downloadProgress * 100)}%</span>
            </div>
            <div
              className="comic-ocr-progress-track"
              role="progressbar"
              aria-label={`Downloading ${book.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(downloadProgress * 100)}
            >
              <span style={{ width: `${Math.max(1, downloadProgress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      {onDelete && (
        <button
          className="epub-card-delete"
          title="Remove book"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <TrashIcon size={16} />
        </button>
      )}
    </div>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const { books, loading, error, addFromFile, addFromClass, remove, retryOcr } = useBooks();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comicLanguage, setComicLanguage] = useState<'en' | 'es'>('en');
  const [classBooks, setClassBooks] = useState<ClassBook[]>([]);
  const [classBooksLoading, setClassBooksLoading] = useState(true);
  const [classBooksError, setClassBooksError] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void getClassBooks()
      .then((shared) => {
        if (cancelled) return;
        setClassBooks(shared);
        setClassBooksError('');
      })
      .catch((err) => {
        if (cancelled) return;
        runtimeLog.error('Failed to load class books:', err);
        setClassBooksError(err instanceof Error ? err.message : 'Could not load books shared by your classes.');
      })
      .finally(() => { if (!cancelled) setClassBooksLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const entries = useMemo<LibraryEntry[]>(() => {
    const localById = new Map(books.map((book) => [book.id, book]));
    const sharedEntries = classBooks.filter((shared) => shared.format !== 'pdf').map((shared): LibraryEntry => {
      const local = localById.get(shared.id);
      return {
        classBook: shared,
        downloaded: !!local,
        book: local || {
          id: shared.id,
          title: shared.title,
          author: shared.author || '',
          cover: null,
          addedAt: new Date(shared.created_at).getTime(),
          format: shared.format === 'cbz' ? 'comic' : 'epub',
          language: shared.language || undefined,
          pageCount: undefined,
          source: 'class',
          classBookId: shared.id,
          classroomId: shared.classroom_id,
          classroomName: shared.classroom_name,
          originalFilename: shared.original_filename,
        },
      };
    });
    const personalEntries = books
      .filter((book) => !book.classBookId)
      .map((book): LibraryEntry => ({ book, classBook: null, downloaded: true }));
    return [...sharedEntries, ...personalEntries].sort((a, b) => b.book.addedAt - a.book.addedAt);
  }, [books, classBooks]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    setUploadError('');
    try {
      let lastImport: Awaited<ReturnType<typeof addFromFile>> | null = null;
      for (const file of Array.from(files)) {
        lastImport = await addFromFile(
          file,
          file.name.toLowerCase().endsWith('.cbz') ? comicLanguage : undefined,
        );
      }
      if (files.length === 1 && lastImport && !lastImport.processing) {
        navigate(`/books/${lastImport.id}?source=${lastImport.format === 'epub' ? 'personal' : 'device'}`);
      }
    } catch (err) {
      runtimeLog.error('Failed to import book:', err);
      setUploadError(err instanceof Error ? err.message : 'Could not import that book.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleDelete = async (book: BookMeta) => {
    if (!window.confirm(`Remove "${book.title}" from your library?`)) return;
    try { await remove(book.id); } catch (err) { runtimeLog.error('Failed to delete book:', err); }
  };

  const handleOpen = async (entry: LibraryEntry) => {
    if (downloadProgress[entry.book.id] !== undefined) return;
    if (entry.classBook?.format === 'epub') {
      navigate(`/books/${entry.book.id}?source=class`);
      return;
    }
    if (entry.book.source === 'server') {
      navigate(`/books/${entry.book.id}?source=personal`);
      return;
    }
    if (!entry.classBook || entry.downloaded) {
      navigate(`/books/${entry.book.id}?source=device`);
      return;
    }
    const id = entry.classBook.id;
    setUploadError('');
    setDownloadProgress((current) => ({ ...current, [id]: 0 }));
    try {
      const imported = await addFromClass(entry.classBook, (fraction) => {
        setDownloadProgress((current) => ({ ...current, [id]: fraction }));
      });
      if (!imported.processing) navigate(`/books/${imported.id}?source=device`);
    } catch (err) {
      runtimeLog.error('Failed to download class book:', err);
      setUploadError(err instanceof Error ? err.message : 'Could not download that class book.');
    } finally {
      setDownloadProgress((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div className="epub-library">
      <div className="epub-library-header">
        <div>
          <h1 className="epub-library-title">Books</h1>
          <p className="epub-library-subtitle">EPUBs are saved privately to your Polycast profile. Books shared by a teacher appear automatically; CBZ text processing remains on this device.</p>
        </div>
        <div className="epub-upload-actions">
          <label className="epub-comic-language">
            <span>CBZ text</span>
            <select
              value={comicLanguage}
              onChange={(event) => setComicLanguage(event.target.value as 'en' | 'es')}
              disabled={busy}
              aria-label="Language printed in uploaded CBZ comics"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <button className="epub-upload-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            <PlusIcon size={18} />
            {busy ? 'Importing…' : 'Upload book'}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".epub,.cbz,application/epub+zip,application/vnd.comicbook+zip,application/zip"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {uploadError && <div className="epub-error">{uploadError}</div>}
      {error && <div className="epub-error">{error}</div>}
      {classBooksError && <div className="epub-error">Class library: {classBooksError}</div>}

      {loading || classBooksLoading ? (
        <div className="epub-library-empty"><div className="loading-spinner" /></div>
      ) : entries.length === 0 ? (
        <div className="epub-library-empty">
          <BookOpenIcon size={48} />
          <p>Your library is empty.</p>
          <button className="epub-upload-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            <PlusIcon size={18} /> Upload your first book
          </button>
        </div>
      ) : (
        <div className="epub-grid">
          {entries.map((entry) => (
            <BookCard
              key={entry.book.id}
              book={entry.book}
              classBook={entry.classBook}
              downloaded={entry.downloaded}
              downloadProgress={downloadProgress[entry.book.id]}
              onOpen={() => void handleOpen(entry)}
              onDelete={entry.classBook ? undefined : () => void handleDelete(entry.book)}
              onRetryOcr={() => void retryOcr(entry.book.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
