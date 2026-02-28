// ---------------------------------------------------------------------------
// pages/Classwork.tsx — Class stream (teacher and student views)
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import * as api from '../api';
import type { StreamPost, StreamPostWord, StreamAttachment, LessonItem } from '../api';

// ---------------------------------------------------------------------------
// Attachment renderer
// ---------------------------------------------------------------------------

function AttachmentLink({ att }: { att: StreamAttachment }) {
  const url = att.url;
  const label = att.label || url;
  const isYoutube = url.includes('youtube.com/watch') || url.includes('youtu.be/');
  const isPdf = url.toLowerCase().endsWith('.pdf');

  return (
    <a className="stream-attachment-link" href={url} target="_blank" rel="noopener noreferrer">
      {isYoutube && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8zM9.75 15.5v-7l6.25 3.5-6.25 3.5z" />
        </svg>
      )}
      {isPdf && !isYoutube && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )}
      {!isYoutube && !isPdf && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
      <span>{label}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Lesson items display (shared between teacher + student)
// ---------------------------------------------------------------------------

function LessonItemsList({ items }: { items: LessonItem[] }) {
  return (
    <div className="lesson-items-display">
      {items.map((item, i) => (
        <div key={i} className="lesson-item-display">
          <div className="lesson-item-display-number">{i + 1}</div>
          <div className="lesson-item-display-content">
            {item.title && <p className="lesson-item-display-title">{item.title}</p>}
            {item.body && <p className="lesson-item-display-body">{item.body}</p>}
            {item.attachments && item.attachments.length > 0 && (
              <div className="stream-attachments">
                {item.attachments.map((att, j) => (
                  <AttachmentLink key={j} att={att} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function EditModal({
  post,
  onSave,
  onClose,
}: {
  post: StreamPost;
  onSave: (updated: StreamPost) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(post.title || '');
  const [body, setBody] = useState(post.body || '');
  const [attachments, setAttachments] = useState<StreamAttachment[]>(post.attachments || []);
  const [lessonItems, setLessonItems] = useState<LessonItem[]>(post.lesson_items || []);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data: Parameters<typeof api.updatePost>[1] = { title };
      if (post.type === 'material') { data.body = body; data.attachments = attachments; }
      if (post.type === 'lesson') { data.lesson_items = lessonItems; }
      const updated = await api.updatePost(post.id, data);
      onSave(updated);
    } catch (err: any) {
      console.error('Edit post failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addLink = () => {
    if (!newUrl.trim()) return;
    setAttachments((prev) => [...prev, { url: newUrl.trim(), label: newLabel.trim() || newUrl.trim() }]);
    setNewUrl('');
    setNewLabel('');
  };

  const updateLessonItem = (i: number, field: keyof LessonItem, value: string) => {
    setLessonItems((prev) => prev.map((it, idx) =>
      idx === i ? { ...it, [field]: value } : it,
    ));
  };

  return (
    <div className="stream-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stream-modal">
        <h2 className="stream-modal-title">Edit Post</h2>
        {error && <div className="auth-error">{error}</div>}

        <label className="form-label">{post.type === 'lesson' ? 'Lesson Title' : 'Title'}</label>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />

        {post.type === 'material' && (
          <>
            <label className="form-label">Body</label>
            <textarea
              className="form-input stream-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
            <label className="form-label">Links</label>
            {attachments.map((att, i) => (
              <div key={i} className="stream-attachment-row">
                <span className="stream-attachment-url">{att.label || att.url}</span>
                <button
                  className="btn-small btn-danger"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="stream-add-link-row">
              <input
                className="form-input"
                placeholder="URL"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                style={{ marginBottom: 0 }}
              />
              <input
                className="form-input"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                style={{ marginBottom: 0 }}
              />
              <button className="btn-small" onClick={addLink}>+ Add</button>
            </div>
          </>
        )}

        {post.type === 'lesson' && lessonItems.map((item, i) => (
          <div key={i} className="lesson-item-editor" style={{ marginBottom: '1rem' }}>
            <span className="lesson-item-number">Item {i + 1}</span>
            <label className="form-label" style={{ marginTop: '0.5rem' }}>Title</label>
            <input
              className="form-input"
              value={item.title}
              onChange={(e) => updateLessonItem(i, 'title', e.target.value)}
            />
            <label className="form-label">Notes</label>
            <textarea
              className="form-input stream-textarea"
              value={item.body || ''}
              onChange={(e) => updateLessonItem(i, 'body', e.target.value)}
              rows={2}
            />
          </div>
        ))}

        <div className="stream-modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teacher post card — handles material, lesson, and word_list
// ---------------------------------------------------------------------------

function TeacherPostCard({
  post,
  onDelete,
  onEdit,
}: {
  post: StreamPost;
  onDelete: (id: string) => void;
  onEdit: (post: StreamPost) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete this post? Students will no longer see it.')) return;
    setDeleting(true);
    try {
      await api.deletePost(post.id);
      onDelete(post.id);
    } catch (err) {
      console.error('Delete post failed:', err);
      setDeleting(false);
    }
  };

  const badgeLabel = post.type === 'material' ? 'Material' : post.type === 'lesson' ? 'Lesson' : 'Word List';

  return (
    <div className={`stream-post-card${post.type === 'lesson' ? ' stream-post-card--lesson' : ''}`}>
      <div className="stream-post-header">
        <span className={`stream-post-type-badge${post.type === 'lesson' ? ' stream-post-type-badge--lesson' : ''}`}>
          {badgeLabel}
        </span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>

      {post.title && <h3 className="stream-post-title">{post.title}</h3>}

      {post.type === 'material' && (
        <>
          {post.body && <p className="stream-post-body">{post.body}</p>}
          {post.attachments && post.attachments.length > 0 && (
            <div className="stream-attachments">
              {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
            </div>
          )}
        </>
      )}

      {post.type === 'lesson' && (
        <LessonItemsList items={post.lesson_items || []} />
      )}

      {post.type === 'word_list' && (
        <>
          <div className="stream-word-chips-preview">
            {(post.words || []).slice(0, 6).map((w) => (
              <span key={w.id} className="stream-word-chip">{w.word}</span>
            ))}
            {(post.word_count || 0) > 6 && (
              <span className="stream-word-chip stream-word-chip--more">
                +{(post.word_count || 0) - 6} more
              </span>
            )}
          </div>
          <p className="stream-word-count-label">{post.word_count || 0} words</p>
        </>
      )}

      <div className="stream-post-actions">
        <button className="btn-small" onClick={() => onEdit(post)}>Edit</button>
        <button className="btn-small btn-danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student: word list card
// ---------------------------------------------------------------------------

function StudentWordListCard({
  post,
  onUpdate,
}: {
  post: StreamPost;
  onUpdate: (updated: Partial<StreamPost> & { id: string }) => void;
}) {
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set(post.known_word_ids || []));
  const [completed, setCompleted] = useState(post.completed || false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState('');

  const words = post.words || [];
  const unknownCount = words.filter((w) => !knownIds.has(w.id)).length;

  const toggleKnown = async (word: StreamPostWord) => {
    const wasKnown = knownIds.has(word.id);
    const newKnown = !wasKnown;
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (newKnown) next.add(word.id); else next.delete(word.id);
      return next;
    });
    try {
      await api.toggleWordKnown(post.id, word.id, newKnown);
    } catch (err: any) {
      console.error('toggleWordKnown failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setKnownIds((prev) => {
        const next = new Set(prev);
        if (wasKnown) next.add(word.id); else next.delete(word.id);
        return next;
      });
    }
  };

  const handleAddToDictionary = async () => {
    setAdding(true);
    setError('');
    try {
      const result = await api.addPostToDictionary(post.id);
      setAddResult(result);
      setCompleted(true);
      onUpdate({ id: post.id, completed: true });
    } catch (err: any) {
      console.error('addPostToDictionary failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="stream-post-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge">Word List</span>
        {post.target_language && (
          <span className="stream-lang-badge">{post.target_language.toUpperCase()}</span>
        )}
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      {error && <div className="auth-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      <div className="stream-word-chips-grid">
        {words.map((w) => {
          const isKnown = knownIds.has(w.id);
          return (
            <button
              key={w.id}
              className={`stream-word-chip stream-word-chip--interactive${isKnown ? ' stream-word-chip--known' : ''}`}
              onClick={() => toggleKnown(w)}
              title={isKnown ? 'Unmark as known' : 'Mark as known'}
            >
              <span className="stream-chip-word">{w.word}</span>
              {w.translation && <span className="stream-chip-translation"> — {w.translation}</span>}
            </button>
          );
        })}
      </div>
      <div className="stream-word-known-counter">
        <span>{knownIds.size} known</span>
        <span className="stream-counter-dot">·</span>
        <span>{unknownCount} to add</span>
      </div>
      {completed || addResult ? (
        <div className="stream-completed-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {addResult
            ? `Added ${addResult.added} word${addResult.added !== 1 ? 's' : ''} to your dictionary`
            : 'Added to your dictionary'}
        </div>
      ) : (
        <button
          className="btn btn-primary"
          disabled={unknownCount === 0 || adding}
          onClick={handleAddToDictionary}
          style={{ marginTop: '0.75rem' }}
        >
          {adding ? 'Adding…' : `Add ${unknownCount} Word${unknownCount !== 1 ? 's' : ''} to Dictionary`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student: material card
// ---------------------------------------------------------------------------

function StudentMaterialCard({ post }: { post: StreamPost }) {
  return (
    <div className="stream-post-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge">Material</span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      {post.body && <p className="stream-post-body">{post.body}</p>}
      {post.attachments && post.attachments.length > 0 && (
        <div className="stream-attachments">
          {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student: lesson card
// ---------------------------------------------------------------------------

function StudentLessonCard({ post }: { post: StreamPost }) {
  return (
    <div className="stream-post-card stream-post-card--lesson">
      <div className="stream-post-header">
        <span className="stream-post-type-badge stream-post-type-badge--lesson">Lesson</span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      <LessonItemsList items={post.lesson_items || []} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Classwork() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isTeacher = user?.account_type === 'teacher';

  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPost, setEditingPost] = useState<StreamPost | null>(null);

  const loadStream = useCallback(() => {
    setLoading(true);
    setError('');
    api.getStream()
      .then(({ posts: fetched }) => setPosts(fetched))
      .catch((err: any) => {
        console.error('getStream failed:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStream(); }, [loadStream]);

  const handleDelete = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  const handleEdit = (post: StreamPost) => setEditingPost(post);
  const handleEditSaved = (updated: StreamPost) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setEditingPost(null);
  };
  const handleStudentUpdate = (partial: Partial<StreamPost> & { id: string }) => {
    setPosts((prev) => prev.map((p) => (p.id === partial.id ? { ...p, ...partial } : p)));
  };

  return (
    <div className="classwork-page">
      <div className="classwork-header">
        <h1 className="classwork-title">Classwork</h1>
        {isTeacher && (
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/classwork/create')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Post
          </button>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : posts.length === 0 ? (
        <div className="classwork-empty">
          {isTeacher
            ? 'No posts yet. Click "Create Post" to share materials, lessons, or word lists.'
            : "Your teacher hasn't posted anything yet, or you haven't been added to a class."}
        </div>
      ) : (
        <div className="classwork-feed">
          {posts.map((post) => {
            if (isTeacher) {
              return (
                <TeacherPostCard
                  key={post.id}
                  post={post}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              );
            }

            const teacherName = post.teacher_name;
            const idx = posts.indexOf(post);
            const showTeacherHeader =
              teacherName &&
              (idx === 0 || posts[idx - 1].teacher_name !== teacherName);

            return (
              <React.Fragment key={post.id}>
                {showTeacherHeader && (
                  <div className="stream-teacher-label">{teacherName}</div>
                )}
                {post.type === 'word_list' ? (
                  <StudentWordListCard post={post} onUpdate={handleStudentUpdate} />
                ) : post.type === 'lesson' ? (
                  <StudentLessonCard post={post} />
                ) : (
                  <StudentMaterialCard post={post} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {editingPost && (
        <EditModal post={editingPost} onSave={handleEditSaved} onClose={() => setEditingPost(null)} />
      )}
    </div>
  );
}
