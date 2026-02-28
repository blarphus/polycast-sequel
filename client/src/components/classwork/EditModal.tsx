// ---------------------------------------------------------------------------
// components/classwork/EditModal.tsx — Edit existing post modal
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import * as api from '../../api';
import type { StreamPost, StreamAttachment, LessonItem } from '../../api';

// ---------------------------------------------------------------------------
// Edit modal (for editing existing posts)
// ---------------------------------------------------------------------------

export default function EditModal({
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
              <input className="form-input" placeholder="URL" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} style={{ marginBottom: 0 }} />
              <input className="form-input" placeholder="Label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ marginBottom: 0 }} />
              <button className="btn-small" onClick={addLink}>+ Add</button>
            </div>
          </>
        )}
        {post.type === 'lesson' && lessonItems.map((item, i) => (
          <div key={i} className="lesson-item-editor" style={{ marginBottom: '1rem' }}>
            <span className="lesson-item-number">Item {i + 1}</span>
            <label className="form-label" style={{ marginTop: '0.5rem' }}>Title</label>
            <input className="form-input" value={item.title} onChange={(e) => updateLessonItem(i, 'title', e.target.value)} />
            <label className="form-label">Notes</label>
            <textarea className="form-input stream-textarea" value={item.body || ''} onChange={(e) => updateLessonItem(i, 'body', e.target.value)} rows={2} />
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
