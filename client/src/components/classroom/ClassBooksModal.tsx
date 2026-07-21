import { useEffect, useRef, useState } from 'react';
import {
  deleteClassroomBook,
  getClassroomBooks,
  uploadClassroomBook,
  type ClassBook,
  type Classroom,
} from '../../api/classroom';
import { BookOpenIcon, CloseIcon, PlusIcon, TrashIcon } from '../icons';
import { parseEpub } from '../../utils/epub';
import { createScopedRuntimeLogger } from '../../utils/scopedRuntimeLogger';

const runtimeLog = createScopedRuntimeLogger('web.classroom.class-books-modal');

function titleFromFilename(filename: string) {
  return filename.replace(/\.(?:epub|cbz|pdf)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function ClassBooksModal({ classroom, onClose }: {
  classroom: Classroom;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<ClassBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState<'en' | 'es'>(
    classroom.target_language === 'es' ? 'es' : 'en',
  );
  const [readingMetadata, setReadingMetadata] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      setBooks(await getClassroomBooks(classroom.id));
      setError('');
    } catch (err) {
      runtimeLog.error('Failed to load class books:', err);
      setError(err instanceof Error ? err.message : 'Could not load this class library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [classroom.id]);

  const handleFile = async (selected: File | null) => {
    setFile(selected);
    setError('');
    setSuccess('');
    if (!selected) return;
    setTitle(titleFromFilename(selected.name));
    setAuthor('');
    if (!selected.name.toLowerCase().endsWith('.epub')) return;

    setReadingMetadata(true);
    try {
      const parsed = parseEpub(new Uint8Array(await selected.arrayBuffer()));
      setTitle(parsed.title || titleFromFilename(selected.name));
      setAuthor(parsed.author || '');
      if (parsed.language === 'en' || parsed.language === 'es') setLanguage(parsed.language);
    } catch (err) {
      runtimeLog.error('Failed to read EPUB metadata:', err);
      setError(err instanceof Error ? err.message : 'This EPUB could not be read.');
    } finally {
      setReadingMetadata(false);
    }
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !title.trim()) return;
    setUploading(true);
    setUploadProgress(0);
    setError('');
    setSuccess('');
    try {
      const uploaded = await uploadClassroomBook({
        classroomId: classroom.id,
        file,
        title: title.trim(),
        author: author.trim(),
        language,
      }, setUploadProgress);
      setBooks((current) => [uploaded, ...current]);
      setFile(null);
      setTitle('');
      setAuthor('');
      if (inputRef.current) inputRef.current.value = '';
      setSuccess(uploaded.format === 'pdf'
        ? `${uploaded.title} is now available in this class’s Documents tab.`
        : `${uploaded.title} is now available in every enrolled student's Library.`);
    } catch (err) {
      runtimeLog.error('Failed to upload class book:', err);
      setError(err instanceof Error ? err.message : 'Could not add this book to the class.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (book: ClassBook) => {
    if (!window.confirm(`Remove “${book.title}” from ${classroom.name}? Students will no longer be able to download it.`)) return;
    setError('');
    try {
      await deleteClassroomBook(book.id);
      setBooks((current) => current.filter((candidate) => candidate.id !== book.id));
      setSuccess(`${book.title} was removed from the class Library.`);
    } catch (err) {
      runtimeLog.error('Failed to delete class book:', err);
      setError(err instanceof Error ? err.message : 'Could not remove this class book.');
    }
  };

  return (
    <div className="create-class-overlay" onClick={() => { if (!uploading) onClose(); }}>
      <div className="create-class-modal class-books-modal" onClick={(event) => event.stopPropagation()}>
        <div className="create-class-modal-header">
          <div>
            <h2 className="create-class-modal-title">Files for {classroom.name}</h2>
            <p className="classes-join-description">PDFs appear under Documents. EPUB and CBZ books also appear in every enrolled student’s Library.</p>
          </div>
          <button
            className="create-class-modal-close"
            type="button"
            onClick={onClose}
            disabled={uploading}
            aria-label="Close class books"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="class-books-modal-scroll">
          <form className="class-books-upload" onSubmit={handleUpload}>
            <input
              ref={inputRef}
              type="file"
              accept=".epub,.cbz,.pdf,application/pdf,application/epub+zip,application/vnd.comicbook+zip,application/zip"
              hidden
              onChange={(event) => void handleFile(event.target.files?.[0] || null)}
            />
            <button
              className="class-books-file-picker"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || readingMetadata}
            >
              <PlusIcon size={18} />
              <span>{file ? file.name : 'Choose a PDF, EPUB, or CBZ'}</span>
              {file && <small>{formatBytes(file.size)}</small>}
            </button>

            {file && (
              <div className="class-books-fields">
                <label className="create-class-field">
                  <span className="create-class-label">Title</span>
                  <input className="form-input" value={title} onChange={(event) => setTitle(event.target.value)} required />
                </label>
                <label className="create-class-field">
                  <span className="create-class-label">Author (optional)</span>
                  <input className="form-input" value={author} onChange={(event) => setAuthor(event.target.value)} />
                </label>
                <label className="create-class-field">
                  <span className="create-class-label">Book language</span>
                  <select className="form-input" value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'es')}>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                  </select>
                </label>
              </div>
            )}

            {uploading && (
              <div className="class-books-upload-progress" aria-live="polite">
                <div><strong>Uploading to class</strong><span>{Math.round(uploadProgress * 100)}%</span></div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress * 100)}>
                  <span style={{ width: `${Math.max(1, uploadProgress * 100)}%` }} />
                </div>
                <small>Keep this window open until the upload finishes.</small>
              </div>
            )}

            {error && <div className="auth-error" role="alert">{error}</div>}
            {success && <div className="classes-join-success" role="status">{success}</div>}

            <div className="class-books-upload-actions">
              <button className="btn btn-primary" type="submit" disabled={!file || !title.trim() || uploading || readingMetadata}>
                {readingMetadata ? 'Reading file…' : uploading ? 'Uploading…' : 'Add to class'}
              </button>
            </div>
          </form>

          <section className="class-books-current" aria-label="Files currently shared with this class">
            <h3>Available to students</h3>
            {loading ? (
              <div className="class-books-loading"><div className="loading-spinner" /></div>
            ) : books.length === 0 ? (
              <div className="class-books-empty"><BookOpenIcon size={32} /><span>No class files yet.</span></div>
            ) : books.map((book) => (
              <div className="class-books-row" key={book.id}>
                <BookOpenIcon size={22} />
                <div>
                  <strong>{book.title}</strong>
                  <span>{book.format.toUpperCase()} · {formatBytes(book.byte_size)}{book.author ? ` · ${book.author}` : ''}</span>
                </div>
                <button type="button" onClick={() => void handleDelete(book)} title={`Remove ${book.title}`}>
                  <TrashIcon size={17} />
                </button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
