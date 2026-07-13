import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.library');
// ---------------------------------------------------------------------------
// pages/Library.tsx -- EPUB + prototype CBZ library (stored on-device).
// ---------------------------------------------------------------------------

import '../styles/epub.css';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooks } from '../hooks/useBooks';
import type { BookMeta } from '../utils/bookStore';
import { BookOpenIcon, PlusIcon, TrashIcon } from '../components/icons';

function BookCard({ book, onOpen, onDelete }: { book: BookMeta; onOpen: () => void; onDelete: () => void }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!book.cover) return;
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [book.cover]);

  return (
    <div className="epub-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="epub-card-cover">
        {coverUrl
          ? <img src={coverUrl} alt={book.title} loading="lazy" />
          : <div className="epub-card-cover--placeholder"><BookOpenIcon size={32} /><span>{book.title}</span></div>}
      </div>
      <div className="epub-card-meta">
        <div className="epub-card-title" title={book.title}>{book.title}</div>
        <div className="epub-card-author" title={book.author}>{book.author}</div>
        {book.format === 'comic' && (
          <div className="epub-card-format">CBZ preview · {book.pageCount ?? 2} pages</div>
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
  const { books, loading, error, addFromFile, remove } = useBooks();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    setUploadError('');
    try {
      let lastId = '';
      for (const file of Array.from(files)) {
        lastId = await addFromFile(file);
      }
      if (files.length === 1 && lastId) navigate(`/books/${lastId}`);
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
          <p className="epub-library-subtitle">Read EPUBs or the two-page CBZ preview and tap any mapped word to look it up.</p>
        </div>
        <button className="epub-upload-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
          <PlusIcon size={18} />
          {busy ? 'Importing…' : 'Upload book'}
        </button>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
