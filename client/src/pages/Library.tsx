import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.library');
// ---------------------------------------------------------------------------
// pages/Library.tsx -- EPUB + full, on-device CBZ OCR library.
// ---------------------------------------------------------------------------

import '../styles/epub.css';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooks } from '../hooks/useBooks';
import type { BookMeta } from '../utils/bookStore';
import { BookOpenIcon, PlusIcon, TrashIcon } from '../components/icons';

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

function BookCard({ book, onOpen, onDelete, onRetryOcr }: {
  book: BookMeta;
  onOpen: () => void;
  onDelete: () => void;
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
      </div>
      <button
        className="epub-card-delete"
        title="Remove book"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <TrashIcon size={16} />
      </button>
    </div>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const { books, loading, error, addFromFile, remove, retryOcr } = useBooks();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comicLanguage, setComicLanguage] = useState<'en' | 'es'>('en');

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
      if (files.length === 1 && lastImport && !lastImport.processing) navigate(`/books/${lastImport.id}`);
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

  return (
    <div className="epub-library">
      <div className="epub-library-header">
        <div>
          <h1 className="epub-library-title">Books</h1>
          <p className="epub-library-subtitle">Read EPUBs or upload a CBZ. Polycast selects text from every comic page on this device, and completed pages become clickable immediately.</p>
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

      {loading ? (
        <div className="epub-library-empty"><div className="loading-spinner" /></div>
      ) : books.length === 0 ? (
        <div className="epub-library-empty">
          <BookOpenIcon size={48} />
          <p>Your library is empty.</p>
          <button className="epub-upload-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            <PlusIcon size={18} /> Upload your first book
          </button>
        </div>
      ) : (
        <div className="epub-grid">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => navigate(`/books/${book.id}`)}
              onDelete={() => void handleDelete(book)}
              onRetryOcr={() => void retryOcr(book.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
