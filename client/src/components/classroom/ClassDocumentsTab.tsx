import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClassroomBooks, type ClassBook, type Classroom } from '../../api/classroom';
import { BookOpenIcon, DocumentIcon, PlusIcon } from '../icons';
import ClassBooksModal from './ClassBooksModal';
import { createScopedRuntimeLogger } from '../../utils/scopedRuntimeLogger';

const runtimeLog = createScopedRuntimeLogger('web.classroom.documents-tab');

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function ClassDocumentsTab({ classroom, isTeacher }: {
  classroom: Classroom;
  isTeacher: boolean;
}) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<ClassBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await getClassroomBooks(classroom.id));
      setError('');
    } catch (err) {
      runtimeLog.error('Failed to load classroom documents:', err);
      setError(err instanceof Error ? err.message : 'Could not load the files for this class.');
    } finally {
      setLoading(false);
    }
  }, [classroom.id]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="class-documents-panel">
      <div className="class-documents-heading">
        <div>
          <h2>Documents</h2>
          <p>PDFs open online here. EPUB and CBZ books are also available from the Books Library.</p>
        </div>
        {isTeacher && (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setManaging(true)}>
            <PlusIcon size={14} /> Add files
          </button>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}
      {loading ? (
        <div className="class-documents-empty"><div className="loading-spinner" /></div>
      ) : files.length === 0 ? (
        <div className="class-documents-empty">
          <DocumentIcon size={42} />
          <strong>No documents yet</strong>
          <span>{isTeacher ? 'Add a PDF, EPUB, or CBZ for this class.' : 'Your teacher has not shared any files yet.'}</span>
        </div>
      ) : (
        <div className="class-documents-grid">
          {files.map((file) => (
            <article className="class-document-card" key={file.id}>
              <div className={`class-document-icon class-document-icon--${file.format}`}>
                {file.format === 'pdf' ? <DocumentIcon size={24} /> : <BookOpenIcon size={24} />}
              </div>
              <div className="class-document-details">
                <strong title={file.title}>{file.title}</strong>
                <span>{file.format.toUpperCase()} · {formatBytes(file.byte_size)}{file.author ? ` · ${file.author}` : ''}</span>
              </div>
              {file.format === 'pdf' ? (
                <a
                  className="btn btn-secondary btn-sm"
                  href={`/api/class-books/${encodeURIComponent(file.id)}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open PDF
                </a>
              ) : (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/books')}>
                  Open Library
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {managing && (
        <ClassBooksModal
          classroom={classroom}
          onClose={() => {
            setManaging(false);
            void load();
          }}
        />
      )}
    </section>
  );
}
